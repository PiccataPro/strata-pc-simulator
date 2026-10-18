/* 自由拖拽玩法探针：
   1) 默认配置进 3D → 开盖 → setCam 到能同时看到机箱和桌面的角度
   2) partScreen('ram',0) 拿射线验证过的内存屏幕点 → 按下拖到 deskScreen() → 中途滚轮
   3) 断言：拖拽中 draggingFree=true；落桌后 spareCount+1 且 freeCount=1
   4) 再抓这只自由件挪位 → 断言 spare/free 计数不变（纯视觉挪位）
   用法：node scripts/probe_freedrag.cjs [baseUrl] */
'use strict';
const path = require('path');
const puppeteer = require('puppeteer-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8901';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu', '--window-size=1440,900'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
  await p.goto(BASE + '/dist/strata-pc-simulator.html?3d', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(5000);
  await p.click('#btnDoor'); await sleep(900);

  const st0 = await p.evaluate(() => window.STRATA_3D.debugState());
  console.log('初始:', JSON.stringify({ spare: st0.spareCount, free: st0.freeCount }));

  /* 相机：摆到纯玻璃侧（+X）——诊断证实相机跑到后面板外(Z>450)时，实心尾墙会挡住所有内部部件 */
  await p.evaluate(() => window.STRATA_3D.setCam([780, 420, 300], [60, 260, 300]));
  await sleep(900);

  const cv = await p.$('#case3d canvas');
  const box = await cv.boundingBox();

  /* 按 gpu→ram→cpu 顺序找第一个「射线最前面就是它」的部件（内存常被散热塔挡） */
  let ram = null;
  const cands = [['gpu', 0], ['ram', 0], ['ram', 1], ['ram', 2], ['ram', 3], ['cpu', 0], ['psu', 0]];
  for (const [cat, idx] of cands) {
    const s = await p.evaluate(([c, i]) => window.STRATA_3D.partScreen(c, i), [cat, idx]);
    if (s && s.hit) { ram = s; ram.cat = cat; ram.idx = idx; break; }
  }
  const desk = await p.evaluate(() => window.STRATA_3D.deskScreen());
  console.log('部件命中点:', JSON.stringify(ram), '桌面落点:', JSON.stringify(desk));
  if (!ram || !desk) { console.log('FAIL: 找不到可拖部件或桌面落点'); await b.close(); process.exit(1); }

  const x1 = box.x + ram.x, y1 = box.y + ram.y, xd = box.x + desk.x, yd = box.y + desk.y;

  await p.mouse.move(x1, y1); await sleep(150);
  await p.mouse.down(); await sleep(150);
  const steps = 16;
  for (let i = 1; i <= steps; i++) {
    await p.mouse.move(x1 + (xd - x1) * i / steps, y1 + (yd - y1) * i / steps);
    await sleep(40);
    if (i === 8) { await p.mouse.wheel({ deltaY: 240 }); await sleep(150); }  // 拖拽中转一下
  }
  const mid = await p.evaluate(() => window.STRATA_3D.debugState());
  console.log('拖拽中 draggingFree:', mid.draggingFree);
  await p.screenshot({ path: path.join(__dirname, 'shots', '44_freedrag_lift.png') });
  await p.mouse.up(); await sleep(800);

  const st1 = await p.evaluate(() => window.STRATA_3D.debugState());
  console.log('落桌后:', JSON.stringify({ spare: st1.spareCount, free: st1.freeCount }));
  await p.screenshot({ path: path.join(__dirname, 'shots', '44_freedrag_desk.png') });

  /* 再拖这只自由件挪位（计数应不变） */
  let st2 = st1;
  const p2 = await p.evaluate(() => window.STRATA_3D.firstFreeScreen());
  if (p2 && p2.visible) {
    const xa = box.x + p2.x, ya = box.y + p2.y;
    await p.mouse.move(xa, ya); await sleep(150);
    await p.mouse.down(); await sleep(150);
    for (let i = 1; i <= 10; i++) { await p.mouse.move(xa - 140 * i / 10, ya + 70 * i / 10); await sleep(40); }
    await p.mouse.up(); await sleep(700);
    st2 = await p.evaluate(() => window.STRATA_3D.debugState());
    console.log('挪位后:', JSON.stringify({ spare: st2.spareCount, free: st2.freeCount }));
  } else console.log('WARN: 找不到自由件屏幕点，跳过挪位测试');
  await p.screenshot({ path: path.join(__dirname, 'shots', '44_freedrag_moved.png') });
  await b.close();

  const ok = !errs.length && mid.draggingFree &&
    st1.spareCount === st0.spareCount + 1 && st1.freeCount === 1 &&
    st2.spareCount === st1.spareCount && st2.freeCount === 1;
  console.log('errors:', errs.length ? errs.join(' | ') : '无');
  console.log(ok ? 'FREE DRAG PROBE: PASS' : 'FREE DRAG PROBE: FAIL');
  process.exit(ok ? 0 : 1);
})();
