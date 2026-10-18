/* 散热器 GLB 命中 + 朝向 + A/B 对比探针：切 D15 双塔风冷 → 查 cooler 是否走 GLB（glbWrapped）
   + glbStats，并用 setCam 精确摆三个视角截图（正对/斜后/全貌俯视）。
   第 3 个参数 TAG 决定输出文件名（glb / prog），用于 GLB 版 vs 程序化版对比。
   用法：node scripts/probe_cooler_glb.cjs [baseUrl] [tag] */
'use strict';
const path = require('path');
const puppeteer = require('puppeteer-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8901';
const TAG = process.argv[3] || 'glb';
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
  await p.evaluate(() => { window.__build_test = true; build.cooler = 'd15'; onChange(); });
  await new Promise(r => setTimeout(r, 3500)); // 等 GLB 异步加载
  const st = await p.evaluate(() => window.STRATA_3D.debugState());
  const cooler = st.installed.find(v => v.cat === 'cooler');
  console.log('cooler installed:', JSON.stringify(cooler));
  console.log('glbStats:', JSON.stringify(st.glb));
  // 视角1：正对 +X 侧透平视塔中心
  await p.evaluate(() => window.STRATA_3D.setCam([430, 470, 376], [89, 392, 376]));
  await new Promise(r => setTimeout(r, 1100));
  await p.screenshot({ path: path.join(__dirname, 'shots', `42_cooler_${TAG}_front.png`) });
  // 视角2：斜后 45°（看双塔纵深排布）
  await p.evaluate(() => window.STRATA_3D.setCam([380, 460, 560], [89, 392, 376]));
  await new Promise(r => setTimeout(r, 900));
  await p.screenshot({ path: path.join(__dirname, 'shots', `42_cooler_${TAG}_angle.png`) });
  // 视角3：高俯视全貌（避开显卡遮挡，看塔顶风扇+侧面鳍片）
  await p.evaluate(() => window.STRATA_3D.setCam([360, 640, 560], [89, 360, 376]));
  await new Promise(r => setTimeout(r, 900));
  await p.screenshot({ path: path.join(__dirname, 'shots', `42_cooler_${TAG}_full.png`) });
  await b.close();
  const ok = !errs.length && cooler;
  console.log('errors:', errs.length ? errs.join(' | ') : '无');
  console.log(`COOLER PROBE [${TAG}]: glb=${cooler ? cooler.glb : '?'} ${ok ? 'OK' : 'ERR'}`);
  process.exit(ok ? 0 : 1);
})();
