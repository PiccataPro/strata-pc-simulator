/* 一次性探针：确认 decode「乐观口径」角标进入 DOM（2D 视图，开机后查仪表盘） */
'use strict';
const puppeteer = require('puppeteer-core');
const BASE = process.argv[2] || 'http://127.0.0.1:8901';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
(async () => {
  const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1600 });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE + '/dist/strata-pc-simulator.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 1500));
  await p.click('#bootBtn'); // ?boot 只在 ?3d 分支里自动触发，2D 下手动点
  await new Promise(r => setTimeout(r, 11000)); // 等 boot 流程走完进 run，仪表盘渲染
  const info = await p.evaluate(() => {
    const opt = document.querySelector('#dash .gauge .opt');
    const dec = [...document.querySelectorAll('#dash .gauge')].find(g => /解码|Decode/.test(g.querySelector('.t')?.textContent || ''));
    return {
      dashLen: (document.getElementById('dash') || {}).innerHTML?.length ?? -1,
      gaugeCount: document.querySelectorAll('#dash .gauge').length,
      bootBtn: document.getElementById('bootBtn')?.textContent,
      badgeExists: !!opt,
      badgeText: opt ? opt.textContent : null,
      badgeTitle: opt ? (opt.getAttribute('title') || '').slice(0, 60) : null,
      decodeGaugeHasBadge: !!(dec && dec.querySelector('.opt')),
      decodeValue: dec ? dec.querySelector('.v')?.textContent : null,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  console.log('page errors:', errs.length ? errs.join(' | ') : '无');
  await p.screenshot({ path: require('path').join(__dirname, 'shots', '20_dash_optbadge.png'), fullPage: false });
  await b.close();
  process.exit(info.badgeExists && info.decodeGaugeHasBadge && !errs.length ? 0 : 1);
})();
