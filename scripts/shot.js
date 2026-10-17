/* 无头验证 + 截图（Edge + SwiftShader 软件渲染，零 GPU 占用）
 * 用法：node scripts/shot.js [baseUrl]  默认 http://127.0.0.1:8901
 * 产出：scripts/shots/*.png + console 错误汇总，退出码非 0 = 有 JS 错误 */
'use strict';
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const BASE = process.argv[2] || 'http://127.0.0.1:8901';
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu', '--window-size=1440,900', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  page.on('requestfailed', r => { if (!/favicon/.test(r.url())) errors.push('[404?] ' + r.url() + ' ' + (r.failure() || {}).errorText); });

  /* 1. 3D 视图 + 自动开机 */
  await page.goto(BASE + '/dist/strata-pc-simulator.html?3d&boot', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000)); // 等 GLB 异步加载 + 装配动画
  await page.screenshot({ path: path.join(OUT, '01_3d_booting.png') });
  await new Promise(r => setTimeout(r, 9000)); // 等 boot 完成进入 run（cables 2.6s + 各段 sleep + prefill）
  await page.screenshot({ path: path.join(OUT, '02_3d_running.png') });

  /* 2. 停机按钮存在且可点 */
  const btnTxt = await page.$eval('#bootBtn', el => el.textContent);
  console.log('bootBtn 文本（运行中应为“停止”）:', btnTxt);
  await page.click('#bootBtn');
  await new Promise(r => setTimeout(r, 1200));
  const btnTxt2 = await page.$eval('#bootBtn', el => el.textContent);
  console.log('点击后（应回到 启动/未就绪）:', btnTxt2);
  await page.screenshot({ path: path.join(OUT, '03_3d_stopped.png') });

  /* 3. 2D 视图：内存槽 A1A2B1B2 标注 + 空槽交互 */
  await page.goto(BASE + '/dist/strata-pc-simulator.html', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: path.join(OUT, '04_2d_ram_slots.png') });
  const slotLabels = await page.$$eval('.ramSlotEmpty', els => els.map(e => e.dataset.slot));
  const ramReadout = await page.$eval('#readouts', el => el.textContent.slice(0, 400));
  console.log('空槽数（默认16+32+16+32全满应为0）:', slotLabels.length);
  console.log('内存读数片段:', ramReadout.match(/内存[^｜]{0,80}/) ? ramReadout.match(/内存[^｜]{0,80}/)[0] : '(未找到)');

  /* 4. 拆一条内存 → 出现空槽 → 通道应变弹性/单通道 */
  await page.evaluate(() => { window.__build_test = true; });
  // 通过 2D 点击拆除太依赖 confirm，直接调内部函数
  await page.evaluate(() => { removePart('ram', 1); }); // 拆 A2
  await new Promise(r => setTimeout(r, 500));
  const chanTxt = await page.$eval('#readouts', el => el.textContent);
  console.log('拆A2后通道标注:', (chanTxt.match(/\d+G\s*(单通道|[0-9.]+通道)/) || ['(未匹配)'])[0]);
  await page.screenshot({ path: path.join(OUT, '05_2d_after_pull_A2.png') });

  /* 5. 空槽点击安装（stub confirm/prompt/alert） */
  await page.evaluate(() => { window.prompt = () => '1'; window.confirm = () => true; window.alert = () => {}; });
  const empty = await page.$('.ramSlotEmpty');
  if (empty) { await empty.click(); await new Promise(r => setTimeout(r, 400)); }
  const chanTxt2 = await page.$eval('#readouts', el => el.textContent);
  console.log('点空槽回填后:', (chanTxt2.match(/\d+G\s*(单通道|[0-9.]+通道)/) || ['(未匹配)'])[0]);
  await page.screenshot({ path: path.join(OUT, '06_2d_slot_refill.png') });

  /* 6. 双通道正确插法：只留 A1+B1（拆 A2 已做，再拆 B2=idx3） */
  await page.evaluate(() => { removePart('ram', 3); });
  await new Promise(r => setTimeout(r, 400));
  const chanTxt3 = await page.$eval('#readouts', el => el.textContent);
  console.log('A1+B1 跨通道:', (chanTxt3.match(/\d+G\s*(单通道|[0-9.]+通道)[^·]{0,20}/) || ['(未匹配)'])[0]);

  /* 7. 同通道插法：A1+A2（拆 B1=idx2，装回 A2=idx1）→ 应报单通道 */
  await page.evaluate(() => { removePart('ram', 2); install('d5-16-5600', 'ram', 1); });
  await new Promise(r => setTimeout(r, 400));
  const chanTxt4 = await page.$eval('#readouts', el => el.textContent);
  console.log('A1+A2 同通道:', (chanTxt4.match(/\d+G\s*(单通道|[0-9.]+通道)[^·]{0,30}/) || ['(未匹配)'])[0]);
  await page.screenshot({ path: path.join(OUT, '07_2d_same_channel.png') });

  await browser.close();
  console.log('\n===== console/page 错误 ' + errors.length + ' 条 =====');
  errors.slice(0, 20).forEach(e => console.log(e));
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
