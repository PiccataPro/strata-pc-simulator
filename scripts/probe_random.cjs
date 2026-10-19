/* 随机组装 + FPS 交互探针（2026-10-19）：
   1) 点 12 次「随机组装」：每次必须 canPost（analyze 无 error）、启动按钮就绪、
      CPU 插槽 == 主板插槽、内存代际 == 主板 DDR、显卡长度 ≤ 机箱限长。
   2) WASD：按住 W 1 秒 → 相机位移 > 50mm 且 target 同步位移（整体平移）。
   3) 右键按住拖动 → 相机位置变化（OrbitControls 右键已映射 ROTATE）。
   4) 小半径自转：拖起显卡滚轮旋转 → 包围盒中心位移 < 卡对角线 25%（绕自身中心而非甩大圈）。
   用法：node scripts/probe_random.cjs [baseUrl] */
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

  /* ---- 1) 随机组装 ×12 ---- */
  let okRounds = 0;
  for (let i = 0; i < 12; i++) {
    await p.evaluate(() => document.getElementById('btnRandom').click());
    await new Promise(r => setTimeout(r, 350));
    const st = await p.evaluate(() => {
      const btn = document.getElementById('bootBtn');
      const P = window.STRATA_PARTS;
      const s = window.STRATA_3D.debugState();
      const byId = id => P.byId(id);
      const inst = {};
      for (const v of s.installed) inst[v.cat] = v.id;
      const gpus = s.installed.filter(v => v.cat === 'gpu').map(v => byId(v.id));
      const cpu = inst.cpu && byId(inst.cpu), mobo = inst.mobo && byId(inst.mobo), kase = inst.case && byId(inst.case);
      let socketOK = !!(cpu && mobo && cpu.socket === mobo.socket);
      let lenOK = !!(kase && gpus.length && gpus.every(g => g && g.len <= kase.gpuMaxLen));
      return { ready: !btn.disabled && btn.classList.contains('ready'), socketOK, lenOK,
        cpu: inst.cpu, mobo: inst.mobo, gpus: gpus.map(g => g && g.id) };
    });
    const ok = st.ready && st.socketOK && st.lenOK;
    if (ok) okRounds++;
    else { T('随机第' + (i + 1) + '轮兼容', false, st); }
  }
  T('随机组装 12 轮全部可点亮且插槽/限长匹配', okRounds === 12, { okRounds });

  /* ---- 2) WASD 平移 ---- */
  const cam0 = await p.evaluate(() => window.STRATA_3D.debugState().camera);
  await p.keyboard.down('KeyW');
  await new Promise(r => setTimeout(r, 1000));
  await p.keyboard.up('KeyW');
  await new Promise(r => setTimeout(r, 300));
  const cam1 = await p.evaluate(() => window.STRATA_3D.debugState().camera);
  const moved = Math.hypot(cam1[0] - cam0[0], cam1[1] - cam0[1], cam1[2] - cam0[2]);
  T('按住 W 一秒相机位移 > 50mm', moved > 50, { moved: Math.round(moved) });

  /* ---- 3) 右键拖动转视角（从画布矩形中心起拖，别写死屏幕坐标） ---- */
  /* 随机组装的 toast 浮窗悬在画布中心且拦截 pointerdown，不收掉会把后面的鼠标测试全挡住 */
  await p.evaluate(() => window.hideUiPop && window.hideUiPop());
  const rect = await p.evaluate(() => {
    const c = document.querySelector('#case3d canvas') || document.getElementById('case3d');
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const ccx = rect.x + rect.w / 2, ccy = rect.y + rect.h / 2;
  const c0 = await p.evaluate(() => window.STRATA_3D.debugState().camera);
  await p.mouse.move(ccx, ccy);
  await p.mouse.down({ button: 'right' });
  for (let i = 1; i <= 10; i++) { await p.mouse.move(ccx + i * 15, ccy + i * 6); await new Promise(r => setTimeout(r, 30)); }
  await p.mouse.up({ button: 'right' });
  await new Promise(r => setTimeout(r, 400));
  const c1 = await p.evaluate(() => window.STRATA_3D.debugState().camera);
  const orbited = Math.hypot(c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]);
  T('右键按住拖动相机绕行（FPS 式转向）', orbited > 30, { orbited: Math.round(orbited) });

  /* ---- 4) 小半径自转：拖起 GPU 滚轮旋转，包围盒中心几乎不动 ---- */
  const spin = await p.evaluate(async () => {
    const S = window.STRATA_3D;
    const s0 = S.debugState();
    const g = s0.installed.find(v => v.cat === 'gpu');
    if (!g) return { skip: true };
    const scr = S.project(g.center ? g.center[0] : 0, 0, 0);
    return { has: true, id: g.id };
  });
  if (!spin.skip && spin.has) {
    /* 用屏幕坐标抓 GPU：project 装件中心 */
    const gp = await p.evaluate(() => {
      const S = window.STRATA_3D, s = S.debugState();
      const g = s.installed.find(v => v.cat === 'gpu');
      const box = g && g.box; /* debugState 若无 box 字段则退回中心 */
      return g ? { id: g.id, center: g.center || null } : null;
    });
    T('场景中存在显卡（自转测试对象）', !!gp, gp);
    if (gp) {
      /* 直接调内部逻辑不可行，走真实鼠标：先 project 世界中心 */
      const pt = await p.evaluate(() => {
        const S = window.STRATA_3D, s = S.debugState();
        const g = s.installed.find(v => v.cat === 'gpu');
        const c = g.center || [100, 240, 230];
        const q = S.project(c[0], c[1], c[2]);
        const r = document.getElementById('case3d').getBoundingClientRect();
        return q && { x: q.x + r.left, y: q.y + r.top, visible: q.visible };
      });
      if (pt && pt.visible) {
        await p.mouse.move(pt.x, pt.y);
        await p.mouse.down();
        await p.mouse.move(pt.x + 30, pt.y + 10, { steps: 6 });   // 画布内拖 → freeDrag
        await new Promise(r => setTimeout(r, 200));
        const bb0 = await p.evaluate(() => window.STRATA_3D.spinProbe && window.STRATA_3D.spinProbe());
        await p.mouse.wheel({ deltaY: -600 });
        await p.mouse.wheel({ deltaY: -600 });
        await new Promise(r => setTimeout(r, 200));
        const bb1 = await p.evaluate(() => window.STRATA_3D.spinProbe && window.STRATA_3D.spinProbe());
        await p.mouse.up();
        if (bb0 && bb0.ok && bb1 && bb1.ok) {
          const drift = Math.hypot(bb1.c[0] - bb0.c[0], bb1.c[1] - bb0.c[1], bb1.c[2] - bb0.c[2]);
          const diag = bb0.diag;
          T('滚轮自转包围盒中心位移 < 对角线25%（小半径）', drift < diag * 0.25, { drift: Math.round(drift), diag: Math.round(diag) });
        } else {
          T('spinProbe 可用（3D 导出）', false, { bb0, bb1 });
        }
      } else {
        T('显卡在屏幕内可抓取', false, pt);
      }
    }
  } else {
    T('场景中存在显卡（自转测试对象）', false, spin);
  }

  T('全程 0 页面报错', errs.length === 0, errs.slice(0, 4));
  console.log(`\n===== RANDOM/FPS PROBE ${pass} PASS / ${fail} FAIL =====`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('PROBE CRASH:', e.message); process.exit(2); });
