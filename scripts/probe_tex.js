/* 贴图集成目检探针：进 3D → 开侧盖 → 适度拉近 → 从侧透方向截图 + 输出贴图状态
   （纯 CPU SwiftShader；判定：4 张贴图 img=true 且 inScene>0，页面 0 错误） */
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
  await new Promise(r => setTimeout(r, 5000));           // 等 GLB + 贴图异步加载
  await p.click('#btnDoor');                              // 开侧盖
  await new Promise(r => setTimeout(r, 800));
  const cv = await p.$('#case3d canvas');
  const box = await cv.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await p.mouse.move(cx, cy);
  /* 先水平拖一点把相机转到正对侧透（主板面法线 +X 正对镜头），再拉近 */
  await p.mouse.down();
  await p.mouse.move(cx - 110, cy + 30, { steps: 10 });
  await p.mouse.up();
  await new Promise(r => setTimeout(r, 600));
  for (let i = 0; i < 7; i++) { await p.mouse.wheel({ deltaY: -150 }); await new Promise(r => setTimeout(r, 150)); }
  await new Promise(r => setTimeout(r, 1200));
  const st = await p.evaluate(() => window.STRATA_3D.debugState());
  console.log('tex:', JSON.stringify(st.tex));
  console.log('installed:', st.installed.map(v => v.cat).join(','));
  await p.screenshot({ path: path.join(__dirname, 'shots', '30_tex_closeup.png') });
  console.log('page errors:', errs.length ? errs.join(' | ') : '无');
  await b.close();
  const t = st.tex;
  const ok = !errs.length && ['moboPcb', 'cpuIhs', 'gpuShroud', 'fanHub']
    .every(k => t[k].img && t[k].inScene > 0);
  console.log(ok ? 'TEX PROBE: PASS' : 'TEX PROBE: FAIL');
  process.exit(ok ? 0 : 1);
})();
