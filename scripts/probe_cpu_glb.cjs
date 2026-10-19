/* CPU/PSU GLB 扩充探针（2026-10-19）：验证 manifest 新登记的白模命中 + 朝向 + IHS 浮贴。
   场景：默认现机 i7-14700（LGA1700 GLB）→ 换装 r7-9800X3D（AM5 GLB）→ 换装 psu-750atx31（psu_atx GLB）。
   断言：glbWrapped 命中、glbStats.fail=0、IHS 贴图仍 inScene>0（postGlbDecal 浮贴生效）、0 报错。
   截图：CPU 正对 +X 侧透特写（目视朝向/缺口/贴图）。
   用法：node scripts/probe_cpu_glb.cjs [baseUrl] */
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

  const st = () => p.evaluate(() => window.STRATA_3D.debugState());

  /* ---- 阶段一：默认现机 i7-14700（LGA1700 GLB）---- */
  let s = await st();
  let cpu = s.installed.find(v => v.cat === 'cpu');
  T('默认 i7-14700 命中 LGA1700 GLB', cpu && cpu.glb === true, cpu);
  T('Intel IHS 浮贴在位（GLB 版 postGlbDecal）', s.tex.cpuIhs.inScene > 0, s.tex.cpuIhs);
  let psu = s.installed.find(v => v.cat === 'psu');
  T('默认电源命中 psu_atx GLB', psu && psu.glb === true, psu);
  T('GLB 加载零失败', s.glb.fail === 0, s.glb);

  /* ---- 阶段二：换装 AM5（r7-9800X3D）---- */
  await p.evaluate(() => { removePart('cpu', 0); install('r7-9800X3D', 'cpu'); });
  await new Promise(r => setTimeout(r, 3000));
  s = await st();
  cpu = s.installed.find(v => v.cat === 'cpu');
  T('AM5 r7-9800X3D 命中 cpu_am5 GLB', cpu && cpu.glb === true, cpu);
  /* 拆下的 i7-14700 变台面备用件仍渲染 Intel IHS（已知坑 #1 的 GLB 版变体：
     postGlbDecal 浮贴随 group 移到台面）→ Intel 贴图基线=1。判定"机箱内分流正确"
     用**上界**：若机箱 AM5 错用 Intel 贴图，intel 会=2（台面+机箱）。<=1 即正确。 */
  T('AM5 机箱内用 AMD IHS（Intel 仅台面备用件=1）', s.tex.cpuIhsAmd.inScene >= 1 && s.tex.cpuIhs.inScene <= 1,
    { amd: s.tex.cpuIhsAmd.inScene, intel: s.tex.cpuIhs.inScene });
  T('AM5 换装后 GLB 仍零失败', s.glb.fail === 0, s.glb);

  /* 截图：拆掉散热（默认现机 AIO 冷头会整个盖住 CPU）→ 正对 +X 特写，
     目视白模朝向（平面应贴主板 YZ、厚度朝 +X、顶边三角缺口、IHS 蚀刻贴图浮在 +X 面）。 */
  await p.evaluate(() => { removePart('cooler', 0); });
  await new Promise(r => setTimeout(r, 800));
  await p.evaluate(() => window.STRATA_3D.setCam([150, 360, 384], [6, 352, 384]));
  await new Promise(r => setTimeout(r, 1200));
  await p.screenshot({ path: path.join(__dirname, 'shots', '43_cpu_am5_glb.png') });

  /* ---- 阶段三：换装非海盗船电源（psu-750atx31 海韵）---- */
  await p.evaluate(() => { removePart('psu', 0); install('psu-750atx31', 'psu'); });
  await new Promise(r => setTimeout(r, 2500));
  s = await st();
  psu = s.installed.find(v => v.cat === 'psu');
  T('海韵电源命中 psu_atx GLB', psu && psu.glb === true, psu);
  /* 拆下的海盗船 AX1200i 变台面备用件（全新程序化构建，brand=海盗船→挂铭牌）=1。
     机箱海韵 brand≠海盗船→postGlbDecal 与程序化铭牌都不挂=0。判定用**上界 <=1**：
     若机箱海韵错挂海盗船铭牌，psuLabel 会=2（台面+机箱）。 */
  T('机箱海韵不挂 AX1200i 铭牌（仅台面备用件=1）', s.tex.psuLabel.inScene <= 1, s.tex.psuLabel);

  T('全程 0 报错', errs.length === 0, errs.slice(0, 3));
  console.log('\n===== probe_cpu_glb: ' + pass + ' PASS / ' + fail + ' FAIL =====');
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
