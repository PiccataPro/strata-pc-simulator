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

  const GBPS_PER_LANE = { 3: 0.985, 4: 1.969, 5: 3.94 }; // GB/s per PCIe lane（有效载荷）

  /* ---------------- CPU ----------------
   * thr=逻辑线程; simd: 512=AVX-512, vnni=AVX-VNNI, avx2=纯AVX2
   * igpu: 'none' 无核显 / 型号（可承担桌面输出→独卡纯计算化）
   * lanes/gen: CPU 直连 PCIe；chipsetLanes: 芯片组附加通道
   * price: 闲鱼/散片 2026-10 参考（元） */
  const cpus = [
    { id:'i5-12400',    cat:'cpu', name:'i5-12400',              socket:'LGA1700', p:6,  pt:12, e:0,  et:0,  thr:12, simd:'vnni', igpu:'UHD730',        pcie:{lanes:16, gen:5}, ddr:['4','5'], memMax:128, tdp:65, pl2:117,  price:600,  note:'6P无E核，并发弱；带核显' },
    { id:'i7-12700KF',  cat:'cpu', name:'i7-12700KF',            socket:'LGA1700', p:8,  pt:16, e:4,  et:4,  thr:20, simd:'vnni', igpu:'none',          pcie:{lanes:16, gen:5}, ddr:['4','5'], memMax:128, tdp:125, pl2:190, price:1400, note:'现机U。8P+4E/20T，无核显（亮机须独卡）' },
    { id:'i7-14700',    cat:'cpu', name:'i7-14700（非K）',        socket:'LGA1700', p:8,  pt:16, e:12, et:12, thr:28, simd:'vnni', igpu:'UHD770',        pcie:{lanes:16, gen:5}, ddr:['4','5'], memMax:128, tdp:65, pl2:212,  price:2100, note:'方案E核心：8P+12E/28T，UHD770核显输出→双卡纯计算；非K 65W档缩缸风险最低，BIOS须含0x129/0x12B微码' },
    { id:'i9-14900KF',  cat:'cpu', name:'i9-14900KF',            socket:'LGA1700', p:8,  pt:16, e:16, et:16, thr:32, simd:'vnni', igpu:'none',          pcie:{lanes:16, gen:5}, ddr:['4','5'], memMax:128, tdp:125, pl2:253, price:2200, note:'13/14代缩缸高压档，二手风险高。贩子集体拒收13/14代i9（NGA 10-07），二手压价' },
    { id:'r7-7700',     cat:'cpu', name:'Ryzen 7 7700',          socket:'AM5',     p:8,  pt:16, e:0,  et:0,  thr:16, simd:'512',  igpu:'Radeon 680M',   pcie:{lanes:24, gen:5}, ddr:['5'],     memMax:192, tdp:65, pl2:88,  price:1100, note:'AM5入门，AVX-512' },
    { id:'r9-9900X',    cat:'cpu', name:'Ryzen 9 9900X',         socket:'AM5',     p:12, pt:24, e:0,  et:0,  thr:24, simd:'512',  igpu:'Radeon 680M',   pcie:{lanes:24, gen:5}, ddr:['5'],     memMax:256, tdp:120, pl2:162, price:1950, note:'12C24T AVX-512' },
    { id:'r9-9950X',    cat:'cpu', name:'Ryzen 9 9950X',         socket:'AM5',     p:16, pt:32, e:0,  et:0,  thr:32, simd:'512',  igpu:'Radeon 680M',   pcie:{lanes:24, gen:5}, ddr:['5'],     memMax:256, tdp:170, pl2:200, price:2500, note:'方案F核心：16C32T，AVX-512激活Strata expert kernel（官方口径 a bit faster），无缩缸史，AM5可续Zen6。闲鱼/散片~¥2,500（头条10月AM5指南口径）' },
    { id:'epyc-7453',   cat:'cpu', name:'EPYC 7453（Milan）',    socket:'SP3',     p:28, pt:56, e:0,  et:0,  thr:56, simd:'avx2', igpu:'aspeed',        pcie:{lanes:128,gen:4}, ddr:['4'],     memMax:2048,tdp:155, pl2:210, price:1600, note:'官方bench反证机：无AVX-512纯AVX2，双3090照样64-78 t/s——CPU不是瓶颈' },
  ];

  /* ---------------- 主板 ----------------
   * slots: 物理PCIe卡槽（pos=物理槽序, lanes=电气, src=cpu|chipset, gen）
   * 关键事实（实地拆机确认）：现板 Z790 GAMING PLUS 物理只有 2 个可用卡位，
   * 且第二槽走芯片组 x4 —— 这就是 4070S pcie_frac 0.18 的根因
   * m2Share: 通道共享坑（插M.2_x第二槽降x4） */
  const mobos = [
    { id:'z790-gaming-plus', cat:'mobo', name:'微星 Z790 GAMING PLUS WIFI', socket:'LGA1700', ddr:'5', form:'ATX',
      slots:[{pos:1,lanes:16,src:'cpu',gen:4},{pos:4,lanes:4,src:'chipset',gen:4}], dual:[16,4], slotsTotal:2,
      m2:3, m2Share:null, memSlots:4, chipLanes:12, price:900,
      note:'现板。只有2个卡位；第二槽=芯片组x4（6.6GB/s→frac0.18），双卡必踩坑' },
    { id:'z790-taichi', cat:'mobo', name:'华擎 Z790 Taichi', socket:'LGA1700', ddr:'5', form:'ATX',
      slots:[{pos:1,lanes:16,src:'cpu',gen:5},{pos:4,lanes:8,src:'cpu',gen:5}], dual:[8,8], slotsTotal:3,
      m2:3, m2Share:null, memSlots:4, chipLanes:12, price:2100,
      note:'方案E/D配套：双卡 CPU直连 x8/x8 Gen5（各31.5GB/s→frac满分）；二手¥1,800-2,400' },
    { id:'z790-meg-ace', cat:'mobo', name:'微星 MEG Z790 ACE', socket:'LGA1700', ddr:'5', form:'ATX',
      slots:[{pos:1,lanes:16,src:'cpu',gen:5},{pos:4,lanes:8,src:'cpu',gen:5}], dual:[8,8], slotsTotal:3,
      m2:4, m2Share:null, memSlots:4, chipLanes:12, price:2400,
      note:'同Taichi：x8/x8 CPU直连；二手¥2,000-2,600' },
    { id:'b760m-mortar', cat:'mobo', name:'微星 B760M 迫击炮', socket:'LGA1700', ddr:'5', form:'mATX',
      slots:[{pos:1,lanes:16,src:'cpu',gen:4},{pos:2,lanes:4,src:'chipset',gen:3}], dual:[16,4], slotsTotal:2,
      m2:2, m2Share:null, memSlots:4, chipLanes:8, price:400,
      note:'性价比板但双卡第二槽=芯片组x4 Gen3（3.9GB/s，比现板还慢一半）' },
    { id:'x670e-evo', cat:'mobo', name:'华硕 ROG X670E-E GAMING', socket:'AM5', ddr:'5', form:'ATX',
      slots:[{pos:1,lanes:16,src:'cpu',gen:5},{pos:4,lanes:8,src:'cpu',gen:5}], dual:[8,8], slotsTotal:3,
      m2:4, m2Share:null, memSlots:4, chipLanes:12, price:2300,
      note:'方案F核心：X670E/X870E才有CPU直连x8/x8第二槽——普通B650/B850第二槽是芯片组x4（同现板坑）' },
    { id:'x870e-creator', cat:'mobo', name:'华硕 ProArt X870E-CREATOR', socket:'AM5', ddr:'5', form:'ATX',
      slots:[{pos:1,lanes:16,src:'cpu',gen:5},{pos:4,lanes:8,src:'cpu',gen:5}], dual:[16,4],  // ProArt: 双卡时第二槽不拆x8而是维持x16+共享（实际手册：x16/x4或x8/x8可选，默认BIOS x8/x8需手动开bifurcation） slotsTotal:2,
      m2:2, m2Share:{m2:'M.2_2', slot:4, toLanes:4}, memSlots:4, chipLanes:12, price:2500,
      note:'隐藏坑：装第二个M.2后第二槽x8→x4（装机模拟器专门复现这个bug给你看）' },
    { id:'b650m-pro', cat:'mobo', name:'微星 B650M PRO', socket:'AM5', ddr:'5', form:'mATX',
      slots:[{pos:1,lanes:16,src:'cpu',gen:4},{pos:2,lanes:4,src:'chipset',gen:4}], dual:[16,4], slotsTotal:2,
      m2:2, m2Share:null, memSlots:2, chipLanes:8, price:500,
      note:'AMD也有坑板：第二槽芯片组x4——"AMD大多支持双x8+x8"是误解，只有E级板才是' },
    { id:'trx40', cat:'mobo', name:'TRX40（线程撕裂者）', socket:'TRX4', ddr:'4', form:'E-ATX',
      slots:[{pos:1,lanes:16,src:'cpu',gen:4},{pos:3,lanes:16,src:'cpu',gen:4},{pos:5,lanes:8,src:'cpu',gen:4}], dual:[16,16,8], slotsTotal:5,
      m2:3, m2Share:null, memSlots:8, chipLanes:0, price:2600,
      note:'HEDT：三卡x16/x16/x8全CPU直连，但DDR4平台+EPYC/TR贵、单核弱' },
  ];

  /* ---------------- 内存条（单条） ----------------
   * AM5 官方内存模型：2DPC 双条可 6000+，四条降 3600（带宽敏感负载致命）
   * Intel Z790 四条：降 4000-4400（混插更低） */
  const dimms = [
    { id:'d4-16-3200', cat:'ram', name:'DDR4 16G 3200',  gen:'4', size:16, mt:3200,  price:550, note:'DDR4合约价+24%三个月，华强北新条最低600+' },
    { id:'d4-32-3600', cat:'ram', name:'DDR4 32G 3600',  gen:'4', size:32, mt:3600,  price:1050 },
    { id:'d5-16-5600', cat:'ram', name:'DDR5 16G 5600',  gen:'5', size:16, mt:5600,  price:850, note:'全新已~¥900（百脑汇10月），二手略低' },
    { id:'d5-24-6000', cat:'ram', name:'DDR5 24G 6000',  gen:'5', size:24, mt:6000,  price:1300 },
    { id:'d5-32-5200', cat:'ram', name:'DDR5 32G 5200（KF552C40）', gen:'5', size:32, mt:5200, price:1500, note:'现机同款——96G=16+32+16+32 混插，可平移AM5。⚠2026-10内存史诗级涨价：二手32G涨过二手显卡（smzdm 10-12）' },
    { id:'d5-32-6000', cat:'ram', name:'DDR5 32G 6000',  gen:'5', size:32, mt:6000,  price:1600 },
    { id:'d5-48-6400', cat:'ram', name:'DDR5 48G 6400',  gen:'5', size:48, mt:6400,  price:2400 },
  ];

  /* ---------------- 显卡 ----------------
   * bw=显存带宽GB/s; sm; tdp; thick=占用槽厚; len=长度mm; conn=供电接口
   * pcieGen/lanesNeed; mod=魔改卡（无保/按耗材定价）; benchNote=社区/本机实测锚点
   * 价格：闲鱼 2026-10-16（vramglass + 实地成交价） */
  const gpus = [
    { id:'rtx-3080-10g', cat:'gpu', name:'RTX 3080 10G',        vram:10, bw:760,  sm:68, arch:'ampere',  gen:4, lanes:16, tdp:320, thick:2,   len:300, conn:'8pin x2',     price:2100,  benchNote:'' },
    { id:'rtx-3080-20g', cat:'gpu', name:'RTX 3080 20G 魔改',    vram:20, bw:760,  sm:68, arch:'ampere',  gen:4, lanes:16, tdp:370, thick:2.5, len:310, conn:'8pin x2',     price:3800,  mod:true,
      benchNote:'本机主卡实测：layer-split K=35、expert arena 71.7G、x4副卡时 decode 50-56.7 t/s' },
    { id:'rtx-3090',     cat:'gpu', name:'RTX 3090 24G',         vram:24, bw:936,  sm:82, arch:'ampere',  gen:4, lanes:16, tdp:350, thick:3,   len:313, conn:'12pin(转接)', price:8100,
      benchNote:'官方bench 2026-09-29-epyc-milan：双3090 UD-Q4 64-78 t/s（AVX2 CPU不拖后腿）；闲鱼10-16 ¥8,100（24h -6.9%）' },
    { id:'rtx-2080ti-22g', cat:'gpu', name:'RTX 2080 Ti 22G 魔改', vram:22, bw:616, sm:68, arch:'turing', gen:3, lanes:16, tdp:260, thick:2.5, len:270, conn:'8pin x2',    price:2600,  mod:true,
      benchNote:'官方bench 2x2080Ti：比本机现配还慢——明确不推荐' },
    { id:'rtx-4070s',    cat:'gpu', name:'RTX 4070 SUPER 12G',   vram:12, bw:504,  sm:71, arch:'ada',     gen:4, lanes:16, tdp:220, thick:2.5, len:300, conn:'16pin',       price:4600,
      benchNote:'现机副卡。12G小显存锁死prompt chunk（issue#448: 1037槽→chunk≤5632）；实地成交价¥4,600' },
    { id:'rtx-4090',     cat:'gpu', name:'RTX 4090 24G',         vram:24, bw:1008, sm:128,arch:'ada',     gen:4, lanes:16, tdp:450, thick:3,   len:336, conn:'16pin',       price:23344,
      benchNote:'闲鱼10-16 ¥23,344两年高位——4.1倍价换不成比例提升，不买' },
    { id:'rtx-5090',     cat:'gpu', name:'RTX 5090 32G',         vram:32, bw:1792, sm:170,arch:'blackwell',gen:5, lanes:16, tdp:575, thick:3,   len:336, conn:'16pin(12V-2x6)', price:46000,
      benchNote:'Gen5 x16要128条lane平台才喂得饱；单卡¥46k' },
    { id:'rtx-pro-4500', cat:'gpu', name:'RTX PRO 4500 Blackwell 32G', vram:32, bw:1296, sm:128, arch:'blackwell', gen:5, lanes:16, tdp:200, thick:2, len:267, conn:'16pin', price:19920,
      benchNote:'官方社区bench 2026-10-06：双32G experts 100%常驻、issue#776 batch +29%、decode 100+；闲鱼10-16 ¥19,920（24h -15.2%正在跌，可蹲）' },
    { id:'rtx-a6000',    cat:'gpu', name:'RTX A6000 48G',        vram:48, bw:768,  sm:80, arch:'ampere',  gen:4, lanes:16, tdp:300, thick:2,   len:267, conn:'8pin x1(转)', price:23000,
      benchNote:'48G大显存但768GB/s带宽一般——容量党路线' },
  ];

  /* ---------------- SSD ---------------- */
  const ssds = [
    { id:'ti600-1t',   cat:'ssd', name:'致态 Ti600 1TB NVMe',    type:'nvme', gen:4, lanes:4, read:5000, tdp:6, price:600, note:'本机C:/G:同款×2——权重流式读不构成瓶颈（实测2.3GB/s SLC内）' },
    { id:'sn850x-2t',  cat:'ssd', name:'三星 SN850X 2TB',        type:'nvme', gen:4, lanes:4, read:7300, tdp:7, price:1300 },
    { id:'sn5000-4t',  cat:'ssd', name:'致态 TiPro7100 4TB',     type:'nvme', gen:4, lanes:4, read:7400, tdp:8, price:2600 },
    { id:'wd43purz-4t',cat:'ssd', name:'西数 HC430 4TB 机械盘',   type:'sata', gen:0, lanes:0, read:175,  tdp:8, price:550, note:'D:/E:同款——机械盘勿放模型热文件（175MB/s会卡权重流式）' },
  ];

  /* ---------------- 电源 ---------------- */
  const psus2 = [
    { id:'psu-750',  cat:'psu', name:'750W 金牌',    w:750,  conn8:4, conn16pin:0, price:300 },
    { id:'psu-850g', cat:'psu', name:'850W 金牌',    w:850,  conn8:4, conn16pin:1, price:400 },
    { id:'psu-1000p',cat:'psu', name:'1000W 白金',   w:1000, conn8:6, conn16pin:1, price:750 },
    { id:'psu-1250t',cat:'psu', name:'1250W 钛金（现机）', w:1250, conn8:8, conn16pin:2, price:1500, note:'带3090(350W)+3080(370W)足够' },
    { id:'psu-1600', cat:'psu', name:'1600W 钛金',   w:1600, conn8:10,conn16pin:2, price:2200 },
  ];

  /* ---------------- CPU 散热器 ---------------- */
  const coolers = [
    { id:'ag400',    cat:'cooler', name:'利民 AX120 单塔',        cap:180, type:'air', price:60 },
    { id:'pa120se',  cat:'cooler', name:'利民 PA120 SE 双塔',     cap:260, type:'air', price:120 },
    { id:'aio360',   cat:'cooler', name:'360mm 一体水冷（现机）',  cap:350, type:'aio', price:400 },
    { id:'d15',      cat:'cooler', name:'猫头鹰 NH-D15',          cap:280, type:'air', price:380 },
  ];

  /* ---------------- 机箱 ---------------- */
  const cases = [
    { id:'mft3f',  cat:'case', name:'中塔（3前进风扇）',  gpuMaxLen:360, formMax:'ATX',   fans:3, price:200 },
    { id:'ft7f',   cat:'case', name:'全塔（7风扇风道）',  gpuMaxLen:420, formMax:'E-ATX', fans:7, price:600 },
  ];

  /* ---------------- 权重档位（Strata 侧设置） ---------------- */
  const models = [
    { id:'iq3_s',    name:'IQ3_S 125B（现用, 79G）',            expertG:13.2, q:1.00, totalG:79,   path:'G:\\llm\\Strata-data\\packs\\iq3_s' },
    { id:'ud_q4',    name:'UD-Q4_K_XL 125B（huihui破限, 104G）', expertG:17.5, q:0.97, totalG:104,  path:'G:\\llm\\dl\\uncensored\\unsloth-UD-Q4_K_XL' },
    { id:'iq3_xxs',  name:'Swift IQ3_XXS 125B（71G）',           expertG:9.0,  q:1.04, totalG:71 },
    { id:'iq2_xs',   name:'IQ2_XS 125B（56G）',                  expertG:6.4,  q:1.08, totalG:56 },
    { id:'q4_27b',   name:'27B Q4_K_M（16G, llama栈）',           expertG:2.2,  q:1.30, totalG:16 },
  ];

  /* ================= 矩阵规则 ================= */

  function byId(id) {
    const all = [].concat(cpus, mobos, dimms, gpus, ssds, psus2, coolers, cases);
    return all.find(p => p.id === id) || null;
  }

  /* 内存分析：槽位A1A2B1B2、通道、对称性、实际频率（AM5四槽降3600等） */
  function analyzeRAM(build, mobo, cpu) {
    const slots = [null, null, null, null];
    (build.ram || []).forEach((id, i) => { if (i < mobo.memSlots) slots[i] = byId(id); });
    const filled = slots.filter(Boolean);
    if (!filled.length) return { slots, total: 0, error: '无内存，无法点亮' };
    const gen = filled[0].gen;
    if (filled.some(d => d.gen !== gen)) return { slots, total: filled.reduce((s, d) => s + d.size, 0), error: 'DDR' + gen + '/DDR' + (gen === '4' ? '5' : '4') + ' 混插物理不兼容（防呆口不同位）' };
    if (!cpu.ddr.includes(gen)) return { slots, total: 0, error: cpu.name + ' 仅支持 ' + cpu.ddr.map(g => 'DDR' + g).join('/') };
    const sizes = filled.map(d => d.size);
    const dual = sizes.length >= 2;
    const symmetric = new Set(sizes).size === 1;
    let mt = Math.min(...filled.map(d => d.mt));
    const derates = [];
    if (filled.length === 4) {
      const cap = cpu.socket === 'AM5' ? 3600 : (symmetric ? 4400 : 4000);
      if (mt > cap) { derates.push(filled.length + '条' + (symmetric ? '' : '混插') + '降频→' + cap); mt = cap; }
    } else if (filled.length === 3) {
      mt = Math.min(mt, 4800); derates.push('3条非对称→' + mt);
    }
    if (!symmetric) derates.push('非对称容量→弹性单/双通道混合，带宽-15%');
    const bw = dual ? mt * 16 / 1000 : mt * 8 / 1000; // DDR5: 单通道64bit=mt×8，双通道×2
    const bwEff = bw * (symmetric ? 1 : 0.85);
    return { slots, total: sizes.reduce((a, b) => a + b, 0), channels: dual ? (symmetric ? 2 : '1.5') : 1, mt, bw: bwEff, derates,
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

    if (!cpu) errors.push('缺 CPU');
    if (!mobo) errors.push('缺主板');
    if (!ram || ram.error) errors.push(ram ? ram.error : '缺内存');
    if (!psu) errors.push('缺电源');
    if (!cooler) errors.push('缺 CPU 散热器（无散热器上电=秒缩缸保护关机）');
    if (!ssdList.length) errors.push('无存储盘（权重在盘上，无法加载）');
    if (!kase) errors.push('缺机箱');

    if (cpu && mobo && cpu.socket !== mobo.socket) errors.push('插槽不匹配：' + cpu.name + '(' + cpu.socket + ') ≠ ' + mobo.name + '(' + mobo.socket + ')');
    if (mobo && ram && ram.slots.filter(Boolean).length > mobo.memSlots) errors.push('内存条数超过主板槽数');
    if (cpu && cooler && cooler.cap < (cpu.pl2||cpu.tdp)) warns.push('散热压不住：' + cooler.name + ' 解热 ' + cooler.cap + 'W < ' + cpu.name + ' PL2 ' + (cpu.pl2||cpu.tdp) + 'W（会撞温度墙降频）');
    if (mobo && kase && ['ATX', 'E-ATX'].includes(mobo.form) && kase.formMax === 'ATX' && mobo.form === 'E-ATX') errors.push('E-ATX 主板装不进中塔');

    /* 显示输出：无核显且无独卡 → 点不亮（POST 无显示） */
    const igpuUsable = cpu && cpu.igpu !== 'none';
    const igpuChosen = settings && settings.igpuDisplay && igpuUsable;
    if (!gpuList.length && !igpuUsable) errors.push('无独卡且 ' + (cpu ? cpu.name : 'CPU') + ' 无核显——无显示输出点不亮（12700KF/KF 教训）');

    /* PCIe 分配 + 显卡物理/电气 */
    const pcie = mobo ? allocPCIe(mobo, gpuList.length, ssdList) : [];
    const gpuAssign = [];
    if (mobo) {
      let nextFree = 0;
      const slotPos = pcie.map(p => p.pos);
      for (const g of gpuList) {
        const si = slotPos.findIndex((p, idx) => idx >= nextFree && p >= 1);
        if (si < 0) { errors.push(g.name + '：主板卡槽已满（' + mobo.name + ' 只有 ' + mobo.slots.length + ' 个可用槽）'); break; }
        const slot = pcie[si];
        const prev = gpuAssign[gpuAssign.length - 1];
        if (prev) {
          const gap = slot.pos - prev.slotPos;
          if (gap < prev.thick) errors.push(g.name + ' 装不进：与 ' + prev.name + ' 冲突（需 ' + prev.thick + ' 槽间距，实际 ' + gap + '）');
        }
        if (kase && g.len > kase.gpuMaxLen) errors.push(g.name + ' 长 ' + g.len + 'mm 超过机箱限长 ' + kase.gpuMaxLen + 'mm');
        if (slot.src === 'chipset') warns.push(g.name + ' 在芯片组 x' + slot.lanes + '：' + slot.gbps + 'GB/s → Strata pcie_frac ' + slot.frac + '（4070S 教训，issue#448）');
        else if (slot.lanes < 8) warns.push(g.name + ' 仅 x' + slot.lanes + '，pcie_frac ' + slot.frac);
        gpuAssign.push({ ...g, slotPos: slot.pos, slot, thick: g.thick });
        nextFree = si + 1;
      }
      if (gpuList.length > mobo.slots.length) errors.push('显卡数量超过主板槽数');
    }

    /* 供电 */
    let load = 150; // 板+内存+盘+风扇基础
    if (cpu) load += cpu.tdp;
    gpuAssign.forEach(g => load += g.tdp);
    let powerOK = true;
    if (psu) {
      const need = load / 0.85;
      if (psu.w < need) { errors.push('电源不足：峰值 ' + load + 'W，建议 ≥' + Math.ceil(need / 50) * 50 + 'W（85% 负载线），当前 ' + psu.name); powerOK = false; }
      else if (psu.w < load / 0.7) warns.push('电源余量偏紧（负载 >' + Math.round(load / psu.w * 100) + '%）');
      const need16 = gpuAssign.filter(g => /16pin|12pin/.test(g.conn)).length;
      if (need16 > psu.conn16pin) warns.push('缺原生 16pin/12pin 接口：需 ' + need16 + ' 个，电源只有 ' + psu.conn16pin + ' 个（用转接线有熔毁风险）');
    }

    /* 内存带宽对 Strata CPU 侧 expert 的影响 */
    if (ram && !ram.error) {
      if (ram.total < 64) warns.push('内存 ' + ram.total + 'G：125B expert arena 装不下（IQ3_S 需 ~72G 全驻），decode 会掉到个位数');
      else if (ram.total < 96) warns.push('内存 ' + ram.total + 'G：expert arena 部分驻留，长上下文时 RAM 余量吃紧');
      if (ram.bw < 70) warns.push('内存带宽 ' + Math.round(ram.bw) + 'GB/s 偏低——CPU 侧 expert 计算是带宽敏感负载（AM5 四槽降 3600 的典型代价）');
    }

    /* 机械盘放权重警告 */
    if (ssdList.length && ssdList.every(s => s.type === 'sata')) warns.push('权重全在机械盘（175MB/s）：expert 流式加载会卡死 decode，权重必须放 NVMe');

    const canPost = errors.length === 0;
    return { cpu, mobo, psu, cooler, kase, ram, pcie, gpuAssign, ssdList, errors, warns, info, load, canPost, igpuChosen };
  }

  return {
    GBPS_PER_LANE, cpus, mobos, dimms, gpus, ssds, psus: psus2, coolers, cases, models,
    byId, analyze, analyzeRAM, allocPCIe, 
  };
});
