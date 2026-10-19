/* ============================================================
 * Strata 装机模拟器 — 配件数据库 + 兼容性/装配矩阵
 * 数据依据（2026-10-17）：
 *  - 本机实测：Q4调优报告、strata-ud-q4_k_xl 压测（2026-10-16）、refs/hardware-strata.md
 *  - Strata 官方：docs/DETAILS.md（PCIe 自动探测 24.3GB/s→frac0.55 / 6.6GB/s→frac0.18；
 *    issue #448 槽位警告；AVX-512 "a bit faster"；AVX-VNNI +4-25%）
 *  - 官方社区 bench：2x PRO 4500（issue#776 batch）、rtx3090-epyc-milan、issue #498 双24G
 *  - 闲鱼 2026-10-16 行情（vramglass + 实地成交价）
 *  - 2026-10-17 复核二手成交价：内存史诗级涨价（DRAM合约价环比+93%，二手DDR5 32G涨过二手显卡，
 *    smzdm/搜狐/头条 10月报道）；CPU按getpcparts/aiqicha/头条AM5指南校准；散热/机箱二手不受存储涨价影响
 * ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.STRATA_PARTS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  /* 诊断文案双语：Node（test.js）里没有 window，自动回落中文，锚点断言不受影响 */
  const L = (zh, en) => (typeof window !== 'undefined' && window.L) ? window.L(zh, en) : zh;

  const GBPS_PER_LANE = { 3: 0.985, 4: 1.969, 5: 3.94 }; // GB/s per PCIe lane（有效载荷）

  /* ---------------- CPU ----------------
   * thr=逻辑线程; simd: 512=AVX-512, vnni=AVX-VNNI, avx2=纯AVX2
   * igpu: 'none' 无核显 / 型号（可承担桌面输出→独卡纯计算化）
   * lanes/gen: CPU 直连 PCIe；chipsetLanes: 芯片组附加通道
   * price: 闲鱼/散片 2026-10 参考（元）
   * 分级字段（货架筛选菜单用）：brand=品牌 / platform=平台（主板 socket 同词配对）
   * gen=产品代系标签（Intel 12~14代、AMD Zen3/Zen4/Zen5、EPYC Milan）/ tier=档位 */
  const cpus = [
    /* Intel LGA1700（12/13/14 代，DDR4/DDR5 双支持按板） */
    { id:'i3-12100',    cat:'cpu', name:'i3-12100',              brand:'Intel', platform:'LGA1700', gen:'12代', tier:'i3',  socket:'LGA1700', p:4,  pt:8,  e:0,  et:0,  thr:8,  simd:'vnni', igpu:'UHD730',        pcie:{lanes:16, gen:5}, ddr:['4','5'], memMax:128, tdp:60,  pl2:89,   price:420,  note:'4P8T 亮机神器，UHD730 核显可免独卡点亮' },
    { id:'i5-12400',    cat:'cpu', name:'i5-12400',              brand:'Intel', platform:'LGA1700', gen:'12代', tier:'i5',  socket:'LGA1700', p:6,  pt:12, e:0,  et:0,  thr:12, simd:'vnni', igpu:'UHD730',        pcie:{lanes:16, gen:5}, ddr:['4','5'], memMax:128, tdp:65,  pl2:117,  price:600,  note:'6P无E核，并发弱；带核显' },
    { id:'i5-13400F',   cat:'cpu', name:'i5-13400F',             brand:'Intel', platform:'LGA1700', gen:'13代', tier:'i5',  socket:'LGA1700', p:6,  pt:12, e:4,  et:4,  thr:16, simd:'vnni', igpu:'none',          pcie:{lanes:16, gen:5}, ddr:['4','5'], memMax:128, tdp:65,  pl2:148,  price:800,  note:'6P+4E/16T，F 无核显（亮机须独卡）' },
    { id:'i5-13600KF',  cat:'cpu', name:'i5-13600KF',            brand:'Intel', platform:'LGA1700', gen:'13代', tier:'i5',  socket:'LGA1700', p:6,  pt:12, e:8,  et:8,  thr:20, simd:'vnni', igpu:'none',          pcie:{lanes:16, gen:5}, ddr:['4','5'], memMax:128, tdp:125, pl2:181,  price:1250, note:'13代性价比神U：6P+8E/20T；同属缩缸高压档，二手挑信誉' },
    { id:'i7-12700KF',  cat:'cpu', name:'i7-12700KF',            brand:'Intel', platform:'LGA1700', gen:'12代', tier:'i7',  socket:'LGA1700', p:8,  pt:16, e:4,  et:4,  thr:20, simd:'vnni', igpu:'none',          pcie:{lanes:16, gen:5}, ddr:['4','5'], memMax:128, tdp:125, pl2:190,  price:1400, note:'现机U。8P+4E/20T，无核显（亮机须独卡）' },
    { id:'i7-13700KF',  cat:'cpu', name:'i7-13700KF',            brand:'Intel', platform:'LGA1700', gen:'13代', tier:'i7',  socket:'LGA1700', p:8,  pt:16, e:8,  et:8,  thr:24, simd:'vnni', igpu:'none',          pcie:{lanes:16, gen:5}, ddr:['4','5'], memMax:128, tdp:125, pl2:253,  price:1750, note:'8P+8E/24T；13/14代缩缸风险档' },
    { id:'i9-13900KF',  cat:'cpu', name:'i9-13900KF',            brand:'Intel', platform:'LGA1700', gen:'13代', tier:'i9',  socket:'LGA1700', p:8,  pt:16, e:16, et:16, thr:32, simd:'vnni', igpu:'none',          pcie:{lanes:16, gen:5}, ddr:['4','5'], memMax:128, tdp:125, pl2:253,  price:2000, note:'13代旗舰，与14900KF同缩缸高压档' },
    { id:'i5-14600KF',  cat:'cpu', name:'i5-14600KF',            brand:'Intel', platform:'LGA1700', gen:'14代', tier:'i5',  socket:'LGA1700', p:6,  pt:12, e:8,  et:8,  thr:20, simd:'vnni', igpu:'none',          pcie:{lanes:16, gen:5}, ddr:['4','5'], memMax:128, tdp:125, pl2:181,  price:1450, note:'13600KF 马甲小改款' },
    { id:'i7-14700K',   cat:'cpu', name:'i7-14700K',             brand:'Intel', platform:'LGA1700', gen:'14代', tier:'i7',  socket:'LGA1700', p:8,  pt:16, e:12, et:12, thr:28, simd:'vnni', igpu:'UHD770',        pcie:{lanes:16, gen:5}, ddr:['4','5'], memMax:128, tdp:125, pl2:253,  price:2350, note:'8P+12E/28T 带核显；K 版高压，缩缸风险高于非K' },
    { id:'i7-14700',    cat:'cpu', name:'i7-14700（非K）',        brand:'Intel', platform:'LGA1700', gen:'14代', tier:'i7',  socket:'LGA1700', p:8,  pt:16, e:12, et:12, thr:28, simd:'vnni', igpu:'UHD770',        pcie:{lanes:16, gen:5}, ddr:['4','5'], memMax:128, tdp:65,  pl2:212,  price:2100, note:'方案E核心：8P+12E/28T，UHD770核显输出→双卡纯计算；非K 65W档缩缸风险最低，BIOS须含0x129/0x12B微码' },
    { id:'i9-14900K',   cat:'cpu', name:'i9-14900K',             brand:'Intel', platform:'LGA1700', gen:'14代', tier:'i9',  socket:'LGA1700', p:8,  pt:16, e:16, et:16, thr:32, simd:'vnni', igpu:'UHD770',        pcie:{lanes:16, gen:5}, ddr:['4','5'], memMax:128, tdp:125, pl2:253,  price:2450, note:'带 UHD770 核显可纯计算化；仍属高压缩缸档' },
    { id:'i9-14900KF',  cat:'cpu', name:'i9-14900KF',            brand:'Intel', platform:'LGA1700', gen:'14代', tier:'i9',  socket:'LGA1700', p:8,  pt:16, e:16, et:16, thr:32, simd:'vnni', igpu:'none',          pcie:{lanes:16, gen:5}, ddr:['4','5'], memMax:128, tdp:125, pl2:253,  price:2200, note:'13/14代缩缸高压档，二手风险高。贩子集体拒收13/14代i9（NGA 10-07），二手压价' },
    /* AMD AM4（Zen3，DDR4 平台——内存涨价潮里的省钱路线） */
    { id:'r5-5600',     cat:'cpu', name:'Ryzen 5 5600',          brand:'AMD', platform:'AM4', gen:'Zen3', tier:'R5', socket:'AM4', p:6, pt:12, e:0, et:0, thr:12, simd:'avx2', igpu:'none',        pcie:{lanes:20, gen:4}, ddr:['4'], memMax:128, tdp:65,  pl2:76,   price:450,  note:'AM4 亮机卡：6C12T 无核显，配 B450/B550 极便宜' },
    { id:'r5-5600G',    cat:'cpu', name:'Ryzen 5 5600G',         brand:'AMD', platform:'AM4', gen:'Zen3', tier:'R5', socket:'AM4', p:6, pt:12, e:0, et:0, thr:12, simd:'avx2', igpu:'Vega 7',      pcie:{lanes:20, gen:3}, ddr:['4'], memMax:128, tdp:65,  pl2:88,   price:520,  note:'带 Vega7 核显可免独卡点亮；注意 5600G 直连只有 PCIe3.0' },
    { id:'r7-5700X',    cat:'cpu', name:'Ryzen 7 5700X',         brand:'AMD', platform:'AM4', gen:'Zen3', tier:'R7', socket:'AM4', p:8, pt:16, e:0, et:0, thr:16, simd:'avx2', igpu:'none',        pcie:{lanes:20, gen:4}, ddr:['4'], memMax:128, tdp:65,  pl2:76,   price:650,  note:'8C16T 65W，DDR4 平台省钱主力' },
    { id:'r7-5800X3D',  cat:'cpu', name:'Ryzen 7 5800X3D',       brand:'AMD', platform:'AM4', gen:'Zen3', tier:'R7', socket:'AM4', p:8, pt:16, e:0, et:0, thr:16, simd:'avx2', igpu:'none',        pcie:{lanes:20, gen:4}, ddr:['4'], memMax:128, tdp:105, pl2:110,  price:1050, note:'96MB 3D缓存——游戏神U，对 LLM 推理帮助有限' },
    { id:'r9-5900X',    cat:'cpu', name:'Ryzen 9 5900X',         brand:'AMD', platform:'AM4', gen:'Zen3', tier:'R9', socket:'AM4', p:12, pt:24, e:0, et:0, thr:24, simd:'avx2', igpu:'none',       pcie:{lanes:20, gen:4}, ddr:['4'], memMax:128, tdp:105, pl2:140,  price:1150, note:'12C24T 二手性价比；DDR4 双通道带宽是 expert 计算上限' },
    /* AMD AM5（Zen4/Zen5，DDR5，AVX-512） */
    { id:'r5-7600X',    cat:'cpu', name:'Ryzen 5 7600X',         brand:'AMD', platform:'AM5', gen:'Zen4', tier:'R5', socket:'AM5', p:6, pt:12, e:0, et:0, thr:12, simd:'512', igpu:'Radeon 610M',  pcie:{lanes:24, gen:5}, ddr:['5'], memMax:128, tdp:105, pl2:110,  price:900,  note:'AM5 入门 6C12T，AVX-512' },
    { id:'r7-7700',     cat:'cpu', name:'Ryzen 7 7700',          brand:'AMD', platform:'AM5', gen:'Zen4', tier:'R7', socket:'AM5', p:8, pt:16, e:0, et:0, thr:16, simd:'512', igpu:'Radeon 680M',  pcie:{lanes:24, gen:5}, ddr:['5'], memMax:192, tdp:65,  pl2:88,   price:1100, note:'AM5入门，AVX-512' },
    { id:'r7-7800X3D',  cat:'cpu', name:'Ryzen 7 7800X3D',       brand:'AMD', platform:'AM5', gen:'Zen4', tier:'R7', socket:'AM5', p:8, pt:16, e:0, et:0, thr:16, simd:'512', igpu:'Radeon 680M',  pcie:{lanes:24, gen:5}, ddr:['5'], memMax:128, tdp:120, pl2:162,  price:1850, note:'96MB 3D缓存游戏旗舰；LLM 场景与 7700 差距不大' },
    { id:'r9-7900X',    cat:'cpu', name:'Ryzen 9 7900X',         brand:'AMD', platform:'AM5', gen:'Zen4', tier:'R9', socket:'AM5', p:12, pt:24, e:0, et:0, thr:24, simd:'512', igpu:'Radeon 680M', pcie:{lanes:24, gen:5}, ddr:['5'], memMax:128, tdp:170, pl2:200,  price:1600, note:'12C24T Zen4' },
    { id:'r9-7950X',    cat:'cpu', name:'Ryzen 9 7950X',         brand:'AMD', platform:'AM5', gen:'Zen4', tier:'R9', socket:'AM5', p:16, pt:32, e:0, et:0, thr:32, simd:'512', igpu:'Radeon 680M', pcie:{lanes:24, gen:5}, ddr:['5'], memMax:128, tdp:170, pl2:230, price:2200, note:'16C32T Zen4，二手已低于 9950X' },
    { id:'r7-9700X',    cat:'cpu', name:'Ryzen 7 9700X',         brand:'AMD', platform:'AM5', gen:'Zen5', tier:'R7', socket:'AM5', p:8, pt:16, e:0, et:0, thr:16, simd:'512', igpu:'Radeon 680M',  pcie:{lanes:24, gen:5}, ddr:['5'], memMax:256, tdp:65,  pl2:88,   price:1600, note:'Zen5 8C 低功耗档' },
    { id:'r7-9800X3D',  cat:'cpu', name:'Ryzen 7 9800X3D',       brand:'AMD', platform:'AM5', gen:'Zen5', tier:'R7', socket:'AM5', p:8, pt:16, e:0, et:0, thr:16, simd:'512', igpu:'Radeon 680M',  pcie:{lanes:24, gen:5}, ddr:['5'], memMax:192, tdp:120, pl2:162,  price:2900, note:'当前游戏最强U；LLM 推理吃 AVX-512 与带宽，3D 缓存加成有限' },
    { id:'r9-9900X',    cat:'cpu', name:'Ryzen 9 9900X',         brand:'AMD', platform:'AM5', gen:'Zen5', tier:'R9', socket:'AM5', p:12, pt:24, e:0, et:0, thr:24, simd:'512', igpu:'Radeon 680M', pcie:{lanes:24, gen:5}, ddr:['5'], memMax:256, tdp:120, pl2:162,  price:1950, note:'12C24T AVX-512' },
    { id:'r9-9950X',    cat:'cpu', name:'Ryzen 9 9950X',         brand:'AMD', platform:'AM5', gen:'Zen5', tier:'R9', socket:'AM5', p:16, pt:32, e:0, et:0, thr:32, simd:'512', igpu:'Radeon 680M', pcie:{lanes:24, gen:5}, ddr:['5'], memMax:256, tdp:170, pl2:200, price:2500, note:'方案F核心：16C32T，AVX-512激活Strata expert kernel（官方口径 a bit faster），无缩缸史，AM5可续Zen6。闲鱼/散片~¥2,500（头条10月AM5指南口径）' },
    /* HEDT / 服务器 */
    { id:'tr-3970x',    cat:'cpu', name:'Ryzen TR 3970X',        brand:'AMD', platform:'TRX4', gen:'Zen2', tier:'线程撕裂者', socket:'TRX4', p:32, pt:64, e:0, et:0, thr:64, simd:'avx2', igpu:'aspeed', pcie:{lanes:64, gen:4}, ddr:['4'], memMax:256, tdp:280, pl2:320, price:3200, note:'32C64T + 64 lane 直连：三卡好链路；Zen2 单核弱' },
    { id:'epyc-7453',   cat:'cpu', name:'EPYC 7453（Milan）',    brand:'AMD', platform:'SP3', gen:'Milan', tier:'EPYC', socket:'SP3', p:28, pt:56, e:0, et:0, thr:56, simd:'avx2', igpu:'aspeed',   pcie:{lanes:128,gen:4}, ddr:['4'], memMax:2048,tdp:155, pl2:210, price:1600, note:'官方bench反证机：无AVX-512纯AVX2，双3090照样64-78 t/s——CPU不是瓶颈' },
  ];

  /* ---------------- 主板 ----------------
   * slots: 物理PCIe卡槽（pos=物理槽序, lanes=电气, src=cpu|chipset, gen）
   * 关键事实（实地拆机确认）：现板 Z790 GAMING PLUS 物理只有 2 个可用卡位，
   * 且第二槽走芯片组 x4 —— 这就是 4070S pcie_frac 0.18 的根因
   * m2Share: 通道共享坑（插M.2_x第二槽降x4）
   * 分级字段：brand=华硕/微星/技嘉… / platform=CPU平台 / chipset=芯片组（筛选二级=平台、三级=芯片组）
   * 槽位电气全部按 2026-10 官网规格页核实，查不到官方口径的板子不收录 */
  const mobos = [
    /* Intel LGA1700 */
    { id:'b660m-mortar-ddr4', cat:'mobo', name:'微星 MAG B660M MORTAR DDR4', brand:'微星', brandEn:'MSI', platform:'LGA1700', chipset:'B660', socket:'LGA1700', ddr:'4', form:'mATX',
      slots:[{pos:1,lanes:16,src:'cpu',gen:4},{pos:2,lanes:4,src:'chipset',gen:3}], dual:[16,4], slotsTotal:2,
      m2:2, m2Share:null, memSlots:4, memChan:['A','A','B','B'], chipLanes:8, price:450,
      note:'12代+DDR4 省钱组合：第二槽芯片组 Gen3 x4（3.9GB/s）——双卡副卡比现板还慢一半' },
    { id:'b760m-mortar', cat:'mobo', name:'微星 B760M 迫击炮', brand:'微星', brandEn:'MSI', platform:'LGA1700', chipset:'B760', socket:'LGA1700', ddr:'5', form:'mATX',
      slots:[{pos:1,lanes:16,src:'cpu',gen:4},{pos:2,lanes:4,src:'chipset',gen:3}], dual:[16,4], slotsTotal:2,
      m2:2, m2Share:null, memSlots:4, memChan:['A','A','B','B'], chipLanes:8, price:400,
      note:'性价比板但双卡第二槽=芯片组x4 Gen3（3.9GB/s，比现板还慢一半）' },
    { id:'z790-gaming-plus', cat:'mobo', name:'微星 Z790 GAMING PLUS WIFI', brand:'微星', brandEn:'MSI', platform:'LGA1700', chipset:'Z790', socket:'LGA1700', ddr:'5', form:'ATX',
      slots:[{pos:1,lanes:16,src:'cpu',gen:4},{pos:4,lanes:4,src:'chipset',gen:4}], dual:[16,4], slotsTotal:2,
      m2:3, m2Share:null, memSlots:4, memChan:['A','A','B','B'], chipLanes:12, price:900,
      note:'现板。只有2个卡位；第二槽=芯片组x4（6.6GB/s→frac0.18），双卡必踩坑' },
    { id:'tuf-z790-plus', cat:'mobo', name:'华硕 TUF GAMING Z790-PLUS WIFI', brand:'华硕', brandEn:'ASUS', platform:'LGA1700', chipset:'Z790', socket:'LGA1700', ddr:'5', form:'ATX',
      slots:[{pos:1,lanes:16,src:'cpu',gen:5},{pos:4,lanes:4,src:'chipset',gen:4}], dual:[16,4], slotsTotal:2,
      m2:4, m2Share:null, memSlots:4, memChan:['A','A','B','B'], chipLanes:12, price:1500,
      note:'官网槽位表：PCIe5.0 x16（CPU）+ PCIe4.0 x16 皮 x4 芯（芯片组）——中端 Z790 通病，双卡照样 frac 0.18' },
    { id:'strix-z790-a-ii', cat:'mobo', name:'华硕 ROG STRIX Z790-A GAMING WIFI II', brand:'华硕', brandEn:'ASUS', platform:'LGA1700', chipset:'Z790', socket:'LGA1700', ddr:'5', form:'ATX',
      slots:[{pos:1,lanes:16,src:'cpu',gen:5},{pos:4,lanes:4,src:'chipset',gen:4}], dual:[16,4], slotsTotal:2,
      m2:5, m2Share:null, memSlots:4, memChan:['A','A','B','B'], chipLanes:12, price:1900,
      note:'白色板颜值担当；第二槽仍是芯片组 x4——买 ROG 也不等于双卡好链路' },
    { id:'z790-taichi', cat:'mobo', name:'华擎 Z790 Taichi', brand:'华擎', brandEn:'ASRock', platform:'LGA1700', chipset:'Z790', socket:'LGA1700', ddr:'5', form:'ATX',
      slots:[{pos:1,lanes:16,src:'cpu',gen:5},{pos:4,lanes:8,src:'cpu',gen:5}], dual:[8,8], slotsTotal:3,
      m2:3, m2Share:null, memSlots:4, memChan:['A','A','B','B'], chipLanes:12, price:2100,
      note:'方案E/D配套：双卡 CPU直连 x8/x8 Gen5（各31.5GB/s→frac满分）；二手¥1,800-2,400' },
    { id:'z790-meg-ace', cat:'mobo', name:'微星 MEG Z790 ACE', brand:'微星', brandEn:'MSI', platform:'LGA1700', chipset:'Z790', socket:'LGA1700', ddr:'5', form:'ATX',
      slots:[{pos:1,lanes:16,src:'cpu',gen:5},{pos:4,lanes:8,src:'cpu',gen:5}], dual:[8,8], slotsTotal:3,
      m2:4, m2Share:null, memSlots:4, memChan:['A','A','B','B'], chipLanes:12, price:2400,
      note:'同Taichi：x8/x8 CPU直连；二手¥2,000-2,600' },
    /* AMD AM4 */
    { id:'b450m-pro4', cat:'mobo', name:'华擎 B450M Pro4', brand:'华擎', brandEn:'ASRock', platform:'AM4', chipset:'B450', socket:'AM4', ddr:'4', form:'mATX',
      slots:[{pos:1,lanes:16,src:'cpu',gen:3}], dual:null, slotsTotal:1,
      m2:2, m2Share:null, memSlots:4, memChan:['A','A','B','B'], chipLanes:6, price:250,
      note:'AM4 白菜板：只有 1 个 x16 电气槽——双卡？这块板没有这个功能' },
    { id:'b550m-mortar', cat:'mobo', name:'微星 MAG B550M MORTAR', brand:'微星', brandEn:'MSI', platform:'AM4', chipset:'B550', socket:'AM4', ddr:'4', form:'mATX',
      slots:[{pos:1,lanes:16,src:'cpu',gen:4},{pos:4,lanes:4,src:'chipset',gen:3}], dual:[16,4], slotsTotal:2,
      m2:2, m2Share:{m2:'M.2_2', slot:4, toLanes:0}, memSlots:4, memChan:['A','A','B','B'], chipLanes:6, price:400,
      note:'第二槽芯片组 Gen3 x4；官方手册：M2_2 装盘后 PCI_E4 整槽失效——双卡+双M.2 直接少一个槽' },
    { id:'x570-aorus-master', cat:'mobo', name:'技嘉 X570 AORUS MASTER', brand:'技嘉', brandEn:'Gigabyte', platform:'AM4', chipset:'X570', socket:'AM4', ddr:'4', form:'ATX',
      slots:[{pos:1,lanes:16,src:'cpu',gen:4},{pos:3,lanes:8,src:'cpu',gen:4},{pos:5,lanes:4,src:'chipset',gen:4}], dual:[8,8], slotsTotal:3,
      m2:3, m2Share:null, memSlots:4, memChan:['A','A','B','B'], chipLanes:12, price:1400,
      note:'AM4 双卡正解：CPU 直连 x16/x8 拆分 Gen4（双卡各 x8≈15.7GB/s→frac 0.5）；二手¥1,200-1,600' },
    /* AMD AM5 */
    { id:'b650m-pro', cat:'mobo', name:'微星 B650M PRO', brand:'微星', brandEn:'MSI', platform:'AM5', chipset:'B650', socket:'AM5', ddr:'5', form:'mATX',
      slots:[{pos:1,lanes:16,src:'cpu',gen:4},{pos:2,lanes:4,src:'chipset',gen:4}], dual:[16,4], slotsTotal:2,
      m2:2, m2Share:null, memSlots:2, memChan:['A','B'], chipLanes:8, price:500,
      note:'AMD也有坑板：第二槽芯片组x4——"AMD大多支持双x8+x8"是误解，只有E级板才是' },
    { id:'b650-tomahawk', cat:'mobo', name:'微星 MAG B650 TOMAHAWK WIFI', brand:'微星', brandEn:'MSI', platform:'AM5', chipset:'B650', socket:'AM5', ddr:'5', form:'ATX',
      slots:[{pos:1,lanes:16,src:'cpu',gen:4},{pos:4,lanes:2,src:'chipset',gen:4}], dual:[16,2], slotsTotal:2,
      m2:3, m2Share:null, memSlots:4, memChan:['A','A','B','B'], chipLanes:8, price:900,
      note:'新式坑：第二槽物理 x16 大长槽，电气只有芯片组 x2（3.9GB/s→frac 0.12）——槽长骗眼睛，规格页才说实话' },
    { id:'x670e-evo', cat:'mobo', name:'华硕 ROG X670E-E GAMING', brand:'华硕', brandEn:'ASUS', platform:'AM5', chipset:'X670E', socket:'AM5', ddr:'5', form:'ATX',
      slots:[{pos:1,lanes:16,src:'cpu',gen:5},{pos:4,lanes:8,src:'cpu',gen:5}], dual:[8,8], slotsTotal:3,
      m2:4, m2Share:null, memSlots:4, memChan:['A','A','B','B'], chipLanes:12, price:2300,
      note:'方案F核心：X670E/X870E才有CPU直连x8/x8第二槽——普通B650/B850第二槽是芯片组x4（同现板坑）' },
    { id:'x670e-aorus-master', cat:'mobo', name:'技嘉 X670E AORUS MASTER', brand:'技嘉', brandEn:'Gigabyte', platform:'AM5', chipset:'X670E', socket:'AM5', ddr:'5', form:'E-ATX',
      slots:[{pos:1,lanes:16,src:'cpu',gen:5},{pos:4,lanes:4,src:'chipset',gen:4},{pos:6,lanes:2,src:'chipset',gen:3}], dual:[16,4], slotsTotal:3,
      m2:4, m2Share:null, memSlots:4, memChan:['A','A','B','B'], chipLanes:12, price:2400,
      note:'反直觉实证：旗舰 X670E 也不给双 x8——官网槽位表第二槽=芯片组 x4。买前必看规格页，别拿芯片组等级猜槽位' },
    { id:'x870e-creator', cat:'mobo', name:'华硕 ProArt X870E-CREATOR', brand:'华硕', brandEn:'ASUS', platform:'AM5', chipset:'X870E', socket:'AM5', ddr:'5', form:'ATX',
      slots:[{pos:1,lanes:16,src:'cpu',gen:5},{pos:4,lanes:8,src:'cpu',gen:5}], dual:[16,4],  // ProArt: 双卡时第二槽不拆x8而是维持x16+共享（实际手册：x16/x4或x8/x8可选，默认BIOS x8/x8需手动开bifurcation） slotsTotal:2,
      m2:2, m2Share:{m2:'M.2_2', slot:4, toLanes:4}, memSlots:4, memChan:['A','A','B','B'], chipLanes:12, price:2500,
      note:'隐藏坑：装第二个M.2后第二槽x8→x4（装机模拟器专门复现这个bug给你看）' },
    { id:'x870e-aorus-pro-ice', cat:'mobo', name:'技嘉 X870E AORUS PRO ICE', brand:'技嘉', brandEn:'Gigabyte', platform:'AM5', chipset:'X870E', socket:'AM5', ddr:'5', form:'ATX',
      slots:[{pos:1,lanes:16,src:'cpu',gen:5},{pos:4,lanes:4,src:'chipset',gen:4},{pos:6,lanes:4,src:'chipset',gen:3}], dual:[16,4], slotsTotal:3,
      m2:4, m2Share:{m2:'M.2_2/M.2_3', slot:1, toLanes:8}, memSlots:4, memChan:['A','A','B','B'], chipLanes:12, price:2300,
      note:'冰雕白色平台；官方手册新坑：M2B/M2C 装盘 → 第一槽 x16→x8（和 ProArt 反向：这次是主卡槽被 M.2 抢带宽）' },
    /* HEDT / 服务器 */
    { id:'trx40', cat:'mobo', name:'TRX40（线程撕裂者）', brand:'华硕', brandEn:'ASUS', platform:'TRX4', chipset:'TRX40', socket:'TRX4', ddr:'4', form:'E-ATX', eccOK:true,
      slots:[{pos:1,lanes:16,src:'cpu',gen:4},{pos:3,lanes:16,src:'cpu',gen:4},{pos:5,lanes:8,src:'cpu',gen:4}], dual:[16,16,8], slotsTotal:5,
      m2:3, m2Share:null, memSlots:8, memChan:['A','A','B','B','C','C','D','D'], chipLanes:0, price:2600,
      note:'HEDT：三卡x16/x16/x8全CPU直连，但DDR4平台+EPYC/TR贵、单核弱' },
    { id:'h11dsi', cat:'mobo', name:'超微 H11DSi（EPYC 双路）', brand:'超微', brandEn:'Supermicro', platform:'SP3', chipset:'SoC', socket:'SP3', ddr:'4', form:'E-ATX', eccOK:true,
      slots:[{pos:1,lanes:16,src:'cpu',gen:3},{pos:3,lanes:16,src:'cpu',gen:3},{pos:5,lanes:8,src:'cpu',gen:3},{pos:7,lanes:8,src:'cpu',gen:3},{pos:9,lanes:8,src:'cpu',gen:3}], dual:[16,16], slotsTotal:5,
      m2:1, m2Share:null, memSlots:8, memChan:['A','A','B','B','C','C','D','D'], chipLanes:0, price:1800,
      note:'EPYC 神板：2×x16+3×x8 全 CPU 直连（Gen3）、8通道 RECC 内存白菜价；服务器无核显需 BMC 输出、风扇吵' },
  ];

  /* ---------------- 内存条（单条） ----------------
   * AM5 官方内存模型：2DPC 双条可 6000+，四条降 3600（带宽敏感负载致命）
   * Intel Z790 四条：降 4000-4400（混插更低）
   * 分级字段：brand=品牌 / gen=DDR代际（一级筛选）/ size=容量（二级）/ color=马甲色（3D 用） */
  const dimms = [
    { id:'d4-8-2666',  cat:'ram', name:'DDR4 8G 2666',  brand:'金士顿', brandEn:'Kingston', gen:'4', size:8,  mt:2666, color:'black', price:300, note:'亮机条；单条只跑单通道，LLM 场景带宽致命' },
    { id:'d4-16-3200', cat:'ram', name:'DDR4 16G 3200', brand:'金士顿', brandEn:'Kingston', gen:'4', size:16, mt:3200, color:'black', price:550, note:'DDR4合约价+24%三个月，华强北新条最低600+' },
    { id:'d4-16-3600', cat:'ram', name:'DDR4 16G 3600 马甲条', brand:'芝奇', brandEn:'G.Skill', gen:'4', size:16, mt:3600, color:'silver', price:650, note:'Ripjaws V：AM4 甜点频率（Infinity Fabric 1:1 上限附近）' },
    { id:'d4-32-3600', cat:'ram', name:'DDR4 32G 3600', brand:'海盗船', brandEn:'Corsair', gen:'4', size:32, mt:3600, color:'black', price:1050 },
    { id:'d5-16-4800', cat:'ram', name:'DDR5 16G 4800', brand:'三星', brandEn:'Samsung', gen:'5', size:16, mt:4800, color:'black', price:700, note:'JEDEC 裸条无马甲：AM5 四条也能稳 4800（降频惩罚最小的选择）' },
    { id:'d5-16-5600', cat:'ram', name:'DDR5 16G 5600', brand:'金士顿', brandEn:'Kingston', gen:'5', size:16, mt:5600, color:'black', price:850, note:'全新已~¥900（百脑汇10月），二手略低' },
    { id:'d5-24-6000', cat:'ram', name:'DDR5 24G 6000', brand:'金士顿', brandEn:'Kingston', gen:'5', size:24, mt:6000, color:'black', price:1300 },
    { id:'d5-32-5200', cat:'ram', name:'DDR5 32G 5200（KF552C40）', brand:'金士顿', brandEn:'Kingston', gen:'5', size:32, mt:5200, color:'white', price:1500, note:'现机同款——96G=16+32+16+32 混插，可平移AM5。⚠2026-10内存史诗级涨价：二手32G涨过二手显卡（smzdm 10-12）' },
    { id:'d5-32-6000', cat:'ram', name:'DDR5 32G 6000 幻锋戟', brand:'芝奇', brandEn:'G.Skill', gen:'5', size:32, mt:6000, color:'silver', price:1600, note:'Trident Z5：AM5 甜点 6000（1:1 UCLK=MCLK 上限附近）' },
    { id:'d5-32-6000w', cat:'ram', name:'DDR5 32G 6000 白色马甲', brand:'海盗船', brandEn:'Corsair', gen:'5', size:32, mt:6000, color:'white', price:1650, note:'复仇者 RGB 白：白色主题装机用' },
    { id:'d5-48-6400', cat:'ram', name:'DDR5 48G 6400', brand:'海盗船', brandEn:'Corsair', gen:'5', size:48, mt:6400, color:'black', price:2400 },
    { id:'d5-64-5600', cat:'ram', name:'DDR5 64G 5600', brand:'海盗船', brandEn:'Corsair', gen:'5', size:64, mt:5600, color:'black', price:3300, note:'单条64G：两条=128G 双通道不降频——96G 之外的大内存新路线' },
    { id:'d4-32-3200r', cat:'ram', name:'DDR4 32G 3200 RECC', brand:'三星', brandEn:'Samsung', gen:'4', size:32, mt:3200, color:'green', ecc:true, price:700, note:'服务器拆机 RECC：EPYC/TR 板 8 通道堆容量白菜价；普通桌面板不兼容 ECC UDIMM 之外规格' },
  ];

  /* ---------------- 显卡 ----------------
   * bw=显存带宽GB/s; sm; tdp; thick=占用槽厚; len=长度mm; conn=供电接口
   * pcieGen/lanesNeed; mod=魔改卡（无保/按耗材定价）; benchNote=社区/本机实测锚点
   * vendor='nvidia'|'amd'：A 卡走 Vulkan/HIP 路径，Strata 上 prefill/batch 有折损（sim.js 建模）
   * 分级字段：brand=品牌 / series=系列（一级筛选 N卡A卡→系列）/ tier=档位
   * 价格：闲鱼 2026-10-16（vramglass + 实地成交价） */
  const gpus = [
    /* NVIDIA */
    { id:'rtx-3060-12g', cat:'gpu', name:'RTX 3060 12G',          vendor:'nvidia', brand:'NVIDIA', series:'RTX 30', tier:'60', vram:12, bw:360,  sm:35, arch:'ampere',  gen:4, lanes:16, tdp:170, thick:2,   len:242, conn:'8pin x1',       price:1400,  benchNote:'12G 大显存入门：带宽 360GB/s 是硬伤，decode 上限低' },
    { id:'rtx-3070-8g',  cat:'gpu', name:'RTX 3070 8G',           vendor:'nvidia', brand:'NVIDIA', series:'RTX 30', tier:'70', vram:8,  bw:448,  sm:46, arch:'ampere',  gen:4, lanes:16, tdp:220, thick:2,   len:242, conn:'8pin x2',       price:1600,  benchNote:'8G 显存锁死 125B：装不下 KV+expert 预算，只配当亮机副卡' },
    { id:'rtx-3080-10g', cat:'gpu', name:'RTX 3080 10G',          vendor:'nvidia', brand:'NVIDIA', series:'RTX 30', tier:'80', vram:10, bw:760,  sm:68, arch:'ampere',  gen:4, lanes:16, tdp:320, thick:2,   len:300, conn:'8pin x2',     price:2100,  benchNote:'' },
    { id:'rtx-3080-20g', cat:'gpu', name:'RTX 3080 20G 魔改',      vendor:'nvidia', brand:'NVIDIA', series:'RTX 30', tier:'80', vram:20, bw:760,  sm:68, arch:'ampere',  gen:4, lanes:16, tdp:370, thick:2.5, len:310, conn:'8pin x2',     price:3800,  mod:true,
      benchNote:'本机主卡实测：layer-split K=35、expert arena 71.7G、x4副卡时 decode 50-56.7 t/s' },
    { id:'rtx-3090',     cat:'gpu', name:'RTX 3090 24G',          vendor:'nvidia', brand:'NVIDIA', series:'RTX 30', tier:'90', vram:24, bw:936,  sm:82, arch:'ampere',  gen:4, lanes:16, tdp:350, thick:3,   len:313, conn:'12pin(转接)', price:8100,
      benchNote:'官方bench 2026-09-29-epyc-milan：双3090 UD-Q4 64-78 t/s（AVX2 CPU不拖后腿）；闲鱼10-16 ¥8,100（24h -6.9%）' },
    { id:'rtx-2080ti-22g', cat:'gpu', name:'RTX 2080 Ti 22G 魔改', vendor:'nvidia', brand:'NVIDIA', series:'RTX 20', tier:'Ti', vram:22, bw:616, sm:68, arch:'turing', gen:3, lanes:16, tdp:260, thick:2.5, len:270, conn:'8pin x2',    price:2600,  mod:true,
      benchNote:'官方bench 2x2080Ti：比本机现配还慢——明确不推荐' },
    { id:'rtx-4060ti-16g', cat:'gpu', name:'RTX 4060 Ti 16G',     vendor:'nvidia', brand:'NVIDIA', series:'RTX 40', tier:'60Ti', vram:16, bw:288, sm:34, arch:'ada',    gen:4, lanes:8,  tdp:165, thick:2,   len:245, conn:'8pin x1',       price:2900,  benchNote:'16G 便宜但电气只有 x8 + 288GB/s 带宽——大显存小水管' },
    { id:'rtx-4070',     cat:'gpu', name:'RTX 4070 12G',          vendor:'nvidia', brand:'NVIDIA', series:'RTX 40', tier:'70', vram:12, bw:504,  sm:46, arch:'ada',     gen:4, lanes:16, tdp:200, thick:2,   len:244, conn:'12pin',         price:3400,  benchNote:'' },
    { id:'rtx-4070s',    cat:'gpu', name:'RTX 4070 SUPER 12G',    vendor:'nvidia', brand:'NVIDIA', series:'RTX 40', tier:'70S', vram:12, bw:504, sm:71, arch:'ada',     gen:4, lanes:16, tdp:220, thick:2.5, len:300, conn:'16pin',       price:4600,
      benchNote:'现机副卡。12G小显存锁死prompt chunk（issue#448: 1037槽→chunk≤5632）；实地成交价¥4,600' },
    { id:'rtx-4070tis',  cat:'gpu', name:'RTX 4070 Ti SUPER 16G', vendor:'nvidia', brand:'NVIDIA', series:'RTX 40', tier:'70TiS', vram:16, bw:672, sm:84, arch:'ada',   gen:4, lanes:16, tdp:285, thick:3,   len:305, conn:'16pin',       price:5600,  benchNote:'16G+672GB/s：40 系性价比甜点，单卡能装下 KV+部分 expert' },
    { id:'rtx-4080s',    cat:'gpu', name:'RTX 4080 SUPER 16G',    vendor:'nvidia', brand:'NVIDIA', series:'RTX 40', tier:'80S', vram:16, bw:736, sm:102,arch:'ada',     gen:4, lanes:16, tdp:360, thick:3,   len:310, conn:'16pin',       price:7300,  benchNote:'' },
    { id:'rtx-4090',     cat:'gpu', name:'RTX 4090 24G',          vendor:'nvidia', brand:'NVIDIA', series:'RTX 40', tier:'90', vram:24, bw:1008, sm:128,arch:'ada',     gen:4, lanes:16, tdp:450, thick:3,   len:336, conn:'16pin',       price:23344,
      benchNote:'闲鱼10-16 ¥23,344两年高位——4.1倍价换不成比例提升，不买' },
    { id:'rtx-5070',     cat:'gpu', name:'RTX 5070 12G',          vendor:'nvidia', brand:'NVIDIA', series:'RTX 50', tier:'70', vram:12, bw:672,  sm:48, arch:'blackwell',gen:5, lanes:16, tdp:250, thick:2,   len:244, conn:'16pin(12V-2x6)', price:4500,  benchNote:'GDDR7 带宽上来了但 12G 容量仍是笼子（chunk 受限同 4070S）' },
    { id:'rtx-5070tis',  cat:'gpu', name:'RTX 5070 Ti SUPER 16G', vendor:'nvidia', brand:'NVIDIA', series:'RTX 50', tier:'70TiS', vram:16, bw:896, sm:70, arch:'blackwell',gen:5, lanes:16, tdp:300, thick:2.5, len:304, conn:'16pin(12V-2x6)', price:7200, benchNote:'' },
    { id:'rtx-5080',     cat:'gpu', name:'RTX 5080 16G',          vendor:'nvidia', brand:'NVIDIA', series:'RTX 50', tier:'80', vram:16, bw:960,  sm:84, arch:'blackwell',gen:5, lanes:16, tdp:360, thick:2.5, len:304, conn:'16pin(12V-2x6)', price:9900,  benchNote:'' },
    { id:'rtx-5090',     cat:'gpu', name:'RTX 5090 32G',          vendor:'nvidia', brand:'NVIDIA', series:'RTX 50', tier:'90', vram:32, bw:1792, sm:170,arch:'blackwell',gen:5, lanes:16, tdp:575, thick:3,   len:336, conn:'16pin(12V-2x6)', price:46000,
      benchNote:'Gen5 x16要128条lane平台才喂得饱；单卡¥46k' },
    { id:'rtx-pro-4500', cat:'gpu', name:'RTX PRO 4500 Blackwell 32G', vendor:'nvidia', brand:'NVIDIA', series:'RTX PRO', tier:'工作站', vram:32, bw:1296, sm:128, arch:'blackwell', gen:5, lanes:16, tdp:200, thick:2, len:267, conn:'16pin', price:19920,
      benchNote:'官方社区bench 2026-10-06：双32G experts 100%常驻、issue#776 batch +29%、decode 100+；闲鱼10-16 ¥19,920（24h -15.2%正在跌，可蹲）' },
    { id:'rtx-a6000',    cat:'gpu', name:'RTX A6000 48G',         vendor:'nvidia', brand:'NVIDIA', series:'RTX A', tier:'工作站', vram:48, bw:768, sm:80, arch:'ampere',  gen:4, lanes:16, tdp:300, thick:2,   len:267, conn:'8pin x1(转)', price:23000,
      benchNote:'48G大显存但768GB/s带宽一般——容量党路线' },
    /* AMD Radeon（Strata 走 Vulkan/HIP：prefill 折损、batch 路径不启用，见 sim.js） */
    { id:'rx-6750xt-12g', cat:'gpu', name:'RX 6750 XT 12G',       vendor:'amd', brand:'AMD', series:'RX 6000', tier:'70', vram:12, bw:432,  sm:40, arch:'rdna2',   gen:4, lanes:16, tdp:250, thick:2,   len:267, conn:'8pin x2',  price:1500,  benchNote:'A 卡二手白菜：12G 显存够用，但 Strata Vulkan 路径 prefill 打八折' },
    { id:'rx-7600-8g',   cat:'gpu', name:'RX 7600 8G',            vendor:'amd', brand:'AMD', series:'RX 7000', tier:'60', vram:8,  bw:288,  sm:32, arch:'rdna3',   gen:4, lanes:8,  tdp:165, thick:2,   len:204, conn:'8pin x1',  price:1800,  benchNote:'8G+x8 电气：亮机有余，LLM 不足' },
    { id:'rx-7800xt-16g', cat:'gpu', name:'RX 7800 XT 16G',       vendor:'amd', brand:'AMD', series:'RX 7000', tier:'80', vram:16, bw:624,  sm:60, arch:'rdna3',   gen:4, lanes:16, tdp:263, thick:2.5, len:267, conn:'8pin x2',  price:3100,  benchNote:'A卡性价比王：16G+624GB/s 硬件不输 4070TiS，软件栈折损后约等于 4070S+容量' },
    { id:'rx-7900xtx-24g', cat:'gpu', name:'RX 7900 XTX 24G',     vendor:'amd', brand:'AMD', series:'RX 7000', tier:'XTX', vram:24, bw:960, sm:96,  arch:'rdna3',   gen:4, lanes:16, tdp:355, thick:2.5, len:287, conn:'8pin x3',  price:5300,  benchNote:'24G+960GB/s 纸面=3090 价一半；ROCm/Vulkan 在 Strata 上仍是二等公民，实测口径见 benchNote 折损' },
    { id:'rx-9070xt-16g', cat:'gpu', name:'RX 9070 XT 16G',       vendor:'amd', brand:'AMD', series:'RX 9000', tier:'XT', vram:16, bw:640,  sm:64, arch:'rdna4',   gen:5, lanes:16, tdp:304, thick:2.5, len:330, conn:'8pin x2',  price:5000,  benchNote:'AMD 官方规格：64CU/2970MHz/640GB/s/304W；京东 ¥4,600-5,000 档——N 卡同价位只给 12G' },
  ];

  /* ---------------- SSD / 存储 ----------------
   * 分级字段：brand / type=nvme|sata（一级）/ cap=容量档（二级）
   * 服务器盘（U.2/企业级 SATA）走转接路线，note 里说明 */
  const ssds = [
    { id:'nvme3-512',    cat:'ssd', name:'铠侠 RC20 500G',        brand:'铠侠', brandEn:'Kioxia', type:'nvme', gen:4, lanes:4, cap:'512G',  read:2100, tdp:5, price:250, note:'Gen4 入门带缓：亮机盘' },
    { id:'ti600-1t',     cat:'ssd', name:'致态 Ti600 1TB NVMe',   brand:'致态', brandEn:'ZHITAI', type:'nvme', gen:4, lanes:4, cap:'1T',    read:5000, tdp:6, price:600, note:'本机C:/G:同款×2——权重流式读不构成瓶颈（实测2.3GB/s SLC内）' },
    { id:'sn770-1t',     cat:'ssd', name:'WD SN770 1TB',          brand:'西数', brandEn:'WD', type:'nvme', gen:4, lanes:4, cap:'1T',    read:5150, tdp:6, price:580 },
    { id:'sn850x-2t',    cat:'ssd', name:'三星 SN850X 2TB',       brand:'三星', brandEn:'Samsung', type:'nvme', gen:4, lanes:4, cap:'2T',    read:7300, tdp:7, price:1300 },
    { id:'tiplus7100-2t',cat:'ssd', name:'致态 TiPlus7100 2TB',   brand:'致态', brandEn:'ZHITAI', type:'nvme', gen:4, lanes:4, cap:'2T',    read:7000, tdp:6, price:1150 },
    { id:'sn5000-4t',    cat:'ssd', name:'致态 TiPro7100 4TB',    brand:'致态', brandEn:'ZHITAI', type:'nvme', gen:4, lanes:4, cap:'4T',    read:7400, tdp:8, price:2600 },
    { id:'990pro-4t',    cat:'ssd', name:'三星 990 PRO 4TB',      brand:'三星', brandEn:'Samsung', type:'nvme', gen:4, lanes:4, cap:'4T',    read:7450, tdp:8, price:2900 },
    { id:'ti600-8t',     cat:'ssd', name:'致态 Ti600 8TB',        brand:'致态', brandEn:'ZHITAI', type:'nvme', gen:4, lanes:4, cap:'8T',    read:5000, tdp:9, price:4800, note:'单盘 8T：全模型库+数据集一盘点' },
    { id:'gc-clip-2t',   cat:'ssd', name:'Solidigm P44 Pro 2TB Gen5', brand:'Solidigm', brandEn:'Solidigm', type:'nvme', gen:5, lanes:4, cap:'2T', read:14000, tdp:11, price:2400, note:'Gen5 盘发热大：主板自带马甲或加散热片，否则掉速' },
    { id:'sata-ssd-1t',  cat:'ssd', name:'镁光 MX500 1TB SATA',   brand:'镁光', brandEn:'Micron', type:'sata_ssd', gen:0, lanes:0, cap:'1T', read:560, tdp:3, price:400, note:'SATA SSD：550MB/s 够冷数据，流式权重会卡' },
    { id:'wd43purz-4t',  cat:'ssd', name:'西数 HC430 4TB 机械盘',  brand:'西数', brandEn:'WD', type:'sata', gen:0, lanes:0, cap:'4T', read:175, tdp:8, price:550, note:'D:/E:同款——机械盘勿放模型热文件（175MB/s会卡权重流式）' },
    { id:'hdd18-16t',    cat:'ssd', name:'Ultrastar HC550 16T 企业盘', brand:'西数', brandEn:'WD', type:'sata', gen:0, lanes:0, cap:'16T', read:260, tdp:10, price:1100, note:'矿渣企业盘 16T：便宜大碗但吵+振动；放数据集可以，别放权重' },
  ];

  /* ---------------- 电源 ----------------
   * 分级字段：brand / w=瓦数档（一级筛选）/ cert=认证（二级）
   * conn8=8pin 数量, conn16pin=原生 12VHPWR/12V-2x6 数量 */
  const psus2 = [
    { id:'psu-550',   cat:'psu', name:'酷冷 550W 白牌',        brand:'酷冷至尊', brandEn:'Cooler Master', w:550,  cert:'白牌', conn8:2, conn16pin:0, price:180, note:'单卡 650 级以下够用；双卡别碰' },
    { id:'psu-650bm', cat:'psu', name:'海盗船 CX650M 铜牌',     brand:'海盗船', brandEn:'Corsair', w:650,  cert:'铜牌', conn8:3, conn16pin:0, price:350 },
    { id:'psu-750',   cat:'psu', name:'安钛克 750W 金牌',      brand:'安钛克', brandEn:'Antec', w:750,  cert:'金牌', conn8:4, conn16pin:0, price:300 },
    { id:'psu-850g',  cat:'psu', name:'振华 LEADEX III 850W 金牌', brand:'振华', brandEn:'Super Flower', w:850, cert:'金牌', conn8:4, conn16pin:1, price:550 },
    { id:'psu-1000p', cat:'psu', name:'海韵 FOCUS 1000W 白金',  brand:'海韵', brandEn:'Seasonic', w:1000, cert:'白金', conn8:6, conn16pin:1, price:900 },
    { id:'psu-1200g', cat:'psu', name:'酷冷 V2 1200W 金牌',     brand:'酷冷至尊', brandEn:'Cooler Master', w:1200, cert:'金牌', conn8:6, conn16pin:2, price:800, note:'双 3090/3080 组合的平价答案' },
    { id:'psu-1250t', cat:'psu', name:'海盗船 AX1200i 钛金（现机）', brand:'海盗船', brandEn:'Corsair', w:1250, cert:'钛金', conn8:8, conn16pin:2, price:1500, note:'带3090(350W)+3080(370W)足够' },
    { id:'psu-1600',  cat:'psu', name:'海盗船 AX1600i 钛金',    brand:'海盗船', brandEn:'Corsair', w:1600, cert:'钛金', conn8:10,conn16pin:2, price:2200 },
  ];

  /* ---------------- CPU 散热器 ----------------
   * 分级字段：brand / type=air|aio（一级）/ cap=解热W（二级由 UI 换算档位）
   * 3D 参数：towers=塔数, finW=塔宽mm, fanD=风扇mm, towerH=塔高mm（3d.js buildCooler 读取） */
  const coolers = [
    { id:'ag400',     cat:'cooler', name:'利民 AX120 单塔',        brand:'利民', brandEn:'Thermalright', cap:180, type:'air', towers:1, finW:120, fanD:120, towerH:150, price:60 },
    { id:'ak620',     cat:'cooler', name:'九州风神 AK620 双塔',     brand:'九州风神', brandEn:'DeepCool', cap:260, type:'air', towers:2, finW:127, fanD:120, towerH:150, price:180 },
    { id:'pa120se',   cat:'cooler', name:'利民 PA120 SE 双塔',      brand:'利民', brandEn:'Thermalright', cap:260, type:'air', towers:2, finW:125, fanD:120, towerH:150, price:120 },
    { id:'aio240',    cat:'cooler', name:'240mm 一体水冷',          brand:'利民', brandEn:'Thermalright', cap:280, type:'aio', radLen:270, radFans:2, price:300, note:'中塔顶置兼容性好；解热略强于双塔风冷' },
    { id:'aio360',    cat:'cooler', name:'360mm 一体水冷（现机）',   brand:'利民', brandEn:'Thermalright', cap:350, type:'aio', radLen:380, radFans:3, price:400 },
    { id:'d15',       cat:'cooler', name:'猫头鹰 NH-D15',           brand:'猫头鹰', brandEn:'Noctua', cap:280, type:'air', towers:2, finW:150, fanD:140, towerH:150, price:380 },
  ];

  /* ---------------- 机箱 ----------------
   * 分级字段：type=mid|full|open（一级）/ brand
   * gpuMaxLen=限长, formMax=最大主板, fans=风扇数, topRad=顶置冷排上限mm */
  const cases = [
    { id:'mft3f',   cat:'case', name:'中塔（3前进风扇）',   brand:'先马', brandEn:'Sama', type:'mid',  gpuMaxLen:360, formMax:'ATX',   fans:3, topRad:360, price:200 },
    { id:'pano',    cat:'case', name:'海景房（无柱全景）',   brand:'联力', brandEn:'Lian Li', type:'mid', gpuMaxLen:420, formMax:'ATX',  fans:4, topRad:360, price:600, note:'双面玻璃展示柜：3D 侧透观感最好，积热靠风扇数量补' },
    { id:'ft7f',    cat:'case', name:'全塔（7风扇风道）',   brand:'追风者', brandEn:'Phanteks', type:'full', gpuMaxLen:420, formMax:'E-ATX', fans:7, topRad:420, price:600 },
  ];

  /* ---------------- 权重档位（Strata 侧设置） ---------------- */
  const models = [
    { id:'iq3_s',    name:'IQ3_S 125B（现用, 79G）',            expertG:13.2, q:1.00, totalG:79,   path:'G:\\llm\\Strata-data\\packs\\iq3_s' },
    { id:'ud_q4',    name:'UD-Q4_K_XL 125B（huihui破限, 104G）', expertG:17.5, q:0.97, totalG:104,  path:'G:\\llm\\dl\\uncensored\\unsloth-UD-Q4_K_XL' },
    { id:'iq3_xxs',  name:'Swift IQ3_XXS 125B（71G）',           expertG:9.0,  q:1.04, totalG:71 },
    { id:'iq2_xs',   name:'IQ2_XS 125B（56G）',                  expertG:6.4,  q:1.08, totalG:56 },
    { id:'q4_27b',   name:'27B Q4_K_M（16G, llama栈）',           expertG:2.2,  q:1.30, totalG:16 },
  ];

  /* ================= 分级筛选（货架菜单数据层） =================
   * FILTER_TREE[cat] = 层级数组。每层：{ key, zh, en, opts(p, lang) -> [{v, zh, en}] }
   * opts 从当前列表动态去重生成（数据加一个，菜单自动长一项，不用维护两份）。
   * filterParts(cat, sel)：sel={key:v}，逐层过滤；纯函数，Node 可测。 */
  const uniq = (arr, f) => [...new Set(arr.map(f).filter(x => x != null && x !== ''))];
  const order = (vals, ref) => ref.filter(r => vals.includes(r)).concat(vals.filter(v => !ref.includes(v)));
  const CPU_GEN = ['12代', '13代', '14代', 'Zen3', 'Zen4', 'Zen5', 'Zen2', 'Milan'];
  const CPU_TIER = ['i3', 'i5', 'i7', 'i9', 'R5', 'R7', 'R9', '线程撕裂者', 'EPYC'];
  const GPU_SERIES = ['RTX 20', 'RTX 30', 'RTX 40', 'RTX 50', 'RTX A', 'RTX PRO', 'RX 6000', 'RX 7000', 'RX 9000'];
  const PSU_W = [550, 650, 750, 850, 1000, 1200, 1250, 1600];
  const CAPS = ['512G', '1T', '2T', '4T', '8T', '16T'];
  const MEM_SIZE = [8, 16, 24, 32, 48, 64];
  const FILTER_TREE = {
    cpu: [
      { key:'brand',    zh:'品牌', en:'Brand',    opts:p => uniq(p, x => x.brand) },
      { key:'platform', zh:'平台', en:'Platform', opts:p => uniq(p, x => x.platform) },
      { key:'gen',      zh:'代系', en:'Gen',      opts:p => order(uniq(p, x => x.gen), CPU_GEN) },
      { key:'tier',     zh:'档位', en:'Tier',     opts:p => order(uniq(p, x => x.tier), CPU_TIER) },
    ],
    mobo: [
      { key:'brand',    zh:'品牌', en:'Brand',    opts:p => uniq(p, x => x.brand) },
      { key:'platform', zh:'平台', en:'Socket',   opts:p => uniq(p, x => x.platform) },
      { key:'chipset',  zh:'芯片组', en:'Chipset', opts:p => uniq(p, x => x.chipset) },
    ],
    ram: [
      { key:'gen',  zh:'DDR 代际', en:'DDR gen', opts:p => order(uniq(p, x => 'DDR' + x.gen), ['DDR4', 'DDR5']).map(s => s.slice(3)) },
      { key:'size', zh:'容量', en:'Capacity',   opts:p => order(uniq(p, x => x.size), MEM_SIZE) },
      { key:'brand', zh:'品牌', en:'Brand',     opts:p => uniq(p, x => x.brand) },
    ],
    gpu: [
      { key:'vendor', zh:'阵营', en:'Vendor',  opts:p => uniq(p, x => x.vendor === 'amd' ? 'A 卡' : 'N 卡') },
      { key:'series', zh:'系列', en:'Series',  opts:p => order(uniq(p, x => x.series), GPU_SERIES) },
      { key:'vram',   zh:'显存', en:'VRAM',    opts:p => order(uniq(p, x => x.vram), [8, 10, 12, 16, 20, 22, 24, 32, 48]) },
    ],
    ssd: [
      { key:'type', zh:'类型', en:'Type', opts:p => uniq(p, x => ({ nvme:'NVMe', sata_ssd:'SATA SSD', sata:'机械盘' })[x.type]) },
      { key:'cap',  zh:'容量', en:'Cap',  opts:p => order(uniq(p, x => x.cap), CAPS) },
      { key:'brand', zh:'品牌', en:'Brand', opts:p => uniq(p, x => x.brand) },
    ],
    psu: [
      { key:'w',     zh:'瓦数档', en:'Wattage', opts:p => order(uniq(p, x => x.w), PSU_W) },
      { key:'cert',  zh:'认证', en:'Cert',      opts:p => uniq(p, x => x.cert) },
      { key:'brand', zh:'品牌', en:'Brand',     opts:p => uniq(p, x => x.brand) },
    ],
    cooler: [
      { key:'type',  zh:'类型', en:'Type',  opts:p => uniq(p, x => x.type === 'aio' ? '水冷' : '风冷') },
      { key:'cap',   zh:'解热档', en:'Cooling', opts:p => uniq(p, x => x.cap >= 320 ? '旗舰(≥320W)' : x.cap >= 240 ? '高端(240-319W)' : '主流(<240W)') },
      { key:'brand', zh:'品牌', en:'Brand', opts:p => uniq(p, x => x.brand) },
    ],
    case: [
      { key:'type',  zh:'类型', en:'Type', opts:p => uniq(p, x => ({ mid:'中塔', full:'全塔', open:'开放架' })[x.type] || x.type) },
      { key:'brand', zh:'品牌', en:'Brand', opts:p => uniq(p, x => x.brand) },
    ],
  };
  /* 把一件配件归到某层的选项值（与 opts 同一套换算，保证选中后能命中） */
  function partOptVal(cat, key, p) {
    if (cat === 'ram' && key === 'gen') return p.gen;
    if (cat === 'gpu' && key === 'vendor') return p.vendor === 'amd' ? 'A 卡' : 'N 卡';
    if (cat === 'gpu' && key === 'vram') return p.vram;
    if (cat === 'ssd' && key === 'type') return ({ nvme:'NVMe', sata_ssd:'SATA SSD', sata:'机械盘' })[p.type];
    if (cat === 'cooler' && key === 'type') return p.type === 'aio' ? '水冷' : '风冷';
    if (cat === 'cooler' && key === 'cap') return p.cap >= 320 ? '旗舰(≥320W)' : p.cap >= 240 ? '高端(240-319W)' : '主流(<240W)';
    if (cat === 'case' && key === 'type') return ({ mid:'中塔', full:'全塔', open:'开放架' })[p.type] || p.type;
    return p[key];
  }
  function filterParts(cat, list, sel) {
    const tree = FILTER_TREE[cat] || [];
    let out = list;
    for (const lv of tree) {
      const v = sel && sel[lv.key];
      if (v == null || v === '') continue;
      out = out.filter(p => String(partOptVal(cat, lv.key, p)) === String(v));
    }
    return out;
  }

  /* ================= 矩阵规则 ================= */

  /* 查表缓存：原来每次调用都 concat 出 47 元素新数组再 find，
     而 byId 被 totalPrice/货架/机箱/读数高频调用（一次 onChange 几十次）。
     配件库是纯静态数据，建一次 Map 索引即可。 */
  const _idx = new Map([].concat(cpus, mobos, dimms, gpus, ssds, psus2, coolers, cases).map(p => [p.id, p]));
  function byId(id) { return _idx.get(id) || null; }

  /* 内存分析：槽位按主板 memChan 布局（典型 A1A2B1B2，索引0=CPU侧最近槽）。
   * build.ram 为稀疏数组：build.ram[i] = 槽i 的内存条 id 或 null。
   * 通道 = 同组槽（A组/B组…）各至少 1 条 → 通道数取各组最小值+1 的组数；
   * 容量对称性按"同组内容量是否一致"判弹性通道。 */
  function analyzeRAM(build, mobo, cpu) {
    const n = mobo.memSlots;
    const chan = mobo.memChan || Array.from({ length: n }, (_, i) => String.fromCharCode(65 + Math.floor(i / 2)));
    const slots = Array.from({ length: n }, (_, i) => (build.ram && build.ram[i]) ? byId(build.ram[i]) : null);
    const filled = slots.filter(Boolean);
    if (!filled.length) return { slots, chan, total: 0, error: '无内存，无法点亮' };
    const gen = filled[0].gen;
    if (filled.some(d => d.gen !== gen)) return { slots, chan, total: filled.reduce((s, d) => s + d.size, 0), error: 'DDR' + gen + '/DDR' + (gen === '4' ? '5' : '4') + ' 混插物理不兼容（防呆口不同位）' };
    if (!cpu.ddr.includes(gen)) return { slots, chan, total: 0, error: cpu.name + ' 仅支持 ' + cpu.ddr.map(g => 'DDR' + g).join('/') };
    /* RECC 服务器条：只有 HEDT/服务器板（eccOK）能点灵——桌面板插 RECC 直接不亮机 */
    if (filled.some(d => d.ecc) && !mobo.eccOK) return { slots, chan, total: filled.reduce((s, d) => s + d.size, 0), error: L('RECC 服务器内存点不灵桌面板（需 HEDT/服务器板）', 'RECC server DIMMs will not POST on a consumer board (HEDT/server required)') };
    const sizes = filled.map(d => d.size);
    /* 通道分组：每组（A/B/C/D…）内至少 1 条才算激活该通道 */
    const groups = {};
    slots.forEach((d, i) => { const g = chan[i]; (groups[g] = groups[g] || []).push(d); });
    const activeCh = Object.values(groups).filter(g => g.some(Boolean)).length;
    const dual = activeCh >= 2;
    /* 对称性：各激活通道容量和一致 → 满血对称；否则弹性/降速 */
    const chSums = Object.values(groups).filter(g => g.some(Boolean)).map(g => g.filter(Boolean).reduce((s, d) => s + d.size, 0));
    const symmetric = new Set(chSums).size === 1;
    let mt = Math.min(...filled.map(d => d.mt));
    const derates = [];
    if (filled.length === 4) {
      const cap = cpu.socket === 'AM5' ? 3600 : (symmetric ? 4400 : 4000);
      if (mt > cap) { derates.push(filled.length + L('条',' sticks ') + (symmetric ? '' : L('混插','mixed ')) + L('降频→','downclocked to ') + cap); mt = cap; }
    } else if (filled.length === 3) {
      mt = Math.min(mt, 4800); derates.push(L('3条非对称→','3 sticks, asymmetric → ') + mt);
    }
    /* 单通道插法提示：两条同组（如 A1+A2）→ 仍单通道 */
    if (filled.length === 2 && activeCh === 1) derates.push(L('两条同通道（','Both sticks in channel ') + Object.keys(groups).find(k => groups[k].filter(Boolean).length === 2) + L('组）→ 单通道，建议跨 A/B 组插',' → single channel; populate across groups A/B'));
    if (!symmetric && dual) derates.push(L('通道容量不对称→弹性通道混合，带宽-15%','Channel capacities differ → flex mode, -15% bandwidth'));
    const bw = dual ? mt * 8 * activeCh / 1000 : mt * 8 / 1000; // 每通道64bit=mt×8 GB/s
    const bwEff = bw * (symmetric ? 1 : 0.85);
    const chanLabel = activeCh >= 2 ? (symmetric ? activeCh + L('通道',' channels') : L('弹性','flex ') + (activeCh - 0.5) + L('通道',' channels')) : L('单通道','single channel');
    return { slots, chan, total: sizes.reduce((a, b) => a + b, 0), channels: dual ? (symmetric ? activeCh : activeCh - 0.5) : 1, chanLabel, mt, bw: bwEff, derates,
      symmetric, count: filled.length, warn: derates.length ? derates.join('；') : null };
  }

  /* PCIe 分配：按主板 bifurcation 规格（dual=双卡时各CPU槽实际lane）
   * frac 线性映射官方实测锚点：x16Gen4实测24.3GB/s、x4Gen4实测6.6GB/s，/31.5封顶1.0 */
  function allocPCIe(mobo, gpuCount, ssdList) {
    const res = [];
    const cpuSlots = mobo.slots.filter(s => s.src === 'cpu');
    const cpuAlloc = cpuSlots.map(s => s.lanes);
    if (gpuCount >= 2 && mobo.dual) {
      for (let i = 0; i < cpuSlots.length; i++) if (mobo.dual[i] != null) cpuAlloc[i] = mobo.dual[i];
    }
    const hasM2share = mobo.m2Share && (ssdList || []).filter(s => s.type === 'nvme').length >= 2;
    let ci = 0;
    for (const s of mobo.slots) {
      let lanes = s.lanes, gen = s.gen, why = [];
      if (s.src === 'cpu') {
        lanes = cpuAlloc[ci++];
        if (mobo.dual && gpuCount >= 2) why.push('双卡 bifurcation：CPU lane 拆分 x' + lanes);
      } else {
        why.push('芯片组通道（与USB/SATA/M.2抢带宽）');
      }
      if (hasM2share && mobo.m2Share.slot === s.pos && lanes > mobo.m2Share.toLanes) {
        lanes = mobo.m2Share.toLanes; why.push(mobo.m2Share.m2 + '占用→降x' + lanes);
      }
      const measured = lanes * GBPS_PER_LANE[gen]; // 理论带宽（报告口径：x8/x8 Gen5=31.5GB/s=frac满分；x16 Gen4=31.5）
      const frac = +Math.min(1, measured / 31.5).toFixed(2);
      res.push({ pos: s.pos, lanes, gen, src: s.src, gbps: +measured.toFixed(1), frac, why: why.join('，') });
    }
    return res;
  }

  /* 整机装配校验：POST 条件 + 兼容矩阵 */
  function analyze(build, settings) {
    const errors = [], warns = [], info = [];
    const cpu = build.cpu ? byId(build.cpu) : null;
    const mobo = build.mobo ? byId(build.mobo) : null;
    const psu = build.psu ? byId(build.psu) : null;
    const cooler = build.cooler ? byId(build.cooler) : null;
    const kase = build.case ? byId(build.case) : null;
    const gpuList = (build.gpu || []).map(byId).filter(Boolean);
    const ssdList = (build.ssd || []).map(byId).filter(Boolean);
    const ram = mobo && cpu ? analyzeRAM(build, mobo, cpu) : null;

    if (!cpu) errors.push(L('缺 CPU','No CPU'));
    if (!mobo) errors.push(L('缺主板','No motherboard'));
    if (!ram || ram.error) errors.push(ram ? ram.error : L('缺内存','No memory'));
    if (!psu) errors.push(L('缺电源','No PSU'));
    if (!cooler) errors.push(L('缺 CPU 散热器（无散热器上电=秒缩缸保护关机）','No CPU cooler (powering on without one trips thermal shutdown)'));
    if (!ssdList.length) errors.push(L('无存储盘（权重在盘上，无法加载）','No storage (weights live on disk — nothing to load)'));
    if (!kase) errors.push(L('缺机箱','No case'));

    if (cpu && mobo && cpu.socket !== mobo.socket) errors.push(L('插槽不匹配：','Socket mismatch: ') + cpu.name + '(' + cpu.socket + ') ≠ ' + mobo.name + '(' + mobo.socket + ')');
    if (mobo && ram && ram.slots.filter(Boolean).length > mobo.memSlots) errors.push(L('内存条数超过主板槽数','More DIMMs than the board has slots'));
    if (cpu && cooler && cooler.cap < (cpu.pl2||cpu.tdp)) warns.push(L('散热压不住：','Cooler too weak: ') + cooler.name + L(' 解热 ',' cools ') + cooler.cap + 'W < ' + cpu.name + ' PL2 ' + (cpu.pl2||cpu.tdp) + L('W（会撞温度墙降频）','W (it will throttle on the thermal wall)'));
    if (mobo && kase && ['ATX', 'E-ATX'].includes(mobo.form) && kase.formMax === 'ATX' && mobo.form === 'E-ATX') errors.push(L('E-ATX 主板装不进中塔','An E-ATX board does not fit a mid tower'));

    /* 显示输出：无核显且无独卡 → 点不亮（POST 无显示） */
    const igpuUsable = cpu && cpu.igpu !== 'none';
    const igpuChosen = settings && settings.igpuDisplay && igpuUsable;
    if (!gpuList.length && !igpuUsable) errors.push(L('无独卡且 ','No GPU and ') + (cpu ? cpu.name : 'CPU') + L(' 无核显——无显示输出点不亮（12700KF/KF 教训）',' has no iGPU — no display output, so it will not POST (the 12700KF lesson)'));

    /* PCIe 分配 + 显卡物理/电气 */
    const pcie = mobo ? allocPCIe(mobo, gpuList.length, ssdList) : [];
    const gpuAssign = [];
    if (mobo) {
      let nextFree = 0;
      const slotPos = pcie.map(p => p.pos);
      for (const g of gpuList) {
        const si = slotPos.findIndex((p, idx) => idx >= nextFree && p >= 1);
        if (si < 0) { errors.push(g.name + L('：主板卡槽已满（',': no free slot left (') + mobo.name + L(' 只有 ',' has ') + mobo.slots.length + L(' 个可用槽）',' usable slots)')); break; }
        const slot = pcie[si];
        const prev = gpuAssign[gpuAssign.length - 1];
        if (prev) {
          const gap = slot.pos - prev.slotPos;
          if (gap < prev.thick) errors.push(g.name + L(' 装不进：与 ',' cannot fit: clashes with ') + prev.name + L(' 冲突（需 ',' — needs ') + prev.thick + L(' 槽间距，实际 ',' slots of clearance, got ') + gap + ')');
        }
        if (kase && g.len > kase.gpuMaxLen) errors.push(g.name + L(' 长 ',' is ') + g.len + L('mm 超过机箱限长 ','mm — over the case limit of ') + kase.gpuMaxLen + 'mm');
        if (slot.src === 'chipset') warns.push(g.name + L(' 在芯片组 x',' on the chipset x') + slot.lanes + ': ' + slot.gbps + 'GB/s → Strata pcie_frac ' + slot.frac + L('（4070S 教训，issue#448）',' (the 4070S lesson, issue #448)'));
        else if (slot.lanes < 8) warns.push(g.name + L(' 仅 x',' runs x') + slot.lanes + L('，pcie_frac ',' only — pcie_frac ') + slot.frac);
        gpuAssign.push({ ...g, slotPos: slot.pos, slot, thick: g.thick });
        nextFree = si + 1;
      }
      if (gpuList.length > mobo.slots.length) errors.push(L('显卡数量超过主板槽数','More GPUs than the board has slots'));
    }

    /* 供电 */
    let load = 150; // 板+内存+盘+风扇基础
    if (cpu) load += cpu.tdp;
    gpuAssign.forEach(g => load += g.tdp);
    let powerOK = true;
    if (psu) {
      const need = load / 0.85;
      if (psu.w < need) { errors.push(L('电源不足：峰值 ','PSU too small: peak ') + load + L('W，建议 ≥','W, recommend ≥') + Math.ceil(need / 50) * 50 + L('W（85% 负载线），当前 ','W (85% load line); you have ') + psu.name); powerOK = false; }
      else if (psu.w < load / 0.7) warns.push(L('电源余量偏紧（负载 >','PSU headroom is tight (>') + Math.round(load / psu.w * 100) + L('%）','% load)'));
      const need16 = gpuAssign.filter(g => /16pin|12pin/.test(g.conn)).length;
      if (need16 > psu.conn16pin) warns.push(L('缺原生 16pin/12pin 接口：需 ','Not enough native 16-pin connectors: need ') + need16 + L(' 个，电源只有 ',' but the PSU has ') + psu.conn16pin + L(' 个（用转接线有熔毁风险）',' (adapters have melted before)'));
    }

    /* 内存带宽对 Strata CPU 侧 expert 的影响 */
    if (ram && !ram.error) {
      if (ram.total < 64) warns.push(L('内存 ','RAM ') + ram.total + L('G：125B expert arena 装不下（IQ3_S 需 ~72G 全驻），decode 会掉到个位数','G: the 125B expert arena does not fit (IQ3_S needs ~72G resident) — decode falls to single digits'));
      else if (ram.total < 96) warns.push(L('内存 ','RAM ') + ram.total + L('G：expert arena 部分驻留，长上下文时 RAM 余量吃紧','G: the expert arena is partly resident — long contexts run out of RAM headroom'));
      if (ram.bw < 70) warns.push(L('内存带宽 ','Memory bandwidth ') + Math.round(ram.bw) + L('GB/s 偏低——CPU 侧 expert 计算是带宽敏感负载（AM5 四槽降 3600 的典型代价）','GB/s is low — CPU-side expert compute is bandwidth-bound (the usual AM5 4-DIMM / 3600 cost)'));
    }

    /* 机械盘放权重警告 */
    if (ssdList.length && ssdList.every(s => s.type === 'sata')) warns.push(L('权重全在机械盘（175MB/s）：expert 流式加载会卡死 decode，权重必须放 NVMe','Weights on a spinning disk (175MB/s): streamed experts stall decode — they must live on NVMe'));

    const canPost = errors.length === 0;
    return { cpu, mobo, psu, cooler, kase, ram, pcie, gpuAssign, ssdList, errors, warns, info, load, canPost, igpuChosen };
  }

  return {
    GBPS_PER_LANE, cpus, mobos, dimms, gpus, ssds, psus: psus2, coolers, cases, models,
    byId, analyze, analyzeRAM, allocPCIe,
    FILTER_TREE, filterParts, partOptVal,
  };
});
