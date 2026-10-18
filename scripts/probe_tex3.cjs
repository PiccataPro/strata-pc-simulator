/* 第二批贴图集成探针：进 3D → 开侧盖 → 拉近 → 截图 + 输出 7 张新贴图 inScene 状态
   用法：node scripts/probe_tex3.cjs [baseUrl]
   判定：内存/塔顶/泵顶/电源铭牌/格栅/遮罩 中，当前配置应出现的贴图 inScene>0 且 0 错误 */
'use strict';
const path = require('path');
const puppeteer = require('puppeteer-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8901';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu', '--window-size=1440,900'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
  await p.goto(BASE + '/dist/strata-pc-simulator.html?3d', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));
  await p.click('#btnDoor');
  await new Promise(r => setTimeout(r, 800));
  const cv = await p.$('#case3d canvas');
  const box = await cv.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await p.mouse.move(cx, cy);
  // 转到正对侧透的内部视角（同 probe_tex）
  await p.mouse.down();
  await p.mouse.move(cx - 110, cy + 30, { steps: 10 });
  await p.mouse.up();
  await new Promise(r => setTimeout(r, 600));
  // 先整体拉近一点
  for (let i = 0; i < 4; i++) { await p.mouse.wheel({ deltaY: -150 }); await new Promise(r => setTimeout(r, 120)); }
  await new Promise(r => setTimeout(r, 500));
  // 把镜头中心对准内存区（画面上半、偏主板侧），再放大——内存 y≈318 在画面上部
  const mx = box.x + box.width * 0.42, my = box.y + box.height * 0.30;
  await p.mouse.move(mx, my);
  for (let i = 0; i < 6; i++) { await p.mouse.wheel({ deltaY: -160 }); await new Promise(r => setTimeout(r, 150)); }
  await new Promise(r => setTimeout(r, 1200));
  const st = await p.evaluate(() => window.STRATA_3D.debugState());
  console.log('tex:', JSON.stringify(st.tex));
  console.log('errors:', errs.length ? errs.join(' | ') : '无');
  await p.screenshot({ path: path.join(__dirname, 'shots', '40_tex3_ram.png') });
  await b.close();
  const t = st.tex;
  // 内存必出现（默认 4 条），其余按当前配置
  const ok = !errs.length && t.ramBlack && t.ramBlack.inScene > 0;
  console.log(ok ? 'TEX3 PROBE: PASS' : 'TEX3 PROBE: CHECK');
  process.exit(0);
})();
