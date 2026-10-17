/* 验证：默认 2D 页面可见「切到 3D」按钮，点击后真的进入 3D（零 GPU，SwiftShader） */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const OUT = __dirname + '/shots';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: 'new',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu', '--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:8901/dist/strata-pc-simulator.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000));

  // 1. 默认 2D：按钮存在且可见？
  const vis2d = await page.evaluate(() => {
    const b = document.getElementById('btnView');
    if (!b) return { ok: false, why: '按钮不存在' };
    const r = b.getBoundingClientRect();
    const st = getComputedStyle(b);
    const inBar = b.closest('#viewBar') === document.getElementById('viewBar');
    const barVisible = document.getElementById('viewBar').offsetParent !== null;
    return { ok: r.width > 0 && r.height > 0 && st.display !== 'none' && st.visibility !== 'hidden' && barVisible, text: b.textContent, rect: { w: Math.round(r.width), h: Math.round(r.height) }, inBar };
  });
  console.log('2D模式按钮可见:', JSON.stringify(vis2d));
  await page.screenshot({ path: OUT + '/10_2d_with_toggle.png' });

  // 2. 点击切到 3D
  await page.click('#btnView');
  await new Promise(r => setTimeout(r, 6000));
  const st3d = await page.evaluate(() => {
    const c3 = document.getElementById('case3d');
    const svg = document.getElementById('caseSVG');
    const b = document.getElementById('btnView');
    const canvas = c3.querySelector('canvas');
    return {
      case3dVisible: getComputedStyle(c3).display !== 'none',
      svgHidden: getComputedStyle(svg).display === 'none',
      btnText: b.textContent,
      hasCanvas: !!canvas,
      glb: window.STRATA_3D && window.STRATA_3D.debugState ? window.STRATA_3D.debugState().glbLoaded : null,
    };
  });
  console.log('点击后3D状态:', JSON.stringify(st3d));
  await page.screenshot({ path: OUT + '/11_3d_after_toggle.png' });

  // 3. 再点回 2D
  await page.click('#btnView');
  await new Promise(r => setTimeout(r, 1500));
  const back2d = await page.evaluate(() => ({
    svgVisible: getComputedStyle(document.getElementById('caseSVG')).display !== 'none',
    case3dHidden: getComputedStyle(document.getElementById('case3d')).display === 'none',
    btnText: document.getElementById('btnView').textContent,
  }));
  console.log('切回2D:', JSON.stringify(back2d));

  console.log('页面错误:', errs.length ? errs.slice(0, 3).join(' | ') : '无');
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
