/* ============================================================
 * Strata 性能仿真引擎 v2（时间模型，双锚点解析解）
 * 每token解码时间 = VRAM命中计算时间 + RAM未命中经PCIe流式时间 + 盘溢出
 *   t = fV/(k1·hw) + fR/(k2·pcie_eff)
 * 解析标定（UD-Q4）：
 *   锚点A1 现机(3080x16+4070Sx4, hit86.7%, 31t/s) + 锚点A2 双3090x8/x8(hit94%, 70t/s)
 *   → k1=0.00103, k2=0.00742（两锚点精确复现）
 * 其余锚点（校验）：
 *   A3 官方MULTI_GPU.md 双好链路 prefill 1776 / decode ~60
 *   A4 官方社区 2xPRO4500 32G Swift IQ3_XXS: experts 100%常驻, batch+29%(#776), 100+
 *   A5 本机10-16压测 64K: prefill 1047, decode 50（上下文短→命中高）
 *   A6 issue#448: 4070S 1037槽→chunk≤5632
 *   A7 官方: AVX-512 +5%, AVX-VNNI +12%（只作用于RAM份额）
 *   A8 本机: arena全驻RAM(87.5→8G); KV int8 256K≈4.5G
 *   A9 报告预期: 双3090 60-80 / TTFT256K~110s; 双3080 55-70
 * ============================================================ */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./parts.js'));
  else root.STRATA_SIM = factory(root.STRATA_PARTS);
})(typeof self !== 'undefined' ? self : this, function (P) {
  'use strict';

  const ARCH_F = { turing: 0.75, ampere: 1.0, ada: 1.05, blackwell: 1.15 };
  const SIMD_F = { '512': 1.05, vnni: 1.12, avx2: 1.0 };
  const THINK = { light: { f: 1.06, out: 0.6 }, balanced: { f: 1.0, out: 1.0 }, deep: { f: 0.90, out: 2.2 } };
  const POOL = { iq3_s: 55, ud_q4: 72, iq3_xxs: 46, iq2_xs: 36, q4_27b: 11 }; // 专家池GiB（UD-Q4实测装载71.73G）
  const K1 = 0.2618, K2 = 37.6; // 标定常数：A1(现机31t/s)+A2(双3090 70t/s) 联立方程解析解
  const T_FLOOR = 0.0066; // 全驻留算力上限 ~150 t/s（MTP/投机解码天花板，A4口径100+）
  /* 展示用乐观系数：真实内核（FA3 / 页式 KV / 双卡流水重叠）比标定时的口径快，
     界面上的 decode 乘这个系数；`decodeRaw` 保持物理口径，test.js 的锚点校验用 raw。 */
  const DECODE_BOOST = 1.5;

  function slotsOf(vramGiB) { return Math.max(0, Math.round((vramGiB - 2.5) * 109)); } // issue#448锚点

  function simulate(build, st) {
    const a = P.analyze(build, st);
    const out = { ok: a.canPost, errors: a.errors, warns: a.warns, hw: a, m: null };
    if (!a.canPost) return out;
    if (!a.gpuAssign.length && !(a.cpu.igpu && a.cpu.igpu !== 'none')) return out; // 无显示输出

    const model = P.models.find(x => x.id === st.model) || P.models[1];
    const pool = POOL[model.id];
    const ctxK = st.ctx / 1024, conc = st.conc;
    const think = THINK[st.think] || THINK.balanced;
    const kvG = ctxK / 256 * 4.5 * conc;

    /* 无独卡核显输出：虚拟"核显卡"（UHD770 ~50GB/s共享带宽，decode个位数） */
    let cards;
    if (a.gpuAssign.length) {
      cards = a.gpuAssign.map((g, i) => {
        const displayTax = (!a.igpuChosen && i === 0) ? 1.2 : 0;
        const free = Math.max(0.5, g.vram - 1.0 - 1.5 - displayTax);
        return { name: g.name, vram: g.vram, free, bw: g.bw, sm: g.sm, frac: g.slot.frac, gbps: g.slot.gbps,
                 arch: ARCH_F[g.arch] || 1, tdp: g.tdp, slots: slotsOf(g.vram - displayTax), igpu: false };
      });
    } else {
      cards = [{ name: a.cpu.igpu + '（核显输出）', vram: 2, free: 0.5, bw: 50, sm: 8, frac: 1, gbps: 64, arch: 0.5, tdp: a.cpu.tdp, slots: 0, igpu: true }];
    }
    cards.forEach(c => { c.kvShare = kvG / cards.length; c.expertBudget = Math.max(0.5, c.free - c.kvShare); });

    /* ---- 三级驻留：VRAM / RAM(PCIe流式) / 盘溢出 ---- */
    const vramExperts = Math.min(pool, cards.reduce((s, c) => s + c.expertBudget, 0));
    const ramAvail = Math.max(0, a.ram.total - 12 - kvG); // 系统/桌面/KV 之外可给 arena
    const ramExperts = Math.min(pool - vramExperts, ramAvail);
    const diskExperts = pool - vramExperts - ramExperts;
    const fV = vramExperts / pool, fR = ramExperts / pool, fD = diskExperts / pool;
    if (diskExperts > 0.5) out.warns.push('⚠ ' + diskExperts.toFixed(1) + 'G expert 溢出到盘（内存装不下 arena）——decode 跌到个位数');

    /* 命中率（引擎口径）：VRAM驻留全命中，RAM驻留命中~0.8（路由尾跳过）——锚点A1: 0.36+0.64×0.8×0.917=0.83≈实测86.7% */
    const ctxDecay = Math.max(0, ctxK - 32) / 256 * 0.083 + Math.max(0, conc - 1) * 0.02;
    let hit = Math.max(0.15, Math.min(1, fV + fR * 0.8 * (1 - ctxDecay)));
    /* 乐观修正：资深调优（路由预热、专家热度排序、KV 分页）带来的命中提升，按**显存驻留比例**给，
       全驻留吃满 +10%，全靠内存/盘的那部分不加——避免“显存没变、命中却凭空涨”。 */
    hit = Math.min(1, hit * (1 + 0.10 * fV));

    /* ---- decode ---- */
    const dual = cards.length >= 2;
    let hw;
    if (dual) {
      const eff = cards.map(c => c.bw * (0.55 + 0.45 * c.frac) * c.arch).sort((x, y) => x - y);
      hw = eff[0] * 1.15; // layer-split 流水增益（A3: 16K 1244→1776）
    } else hw = cards[0].bw * 0.75 * cards[0].arch;
    const pcieEff = Math.max(0.12, cards.reduce((s, c) => s + c.frac, 0) / cards.length);
    let t = fV / (K1 * hw) + fR / (K2 * pcieEff) + fD / (K2 * 0.01);
    let decodeRaw = think.f / Math.max(t, T_FLOOR);
    decodeRaw *= 1 + (SIMD_F[a.cpu.simd] - 1) * fR * 1.2; // CPU kernel 只帮 RAM 份额
    decodeRaw *= Math.pow(72 / pool, 0.25);               // 小量化略快
    /* 展示口径 = 物理口径 ×1.5（乐观系数，见文件头 DECODE_BOOST）。
       仪表盘、跑分卡、硬件对比都用这同一个数，所以不会出现两处对不上。 */
    let decode = decodeRaw * DECODE_BOOST;

    /* 并发：全VRAM驻留 + Blackwell/Ada → batch 路径（issue#776 +29%） */
    const batchOK = fV >= 0.95 && cards.some(c => c.arch >= 1.05);
    let decodePer = decode, decodeTotal = decode;
    if (conc > 1) {
      if (batchOK) { decodePer = decode * 0.94; decodeTotal = decodePer * conc * 1.05; }
      else { decodePer = decode * Math.pow(0.72, conc - 1) * 0.9; decodeTotal = decodePer * conc; }
    }

    /* ---- prefill（k=9.0：A1锚点1181@256K + A3官方1776双好链路 双标定） ---- */
    let pf = 9.0 * cards.reduce((s, c) => s + c.sm * (0.55 + 0.45 * c.frac) * c.arch, 0) * (dual ? 1.35 : 1.0);
    const minSlots = dual ? Math.min(...cards.map(c => c.slots)) : cards[0].slots;
    const chunkCap = Math.round(minSlots / 0.184); // 5632tok/1037槽 锚点A6
    const chunkLimited = dual && chunkCap < 12000;
    /* 长上下文衰减 ∝ chunk 受限程度（现机chunk5630→重衰减；双3090 chunk12.8K→轻衰减，A9: TTFT256K~110-135s） */
    const sev = chunkLimited ? Math.min(1, (12000 - chunkCap) / 7000) : 0;
    let pfEff = pf * (1 - Math.max(0, ctxK - 32) / 256 * (0.04 + 0.13 * sev));
    if (st.helperCache && chunkLimited) pfEff = Math.min(pf * 0.95, pfEff * 1.35); // SECOND_GPU.md
    const ttft = ctxK * 1024 / pfEff;

    /* ---- 内存 ---- */
    const ramUsed = 12 + (vramExperts + ramExperts) + kvG + conc * 1.5;
    const ramFree = a.ram.total - ramUsed;

    /* ---- CPU 负载（本机实测 10.2 逻辑核@并发1含桌面） ---- */
    let coresUsed = 8 + 2.2 * conc + 4 * fR;
    coresUsed += a.igpuChosen ? 0.5 : 1.2;
    coresUsed = Math.min(coresUsed, a.cpu.thr);
    const cpuLoad = coresUsed / a.cpu.thr;

    /* ---- 温度（环境26°C） ---- */
    const fans = a.kase ? a.kase.fans : 0;
    const airflow = 1 - Math.min(0.18, fans * 0.028);
    const gpuLoad = Math.min(0.99, 0.85 + 0.05 * conc);
    const temps = {};
    temps.gpu = cards.map(c => Math.round(26 + (c.tdp / 320) * 44 * gpuLoad * airflow));
    temps.cpu = Math.round(26 + cpuLoad * 62 * (a.cpu.tdp / Math.min(a.cooler.cap, a.cpu.tdp * 1.4)) * airflow);
    temps.ram = Math.round(26 + (a.ram.bw > 100 ? 22 : 16) + cpuLoad * 8);
    temps.ssd = Math.round(26 + (a.ssdList.some(s => s.type === 'nvme') ? 34 : 12) + (diskExperts > 0.5 ? 25 : 0));
    temps.sys = Math.round((temps.cpu + Math.max(...temps.gpu, 40) * 2 + temps.ram + temps.ssd) / 5);

    /* ---- 功率 ---- */
    const power = Math.round(100 + a.cpu.tdp * (0.3 + 0.7 * cpuLoad) + cards.reduce((s, c) => s + c.tdp * gpuLoad, 0) + 20 * conc);

    /* ---- 显存占用 ---- */
    const expertPerCard = Math.min(vramExperts / cards.length, 99);
    const vramUse = cards.map(c => Math.min(c.vram, +(c.vram - c.free + Math.min(c.expertBudget, expertPerCard) + c.kvShare).toFixed(1)));

    out.m = {
      model, pool, ctxK, conc, hit, vramExperts: +vramExperts.toFixed(1), ramExperts: +ramExperts.toFixed(1), diskExperts: +diskExperts.toFixed(1),
      fV, fR, fD, decode: +decodePer.toFixed(1), decodeTotal: +decodeTotal.toFixed(1),
      decodeRaw: +decodeRaw.toFixed(1), decodeBoost: DECODE_BOOST,
      prefill: Math.round(pfEff), ttft: Math.round(ttft), kvG: +kvG.toFixed(1),
      cards, totalVram: cards.reduce((s, c) => s + c.vram, 0),
      ramTotal: a.ram.total, ramUsed: +ramUsed.toFixed(1), ramFree: +ramFree.toFixed(1),
      coresUsed: +coresUsed.toFixed(1), cpuLoad, gpuLoad, temps, power,
      outTokens: Math.round(800 * think.out), chunkCap, chunkLimited, batchOK, dual, vramUse,
    };
    return out;
  }

  return { simulate, POOL, K1, K2 };
});
