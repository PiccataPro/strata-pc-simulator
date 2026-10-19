/* 第三批贴图（texdata4：AMD 阵营 + 银色马甲）集成探针。
   流程：默认现机（Intel+NVIDIA，黑/白马甲）→ 验证 tex4 四件 loaded 但 inScene=0
        → 换装 AMD 平台（9800X3D + X670E + 幻锋戟银条 + 9070XT/7900XTX）
        → 验证四件 inScene>0 且 0 报错。
   用法：node scripts/probe_tex4.cjs [baseUrl] */
'use strict';
const path = require('path');
const puppeteer = require('puppeteer-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8901';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
let pass = 0, fail = 0;
const T = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? '  PASS ' : '  FAIL ') + name + (extra != null && !ok ? '  <' + JSON.stringify(extra) + '>' : '')); };
(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu', '--window-size=1440,900'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
  await p.goto(BASE + '/dist/strata-pc-simulator.html?3d', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5500));

  const tex = () => p.evaluate(() => window.STRATA_3D.debugState().tex);

  /* ---- 阶段一：默认现机（Intel IHS / NVIDIA 罩 / 黑白马甲）---- */
  let t = await tex();
  T('四件新贴图已加载', ['cpuIhsAmd','gpuShroudAmd','gpuBackAmd','ramSilver'].every(k => t[k] && t[k].loaded && t[k].img), t);
  T('Intel 阵营不误用 AMD 贴图', t.cpuIhsAmd.inScene === 0 && t.gpuShroudAmd.inScene === 0 && t.ramSilver.inScene === 0,
    { amd: t.cpuIhsAmd.inScene, shroud: t.gpuShroudAmd.inScene, silver: t.ramSilver.inScene });
  T('Intel IHS / 黑马甲在位（回归）', t.cpuIhs.inScene > 0 && t.ramBlack.inScene > 0, { ihs: t.cpuIhs.inScene, ram: t.ramBlack.inScene });

  /* ---- 阶段二：换装 AMD 平台（走 app 真函数：install/removePart）---- */
  await p.evaluate(() => {
    removePart('gpu', 0); removePart('gpu', 0);          // 拆 3080/4070S
    install('r7-9800X3D', 'cpu'); install('x670e-aorus-master', 'mobo');
    for (let i = 0; i < 4; i++) install('d5-32-6000', 'ram', i);
    install('rx-9070xt-16g', 'gpu'); install('rx-7900xtx-24g', 'gpu');
  });
  await new Promise(r => setTimeout(r, 2500));
  t = await tex();
  T('AMD IHS 顶盖在位', t.cpuIhsAmd.inScene > 0, t.cpuIhsAmd);
  T('Intel IHS 卸位', t.cpuIhs.inScene === 0, t.cpuIhs);
  T('A 卡导风罩在位(≥2)', t.gpuShroudAmd.inScene >= 2, t.gpuShroudAmd);
  // 拆下的 3080/4070S 变成台面备用件仍完整渲染 → N 罩 inScene=2 是正确行为
  // （恰好证明阵营分流：台面 N 卡用 N 贴图，机箱里 A 卡用 A 贴图，互不串）
  T('N 卡导风罩仅剩台面备用件在用(=2)', t.gpuShroud.inScene === 2, t.gpuShroud);
  T('A 卡背板在位(≥2)', t.gpuBackAmd.inScene >= 2, t.gpuBackAmd);
  T('银色马甲在位(4 条×2 面=8)', t.ramSilver.inScene === 8, t.ramSilver);
  T('黑/白马甲卸位', t.ramBlack.inScene === 0 && t.ramWhite.inScene === 0, { b: t.ramBlack.inScene, w: t.ramWhite.inScene });

  /* ---- 截图：开侧盖看 A 卡+银条+AMD 顶盖 ---- */
  await p.click('#btnDoor');
  await new Promise(r => setTimeout(r, 800));
  const cv = await p.$('#case3d canvas');
  const box = await cv.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await p.mouse.move(cx, cy);
  await p.mouse.down(); await p.mouse.move(cx - 110, cy + 30, { steps: 10 }); await p.mouse.up();
  await new Promise(r => setTimeout(r, 600));
  for (let i = 0; i < 5; i++) { await p.mouse.wheel({ deltaY: -150 }); await new Promise(r => setTimeout(r, 120)); }
  await new Promise(r => setTimeout(r, 1200));
  await p.screenshot({ path: path.join(__dirname, 'shots', '41_tex4_amd.png') });

  T('全程 0 报错', errs.length === 0, errs.slice(0, 3));
  console.log('\n===== probe_tex4: ' + pass + ' PASS / ' + fail + ' FAIL =====');
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
