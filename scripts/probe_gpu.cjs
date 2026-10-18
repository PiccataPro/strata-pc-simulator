/* GPU 装配验证探针（A/B 终局版）：显卡保持程序化（贴图齐全，白模已回退，见 manifest 注释），
   GLB 只留给 cpu/psu。断言：2 张卡都在、都不走 GLB、GLB 管线本身健康（cpu/psu 命中、0 失败）。
   用法：node scripts/probe_gpu.cjs [baseUrl] */
'use strict';
const puppeteer = require('puppeteer-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8901';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu', '--window-size=1440,900'] });
  const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE + '/dist/strata-pc-simulator.html?3d', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));
  const st = await p.evaluate(() => window.STRATA_3D.debugState());
  console.log('glbStats:', JSON.stringify(st.glb));
  console.log('installed:', st.installed.map(v => v.cat + (v.glb ? '(GLB)' : '')).join(','));
  console.log('errors:', errs.length ? errs.join(' | ') : '无');
  await b.close();
  const gpus = st.installed.filter(v => v.cat === 'gpu');
  const ok = !errs.length && gpus.length === 2 && gpus.every(v => !v.glb) && st.glb.ok >= 2 && st.glb.fail === 0;
  console.log(ok ? 'GPU PROBE: PASS (程序化显卡 + GLB 管线健康)' : 'GPU PROBE: FAIL');
  process.exit(ok ? 0 : 1);
})();
