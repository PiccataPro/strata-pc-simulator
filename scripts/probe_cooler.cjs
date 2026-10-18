/* 风冷塔顶盖贴图探针：默认水冷配置下把散热换成 D15 双塔风冷 → 验证 coolerTop inScene>0
   用法：node scripts/probe_cooler.cjs [baseUrl] */
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
  await new Promise(r => setTimeout(r, 4000));
  // 换成 D15 双塔风冷（build.cooler 是单值，直接覆盖 + onChange 重建 3D）
  await p.evaluate(() => { window.__build_test = true; build.cooler = 'd15'; onChange(); });
  await new Promise(r => setTimeout(r, 2500));
  await p.click('#btnDoor');
  await new Promise(r => setTimeout(r, 800));
  const cv = await p.$('#case3d canvas');
  const box = await cv.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await p.mouse.move(cx, cy);
  await p.mouse.down(); await p.mouse.move(cx - 110, cy + 30, { steps: 10 }); await p.mouse.up();
  await new Promise(r => setTimeout(r, 600));
  // 对准散热塔顶（CPU 上方，画面上半）
  await p.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.32);
  for (let i = 0; i < 6; i++) { await p.mouse.wheel({ deltaY: -160 }); await new Promise(r => setTimeout(r, 150)); }
  await new Promise(r => setTimeout(r, 1200));
  const st = await p.evaluate(() => window.STRATA_3D.debugState());
  console.log('coolerTop:', JSON.stringify(st.tex.coolerTop));
  console.log('errors:', errs.length ? errs.join(' | ') : '无');
  await p.screenshot({ path: path.join(__dirname, 'shots', '41_tex3_cooler.png') });
  await b.close();
  const ok = !errs.length && st.tex.coolerTop.inScene >= 2; // D15 双塔 → 2 块顶盖
  console.log(ok ? 'COOLER TOP PROBE: PASS' : 'COOLER TOP PROBE: FAIL');
  process.exit(ok ? 0 : 1);
})();
