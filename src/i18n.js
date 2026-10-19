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
      if (typeof window.syncBootLabels === 'function') window.syncBootLabels();
      if (typeof window.syncBenchBtn === 'function') window.syncBenchBtn();
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
      "27B Q4_K_M（16G, llama栈）": "27B Q4_K_M (16G, llama stack)",
      /* ---- 2026-10-19 扩库新增（含中文的配件名） ---- */
      "i7-14700（非K）": "i7-14700 (non-K)",
      "微星 MAG B660M MORTAR DDR4": "MSI MAG B660M MORTAR DDR4",
      "华硕 TUF GAMING Z790-PLUS WIFI": "ASUS TUF GAMING Z790-PLUS WIFI",
      "华硕 ROG STRIX Z790-A GAMING WIFI II": "ASUS ROG STRIX Z790-A GAMING WIFI II",
      "华擎 B450M Pro4": "ASRock B450M Pro4",
      "微星 MAG B550M MORTAR": "MSI MAG B550M MORTAR",
      "技嘉 X570 AORUS MASTER": "Gigabyte X570 AORUS MASTER",
      "微星 MAG B650 TOMAHAWK WIFI": "MSI MAG B650 TOMAHAWK WIFI",
      "技嘉 X670E AORUS MASTER": "Gigabyte X670E AORUS MASTER",
      "技嘉 X870E AORUS PRO ICE": "Gigabyte X870E AORUS PRO ICE",
      "超微 H11DSi（EPYC 双路）": "Supermicro H11DSi (dual EPYC)",
      "DDR4 16G 3600 马甲条": "DDR4 16G 3600 heatspreader",
      "DDR5 32G 6000 幻锋戟": "DDR5 32G 6000 Trident Z5",
      "DDR5 32G 6000 白色马甲": "DDR5 32G 6000 white heatspreader",
      "铠侠 RC20 500G": "Kioxia RC20 500G",
      "致态 TiPlus7100 2TB": "ZHITAI TiPlus7100 2TB",
      "三星 990 PRO 4TB": "Samsung 990 PRO 4TB",
      "致态 Ti600 8TB": "ZHITAI Ti600 8TB",
      "Solidigm P44 Pro 2TB Gen5": "Solidigm P44 Pro 2TB Gen5",
      "镁光 MX500 1TB SATA": "Micron MX500 1TB SATA",
      "Ultrastar HC550 16T 企业盘": "Ultrastar HC550 16T enterprise HDD",
      "酷冷 550W 白牌": "Cooler Master 550W 80+",
      "海盗船 CX650M 铜牌": "Corsair CX650M Bronze",
      "安钛克 750W 金牌": "Antec 750W Gold",
      "振华 LEADEX III 850W 金牌": "Super Flower LEADEX III 850W Gold",
      "海韵 FOCUS 1000W 白金": "Seasonic FOCUS 1000W Platinum",
      "酷冷 V2 1200W 金牌": "Cooler Master V2 1200W Gold",
      "海盗船 AX1200i 钛金（现机）": "Corsair AX1200i Titanium (current)",
      "海盗船 AX1600i 钛金": "Corsair AX1600i Titanium",
      "九州风神 AK620 双塔": "DeepCool AK620 (dual tower)",
      "240mm 一体水冷": "240mm AIO",
      "海景房（无柱全景）": "Fishbowl (pillarless panoramic)"
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
      "带3090(350W)+3080(370W)足够": "Enough for a 3090 (350W) + a 3080 (370W)",
      "4P8T 亮机神器，UHD730 核显可免独卡点亮": "4C/8T budget savior; the UHD730 iGPU lets it POST without a discrete GPU",
      "6P+4E/16T，F 无核显（亮机须独卡）": "6P+4E/16T; the F suffix has no iGPU (needs a discrete GPU to POST)",
      "13代性价比神U：6P+8E/20T；同属缩缸高压档，二手挑信誉": "The 13th-gen value king: 6P+8E/20T; also in the high-voltage degradation tier — buy used from reputable sellers",
      "8P+8E/24T；13/14代缩缸风险档": "8P+8E/24T; 13th/14th-gen degradation-risk tier",
      "13代旗舰，与14900KF同缩缸高压档": "13th-gen flagship, same high-voltage degradation tier as the 14900KF",
      "13600KF 马甲小改款": "A rebadged minor refresh of the 13600KF",
      "8P+12E/28T 带核显；K 版高压，缩缸风险高于非K": "8P+12E/28T with an iGPU; the K runs high voltage — higher degradation risk than non-K",
      "带 UHD770 核显可纯计算化；仍属高压缩缸档": "The UHD770 iGPU lets both GPUs stay compute-only; still in the high-degradation tier",
      "AM4 亮机卡：6C12T 无核显，配 B450/B550 极便宜": "AM4 budget pick: 6C/12T, no iGPU; B450/B550 boards are dirt cheap",
      "带 Vega7 核显可免独卡点亮；注意 5600G 直连只有 PCIe3.0": "Vega7 iGPU POSTs without a discrete GPU; note the 5600G's direct link is PCIe 3.0 only",
      "8C16T 65W，DDR4 平台省钱主力": "8C/16T at 65W — the budget DDR4 platform workhorse",
      "96MB 3D缓存——游戏神U，对 LLM 推理帮助有限": "96MB of 3D cache — a gaming legend; helps LLM inference only marginally",
      "12C24T 二手性价比；DDR4 双通道带宽是 expert 计算上限": "12C/24T used-market value; DDR4 dual-channel bandwidth caps the expert kernel",
      "AM5 入门 6C12T，AVX-512": "Entry AM5, 6C/12T, AVX-512",
      "96MB 3D缓存游戏旗舰；LLM 场景与 7700 差距不大": "96MB 3D-cache gaming flagship; in LLM workloads it's barely ahead of the 7700",
      "16C32T Zen4，二手已低于 9950X": "16C/32T Zen 4; used units now cheaper than a 9950X",
      "Zen5 8C 低功耗档": "Zen 5 8-core low-power tier",
      "当前游戏最强U；LLM 推理吃 AVX-512 与带宽，3D 缓存加成有限": "The current best gaming CPU; LLM inference leans on AVX-512 and bandwidth, so the 3D cache adds little",
      "32C64T + 64 lane 直连：三卡好链路；Zen2 单核弱": "32C/64T with 64 direct lanes — great three-GPU links; Zen 2 single-core is weak",
      "12代+DDR4 省钱组合：第二槽芯片组 Gen3 x4（3.9GB/s）——双卡副卡比现板还慢一半": "12th-gen + DDR4 budget combo: slot 2 is chipset Gen3 x4 (3.9 GB/s) — the second GPU is slower than on the current board",
      "官网槽位表：PCIe5.0 x16（CPU）+ PCIe4.0 x16 皮 x4 芯（芯片组）——中端 Z790 通病，双卡照样 frac 0.18": "Per the spec page: PCIe 5.0 x16 (CPU) plus a PCIe 4.0 x16-length slot that is electrically x4 (chipset) — a mid-range Z790 habit; dual GPUs still frac 0.18",
      "白色板颜值担当；第二槽仍是芯片组 x4——买 ROG 也不等于双卡好链路": "The white-board beauty pick; slot 2 is still chipset x4 — an ROG badge doesn't buy you a good dual-GPU link",
      "AM4 白菜板：只有 1 个 x16 电气槽——双卡？这块板没有这个功能": "Cheap AM4 board: just one electrically x16 slot — dual GPUs? This board simply doesn't have that feature",
      "第二槽芯片组 Gen3 x4；官方手册：M2_2 装盘后 PCI_E4 整槽失效——双卡+双M.2 直接少一个槽": "Slot 2 is chipset Gen3 x4; per the manual, populating M2_2 kills PCI_E4 entirely — dual GPUs plus two M.2s costs you a whole slot",
      "AM4 双卡正解：CPU 直连 x16/x8 拆分 Gen4（双卡各 x8≈15.7GB/s→frac 0.5）；二手¥1,200-1,600": "The right AM4 dual-GPU answer: CPU-attached x16/x8 Gen4 bifurcation (about 15.7 GB/s each → frac 0.5). Used ¥1,200-1,600",
      "新式坑：第二槽物理 x16 大长槽，电气只有芯片组 x2（3.9GB/s→frac 0.12）——槽长骗眼睛，规格页才说实话": "A modern trap: slot 2 looks like a full-length x16 but is electrically chipset x2 (3.9 GB/s → frac 0.12) — slot length fools the eye, only the spec page tells the truth",
      "反直觉实证：旗舰 X670E 也不给双 x8——官网槽位表第二槽=芯片组 x4。买前必看规格页，别拿芯片组等级猜槽位": "Counter-intuitive proof: even the flagship X670E keeps slot 2 on the chipset (x4). Read the spec page before buying — never infer lanes from the chipset tier",
      "冰雕白色平台；官方手册新坑：M2B/M2C 装盘 → 第一槽 x16→x8（和 ProArt 反向：这次是主卡槽被 M.2 抢带宽）": "The white Ice-sculpture platform; a new trap per the manual: populating M2B/M2C drops slot 1 from x16 to x8 — the reverse of the ProArt: here the M.2 steals the primary GPU's bandwidth",
      "EPYC 神板：2×x16+3×x8 全 CPU 直连（Gen3）、8通道 RECC 内存白菜价；服务器无核显需 BMC 输出、风扇吵": "The EPYC legend board: 2x16 + 3x8 all CPU-attached (Gen3) with dirt-cheap 8-channel RECC memory; servers have no iGPU (video out via BMC) and the fans are loud",
      "亮机条；单条只跑单通道，LLM 场景带宽致命": "A cheap POST stick; one stick runs single-channel — fatal bandwidth-wise for LLM workloads",
      "Ripjaws V：AM4 甜点频率（Infinity Fabric 1:1 上限附近）": "Ripjaws V: the AM4 sweet-spot speed (right at the Infinity Fabric 1:1 limit)",
      "JEDEC 裸条无马甲：AM5 四条也能稳 4800（降频惩罚最小的选择）": "JEDEC bare sticks, no heatspreader: even four hold 4800 on AM5 — the lowest downclock penalty you can buy",
      "Trident Z5：AM5 甜点 6000（1:1 UCLK=MCLK 上限附近）": "Trident Z5: the AM5 sweet spot at 6000 (near the UCLK=MCLK 1:1 limit)",
      "复仇者 RGB 白：白色主题装机用": "Vengeance RGB White — for white-themed builds",
      "单条64G：两条=128G 双通道不降频——96G 之外的大内存新路线": "Single 64G stick: two make 128G dual-channel without downclocking — the big-RAM path beyond 96G",
      "服务器拆机 RECC：EPYC/TR 板 8 通道堆容量白菜价；普通桌面板不兼容 ECC UDIMM 之外规格": "Server-pull RECC: on EPYC/TR boards, 8 channels stack capacity for pennies; ordinary desktop boards take nothing beyond ECC UDIMMs",
      "Gen4 入门带缓：亮机盘": "Entry Gen4 with an SLC cache — a fine boot drive",
      "单盘 8T：全模型库+数据集一盘点": "8TB on one drive: the whole model library plus datasets in a single bay",
      "Gen5 盘发热大：主板自带马甲或加散热片，否则掉速": "Gen5 drives run hot: use the board's heatspreader or add a heatsink, or they throttle",
      "SATA SSD：550MB/s 够冷数据，流式权重会卡": "SATA SSD: 550 MB/s is fine for cold data; streaming weights will stutter",
      "矿渣企业盘 16T：便宜大碗但吵+振动；放数据集可以，别放权重": "16TB ex-mining enterprise drives: cheap and huge but loud and buzzy — fine for datasets, keep weights off them",
      "单卡 650 级以下够用；双卡别碰": "Enough for a single card up to the 650W class; don't even try dual GPUs",
      "双 3090/3080 组合的平价答案": "The budget-friendly answer for a dual 3090/3080 build",
      "中塔顶置兼容性好；解热略强于双塔风冷": "Good top-mount compatibility in mid-towers; cools slightly better than a dual-tower air cooler",
      "双面玻璃展示柜：3D 侧透观感最好，积热靠风扇数量补": "A double-sided glass display case: the best panoramic view in 3D; you make up for the heat with extra fans"
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
