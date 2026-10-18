/* 显卡朝向目验探针：默认配置（双 4070S GLB）→ setCam 三个视角截图：
   1) 侧透平视（看风扇朝下/背板朝上） 2) 低角度仰视（正对风扇面） 3) 后面板视角（看挡板齐平）
   用法：node scripts/probe_gpu_orient.cjs [baseUrl] */
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
  // 显卡中心约 X=60, Y=196/162, Z=290（slot1/2 双卡）
  await p.evaluate(() => window.STRATA_3D.setCam([520, 300, 290], [60, 180, 290]));
  await new Promise(r => setTimeout(r, 1100));
  await p.screenshot({ path: path.join(__dirname, 'shots', '43_gpu_side.png') });
  // 低角度仰视：从机箱下部往上看风扇面
  await p.evaluate(() => window.STRATA_3D.setCam([430, 60, 240], [60, 180, 300]));
  await new Promise(r => setTimeout(r, 900));
  await p.screenshot({ path: path.join(__dirname, 'shots', '43_gpu_under.png') });
  // 后面板外视角：看挡板与尾墙齐平
  await p.evaluate(() => window.STRATA_3D.setCam([100, 250, 760], [100, 220, 450]));
  await new Promise(r => setTimeout(r, 900));
  await p.screenshot({ path: path.join(__dirname, 'shots', '43_gpu_rear.png') });
  await b.close();
  console.log('errors:', errs.length ? errs.join(' | ') : '无');
  console.log('GPU ORIENT SHOTS: DONE');
  process.exit(errs.length ? 1 : 0);
})();
