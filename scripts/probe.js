/* 场景内部状态探针：GLB 加载数、装配件、动画循环 */
'use strict';
const puppeteer = require('puppeteer-core');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
(async () => {
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu', '--window-size=1440,900'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://127.0.0.1:8901/dist/strata-pc-simulator.html?3d', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 6000)); // 等 GLB 异步加载完
  const st = await page.evaluate(() => {
    const S = window.STRATA_3D;
    const dbg = S.debugState ? S.debugState() : null;
    return { hasDbg: !!dbg, dbg };
  });
  console.log(JSON.stringify(st, null, 1));
  if (errs.length) console.log('PAGE ERRORS:', errs);
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
