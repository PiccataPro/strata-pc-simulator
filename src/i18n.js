/* ---- 中英双语 ----
 * 设计取舍：不用 key 字典，直接写「中文, English」两句。
 *   1) 改动点就在字符串原地，漏翻一眼能看见；
 *   2) 少一层 key 映射，就不存在"key 写错 → 界面显示 key"的故障；
 *   3) 静态 HTML 用 data-zh / data-en 属性，动态文案用 L('中文','English')。
 * 语言状态放在 window.STRATA_LANG，parts.js / sim.js 也读它（Node 里跑测试时自动回落中文）。
 *
 * 切换语言 = applyStaticLang() + 重渲染（货架/状态/仪表盘/2D 图）。3D 画面无文字，不用重建。
 */
(function () {
  'use strict';
  const KEY = 'strata.lang';
  let lang = new URLSearchParams(location.search).get('lang') || localStorage.getItem(KEY) || 'zh';
  if (lang !== 'en' && lang !== 'zh') lang = 'zh';
  window.STRATA_LANG = lang;

  /* 动态文案助手：英文缺失时回落中文，绝不渲染成空 */
  window.L = function (zh, en) { return (window.STRATA_LANG === 'en' && en != null) ? en : zh; };

  function applyStaticLang() {
    document.documentElement.lang = window.STRATA_LANG === 'en' ? 'en' : 'zh-CN';
    document.querySelectorAll('[data-zh]').forEach(el => {
      const txt = window.STRATA_LANG === 'en' ? (el.dataset.en != null ? el.dataset.en : el.dataset.zh) : el.dataset.zh;
      if (el.dataset.html != null) el.innerHTML = txt; else el.textContent = txt;
    });
    document.querySelectorAll('[data-zh-title]').forEach(el => {
      el.title = window.STRATA_LANG === 'en' ? (el.dataset.enTitle || el.dataset.zhTitle) : el.dataset.zhTitle;
    });
    document.querySelectorAll('[data-zh-ph]').forEach(el => {
      el.placeholder = window.STRATA_LANG === 'en' ? (el.dataset.enPh || el.dataset.zhPh) : el.dataset.zhPh;
    });
  }

  /* 语言切换后要重画的东西：都是纯函数渲染，重跑一次即可 */
  function rerender() {
    try {
      if (typeof window.renderShelves === 'function') window.renderShelves();
      if (typeof window.onChange === 'function') window.onChange();
      else if (typeof window.renderDash === 'function') window.renderDash();
      if (typeof window.applyView === 'function') window.applyView();
      if (typeof window.mark3dState === 'function') window.mark3dState();
      if (typeof window.setLangHooks === 'function') window.setLangHooks();
    } catch (e) { console.error('lang rerender', e); }
  }

  function markSwitch() {
    document.querySelectorAll('#langSwitch button').forEach(b => {
      const on = b.dataset.lang === window.STRATA_LANG;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  window.setLang = function (l) {
    if (l !== 'en' && l !== 'zh') return;
    if (l === window.STRATA_LANG) { markSwitch(); return; }
    window.STRATA_LANG = l;
    try { localStorage.setItem(KEY, l); } catch (e) { }
    applyStaticLang();
    markSwitch();
    rerender();
  };
  window.applyStaticLang = applyStaticLang;


  /* 部件名与备注的英文对照：整串精确匹配，匹配不到就原样返回（宁可留中文，也不会把别的字误替换） */
  const NAME_EN = {
      "i7-14700（非K）": "i7-14700 (non-K)",
      "微星 Z790 GAMING PLUS WIFI": "MSI Z790 GAMING PLUS WIFI",
      "华擎 Z790 Taichi": "ASRock Z790 Taichi",
      "微星 MEG Z790 ACE": "MSI MEG Z790 ACE",
      "微星 B760M 迫击炮": "MSI B760M Mortar",
      "华硕 ROG X670E-E GAMING": "ASUS ROG X670E-E GAMING",
      "华硕 ProArt X870E-CREATOR": "ASUS ProArt X870E-CREATOR",
      "微星 B650M PRO": "MSI B650M PRO",
      "TRX40（线程撕裂者）": "TRX40 (Threadripper)",
      "RTX 3080 20G 魔改": "RTX 3080 20G (modded)",
      "RTX 2080 Ti 22G 魔改": "RTX 2080 Ti 22G (modded)",
      "致态 Ti600 1TB NVMe": "ZHITAI Ti600 1TB NVMe",
      "三星 SN850X 2TB": "Samsung SN850X 2TB",
      "致态 TiPro7100 4TB": "ZHITAI TiPro7100 4TB",
      "西数 HC430 4TB 机械盘": "WD HC430 4TB HDD",
      "750W 金牌": "750W Gold",
      "850W 金牌": "850W Gold",
      "1000W 白金": "1000W Platinum",
      "1250W 钛金（现机）": "1250W Titanium (current)",
      "1600W 钛金": "1600W Titanium",
      "利民 AX120 单塔": "Thermalright AX120 (single tower)",
      "利民 PA120 SE 双塔": "Thermalright PA120 SE (dual tower)",
      "360mm 一体水冷（现机）": "360mm AIO (current)",
      "猫头鹰 NH-D15": "Noctua NH-D15",
      "中塔（3前进风扇）": "Mid tower (3 front fans)",
      "全塔（7风扇风道）": "Full tower (7-fan airflow)",
      "IQ3_S 125B（现用, 79G）": "IQ3_S 125B (current, 79G)",
      "UD-Q4_K_XL 125B（huihui破限, 104G）": "UD-Q4_K_XL 125B (huihui uncensored, 104G)",
      "27B Q4_K_M（16G, llama栈）": "27B Q4_K_M (16G, llama stack)"
  };
  const NOTE_EN = {
      "6P无E核，并发弱；带核显": "6P, no E-cores — weak concurrency; has an iGPU",
      "现机U。8P+4E/20T，无核显（亮机须独卡）": "The current CPU. 8P+4E/20T, no iGPU (needs a discrete GPU to POST)",
      "方案E核心：8P+12E/28T，UHD770核显输出→双卡纯计算；非K 65W档缩缸风险最低，BIOS须含0x129/0x12B微码": "Plan E pick: 8P+12E/28T, UHD770 drives the display so both GPUs stay compute-only. Non-K 65W has the lowest degradation risk; BIOS must include microcode 0x129/0x12B",
      "13/14代缩缸高压档，二手风险高。贩子集体拒收13/14代i9（NGA 10-07），二手压价": "13th/14th gen run high voltage and degrade; used units are risky. Resellers stopped buying 13/14-gen i9s (NGA, Oct 7), so prices collapsed",
      "AM5入门，AVX-512": "Entry AM5, AVX-512",
      "12C24T AVX-512": "12C/24T, AVX-512",
      "方案F核心：16C32T，AVX-512激活Strata expert kernel（官方口径 a bit faster），无缩缸史，AM5可续Zen6。闲鱼/散片~¥2,500（头条10月AM5指南口径）": "Plan F pick: 16C/32T, AVX-512 unlocks the Strata expert kernel (slightly faster per the docs), no degradation history, AM5 can upgrade to Zen 6. Tray CPUs ~¥2,500 on Xianyu (Oct AM5 guide)",
      "官方bench反证机：无AVX-512纯AVX2，双3090照样64-78 t/s——CPU不是瓶颈": "Counter-example from the official bench: AVX2 only, no AVX-512, and dual 3090s still hit 64-78 t/s — the CPU is not the bottleneck",
      "现板。只有2个卡位；第二槽=芯片组x4（6.6GB/s→frac0.18），双卡必踩坑": "The current board. Only two usable slots; slot 2 is chipset x4 (6.6 GB/s → frac 0.18), so dual GPUs walk straight into the trap",
      "方案E/D配套：双卡 CPU直连 x8/x8 Gen5（各31.5GB/s→frac满分）；二手¥1,800-2,400": "Pairs with plans D/E: dual GPUs on CPU-attached x8/x8 Gen5 (31.5 GB/s each → full frac). Used ¥1,800-2,400",
      "同Taichi：x8/x8 CPU直连；二手¥2,000-2,600": "Same as the Taichi: x8/x8 CPU-attached. Used ¥2,000-2,600",
      "性价比板但双卡第二槽=芯片组x4 Gen3（3.9GB/s，比现板还慢一半）": "Good value, but the second slot is chipset x4 Gen3 (3.9 GB/s — half the speed of the current board)",
      "方案F核心：X670E/X870E才有CPU直连x8/x8第二槽——普通B650/B850第二槽是芯片组x4（同现板坑）": "Plan F pick: only X670E/X870E give you a CPU-attached x8/x8 second slot — B650/B850 slot 2 is chipset x4 (same trap as the current board)",
      "隐藏坑：装第二个M.2后第二槽x8→x4（装机模拟器专门复现这个bug给你看）": "Hidden trap: installing a second M.2 drops slot 2 from x8 to x4 (the simulator reproduces this for you)",
      "AMD也有坑板：第二槽芯片组x4——\"AMD大多支持双x8+x8\"是误解，只有E级板才是": "AMD boards have the same trap: slot 2 on the chipset. \"Most AMD boards do x8/x8\" is a myth — only the E-class chipsets do",
      "HEDT：三卡x16/x16/x8全CPU直连，但DDR4平台+EPYC/TR贵、单核弱": "HEDT: three cards at x16/x16/x8, all CPU-attached — but DDR4 platform, pricey TR/EPYC parts and weak single-core",
      "DDR4合约价+24%三个月，华强北新条最低600+": "DDR4 contract prices +24% in three months; new sticks start at ¥600+ in Huaqiangbei",
      "全新已~¥900（百脑汇10月），二手略低": "New ~¥900 (Buynow, Oct); used slightly less",
      "现机同款——96G=16+32+16+32 混插，可平移AM5。⚠2026-10内存史诗级涨价：二手32G涨过二手显卡（smzdm 10-12）": "Same kit as the current build — 96G as 16+32+16+32, reusable on AM5. Note the late-2026 RAM spike: used 32G costs more than a used GPU (SMZDM, Oct 12)",
      "本机C:/G:同款×2——权重流式读不构成瓶颈（实测2.3GB/s SLC内）": "Same as this machine's C:/G: drives — streaming weights is not the bottleneck (2.3 GB/s measured, SLC-resident)",
      "D:/E:同款——机械盘勿放模型热文件（175MB/s会卡权重流式）": "Same as D:/E: — never put hot model files on a spinning disk (175MB/s stalls weight streaming)",
      "带3090(350W)+3080(370W)足够": "Enough for a 3090 (350W) + a 3080 (370W)"
  };
  /* 显示用：英文模式下查表，中文模式原样 */
  window.DN = function (txt) {
    if (txt == null) return '';
    if (window.STRATA_LANG !== 'en') return txt;
    return NAME_EN[txt] || NOTE_EN[txt] || txt;
  };

  document.addEventListener('DOMContentLoaded', function () {
    applyStaticLang();
    markSwitch();
    const sw = document.getElementById('langSwitch');
    if (sw) sw.addEventListener('click', e => {
      const b = e.target.closest('button[data-lang]');
      if (b) { e.stopPropagation(); window.setLang(b.dataset.lang); }
    });
  });
})();
