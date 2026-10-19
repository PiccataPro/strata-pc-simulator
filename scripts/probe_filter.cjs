/* 分级筛选菜单 UI 探针：真点击 chips，验证级联显隐/过滤命中/取消清深层/mismatch 置灰/动态去重。
   用法：node scripts/probe_filter.cjs [baseUrl]
   货架 DOM：#shelfL=[cpu,mobo,ram,gpu]，#shelfR=[ssd,psu,cooler,case]（CATS 顺序对半）
   断言数字来自 node 直查 parts.js：CPU 28(Intel12/AMD16)、GPU 23(AMD5)、mismatch 板11/条5。 */
'use strict';
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
  await p.goto(BASE + '/dist/strata-pc-simulator.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2500));

  /* 取某品类区块：h3 标题之后的 frow/part 直到下个 h3 */
  const sec = (shelf, idx) => p.evaluate((shelf, idx) => {
    const hs = [...document.querySelector(shelf).querySelectorAll('h3')];
    const h = hs[idx];
    const rows = [], parts = [];
    for (let el = h.nextElementSibling; el && el.tagName !== 'H3'; el = el.nextElementSibling) {
      if (el.classList.contains('frow')) rows.push([...el.querySelectorAll('.chip')].map(x => x.textContent));
      if (el.classList.contains('part')) parts.push({ id: el.dataset.id, mm: el.classList.contains('mismatch'), txt: el.textContent });
    }
    return { rows, parts, fcnt: (h.querySelector('.fcnt') || {}).textContent };
  }, shelf, idx);
  const clickChip = (shelf, idx, row, label) => p.evaluate((shelf, idx, row, label) => {
    const hs = [...document.querySelector(shelf).querySelectorAll('h3')];
    const rows = [];
    for (let el = hs[idx].nextElementSibling; el && el.tagName !== 'H3'; el = el.nextElementSibling)
      if (el.classList.contains('frow')) rows.push(el);
    if (!rows[row]) return 'NO_ROW';
    const chip = [...rows[row].querySelectorAll('.chip')].find(x => x.textContent === label);
    if (!chip) return 'NO_CHIP:' + label;
    chip.click(); return 'OK';
  }, shelf, idx, row, label);

  /* ---- CPU 货架（#shelfL h3[0]）：品牌→平台→代系→档位 四级级联 ---- */
  let s = await sec('#shelfL', 0);
  T('CPU 初始只有品牌行（级联隐藏下级）', s.rows.length === 1 && s.rows[0][0] === '全部', s.rows);
  T('CPU 品牌行含 Intel/AMD', s.rows[0].includes('Intel') && s.rows[0].includes('AMD'), s.rows[0]);
  T('CPU 全量=28', s.parts.length === 28, s.parts.length);

  await clickChip('#shelfL', 0, 0, 'Intel');
  s = await sec('#shelfL', 0);
  T('选 Intel 后平台行出现', s.rows.length === 2, s.rows.map(r => r.length));
  T('Intel 过滤命中 12 款', s.parts.length === 12, s.parts.length);

  await clickChip('#shelfL', 0, 1, 'LGA1700');
  s = await sec('#shelfL', 0);
  T('选 LGA1700 后代系行出现', s.rows.length === 3, s.rows.map(r => r.length));
  T('LGA1700 命中 12 款', s.parts.length === 12, s.parts.length);

  await clickChip('#shelfL', 0, 2, '13代');
  s = await sec('#shelfL', 0);
  T('选 13代 后档位行出现', s.rows.length === 4, s.rows.map(r => r.length));
  T('13代 命中 4 款(13400F/13600KF/13700KF/13900KF)', s.parts.length === 4, s.parts.map(x => x.id));

  await clickChip('#shelfL', 0, 3, 'i5');
  s = await sec('#shelfL', 0);
  T('i5 命中 2 款(13400F/13600KF)', s.parts.length === 2 && s.parts.every(x => /13[46]00/.test(x.id)), s.parts.map(x => x.id));
  T('计数显示 2/28', s.fcnt === '2/28', s.fcnt);

  await clickChip('#shelfL', 0, 3, 'i5');   // 再点=取消本级
  s = await sec('#shelfL', 0);
  T('取消 i5 恢复 13代 4 款', s.parts.length === 4, s.parts.length);
  T('取消后档位行仍在（上级仍选中）', s.rows.length === 4, s.rows.map(r => r.length));

  await clickChip('#shelfL', 0, 0, 'AMD');  // 换品牌=清深层
  s = await sec('#shelfL', 0);
  T('切 AMD 深层清空只剩平台行', s.rows.length === 2, s.rows.map(r => r.length));
  T('AMD 命中 16 款', s.parts.length === 16, s.parts.length);

  /* ---- 显卡货架（#shelfL h3[3]）：A卡/N卡 分流 ---- */
  s = await sec('#shelfL', 3);
  T('GPU 初始 23 款', s.parts.length === 23, s.parts.length);
  await clickChip('#shelfL', 3, 0, 'A 卡');
  s = await sec('#shelfL', 3);
  T('A 卡命中 5 款', s.parts.length === 5, s.parts.map(x => x.id));
  T('A 卡规格行带 Vulkan 标注', s.parts.every(x => x.txt.includes('A卡(Vulkan)')), s.parts[0] && s.parts[0].txt.slice(0, 80));
  await clickChip('#shelfL', 3, 0, '全部');
  s = await sec('#shelfL', 3);
  T('全部恢复 23 款', s.parts.length === 23, s.parts.length);

  /* ---- 主板 mismatch：默认 CPU=i7-12700KF(LGA1700)，非 LGA1700 板应置灰 ---- */
  s = await sec('#shelfL', 1);
  const mmIds = s.parts.filter(x => x.mm).map(x => x.id);
  T('主板 mismatch 置灰 11 款且不含现机板', mmIds.length === 11 && !mmIds.includes('z790-gaming-plus'), mmIds);

  /* ---- 内存 mismatch：默认主板 DDR5，DDR4 条应置灰 ---- */
  s = await sec('#shelfL', 2);
  const ramMm = s.parts.filter(x => x.mm).map(x => x.id);
  T('内存 DDR4(5款) 对 DDR5 主板置灰', ramMm.length === 5 && ramMm.every(x => x.startsWith('d4-')), ramMm);

  /* ---- 动态去重：选 DDR5 后容量行不应出现 8G（8G 仅 DDR4 有货）---- */
  await clickChip('#shelfL', 2, 0, '5');
  s = await sec('#shelfL', 2);
  const sizeRow = s.rows[1] || [];
  T('DDR5 容量行动态去重（无 8G，含 16G/32G）', !sizeRow.includes('8G') && sizeRow.includes('16G') && sizeRow.includes('32G'), sizeRow);
  T('DDR5 命中 8 款', s.parts.length === 8, s.parts.length);

  console.log('\nerrors:', errs.length ? errs.join(' | ') : '无');
  console.log('===== probe_filter: ' + pass + ' PASS / ' + fail + ' FAIL =====');
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
