/* ============ Strata 装机模拟器 · 状态/动画/仪表盘 ============ */
'use strict';

/* ---- 状态消息 + 三联读数（CPU核显内存显存） ---- */
function updateStatus(a, st) {
  const box = document.getElementById('status');
  let h = '';
  a.errors.forEach(e => h += '<div class="msg e">✗ ' + e + '</div>');
  a.warns.slice(0, 6).forEach(w => h += '<div class="msg w">⚠ ' + w + '</div>');
  if (a.canPost) h += '<div class="msg i">' + L('✓ 配置可点亮（POST 通过）——按启动按钮开始仿真','✓ This build will POST — press Power on to start the simulation') + '</div>';
  box.innerHTML = h;

  /* 三联读数 */
  const ro = document.getElementById('readouts');
  let c1 = '', c2 = '', c3 = '';
  if (a.cpu) {
    const c = a.cpu;
    c1 = '<h4>CPU · ' + DN(c.name) + '</h4><div class="big">' + c.p + 'P + ' + c.e + 'E = ' + c.thr + L(' 线程',' threads') + '</div>' +
      '<div style="font-size:11px;color:var(--dim)">' + ({ '512': 'AVX-512 ✓', vnni: 'AVX-VNNI ✓', avx2: L('仅 AVX2','AVX2 only') })[c.simd] +
      L(' · 核显 ',' · iGPU ') + c.igpu + ' · PCIe Gen' + c.pcie.gen + ' ×' + c.pcie.lanes + L(' 直连',' CPU-attached') + '</div>' +
      '<div class="bar"><i style="width:' + Math.round(c.p / 16 * 100) + '%;background:var(--cpu)"></i></div>' +
      '<div style="font-size:10px;color:var(--dim)">' + L('P核 ','P-cores ') + c.pt + 'T (' + c.p + L('核）｜E核 ','c) | E-cores ') + c.et + 'T (' + c.e + L('核）','c)') + '</div>';
  } else c1 = '<h4>CPU</h4><div class="big" style="color:var(--dim)">' + L('未装配','Not installed') + '</div>';
  if (a.ram && !a.ram.error) {
    const r = a.ram;
    const chan = r.chan || [];
    const slotName = chan.map((c, i) => c + (chan.slice(0, i + 1).filter(x => x === c).length));
    const slotTxt = r.slots.map((d, i) => d ? (slotName[i] + ':' + d.size + 'G') : (slotName[i] + ':' + L('空','empty'))).join(' ');
    c2 = '<h4>' + L('内存','Memory') + ' · ' + r.total + 'G ' + r.chanLabel + '</h4>' +
      '<div class="big">DDR' + r.slots.filter(Boolean)[0].gen + ' @ ' + r.mt + ' MT/s · ' + Math.round(r.bw) + 'GB/s</div>' +
      '<div style="font-size:11px;color:var(--dim)">' + slotTxt + ' · ' + L(r.symmetric ? '对称插法 ✓' : '非对称混插 ⚠', r.symmetric ? 'symmetric ✓' : 'asymmetric ⚠') + '</div>' +
      (r.derates.length ? '<div style="font-size:10.5px;color:var(--warn)">' + r.derates.join('；') + '</div>' : '');
  } else c2 = '<h4>' + L('内存','Memory') + '</h4><div class="big" style="color:var(--dim)">' + (a.ram && a.ram.error ? a.ram.error : L('未装配','Not installed')) + '</div>';
  if (a.gpuAssign.length) {
    const tot = a.gpuAssign.reduce((s, g) => s + g.vram, 0);
    c3 = '<h4>' + L('显存','VRAM') + ' · ' + tot + 'G ' + L(a.gpuAssign.length > 1 ? '双卡 layer-split' : '单卡', a.gpuAssign.length > 1 ? 'dual layer-split' : 'single card') + L(a.igpuChosen ? ' · 核显输出' : ' · 独卡显示', a.igpuChosen ? ' · iGPU output' : ' · GPU output') + '</h4>';
    a.gpuAssign.forEach(g => {
      const col = g.slot.frac >= 0.9 ? 'var(--ok)' : g.slot.frac >= 0.5 ? 'var(--warn)' : 'var(--err)';
      c3 += '<div class="big" style="font-size:12px;color:' + col + '">' + DN(g.name) + ' ' + g.vram + 'G · ' + L('槽','slot ') + g.slot.pos + ' x' + g.slot.lanes + 'Gen' + g.slot.gen + ' ' + g.slot.gbps + 'GB/s</div>';
    });
    const asym = new Set(a.gpuAssign.map(g => g.vram)).size > 1;
    if (asym) c3 += '<div style="font-size:10.5px;color:var(--warn)">' + L('非对称显存：K值自动切分（本机实测 K=35/48 层）','Asymmetric VRAM: layer split (K) is chosen automatically (measured K=35/48 layers)') + '</div>';
  } else c3 = '<h4>' + L('显存','VRAM') + '</h4><div class="big" style="color:var(--dim)">' + (a.igpuChosen || (a.cpu && a.cpu.igpu !== 'none') ? L('核显（decode 个位数）','iGPU only (single-digit decode)') : L('未装配','Not installed')) + '</div>';
  ro.innerHTML = '<div class="ro">' + c1 + '</div><div class="ro">' + c2 + '</div><div class="ro">' + c3 + '</div>';
  if (running) renderDash();
}

/* ---- 仪表盘 ---- */
function gauge(t, v, u, cls) { return '<div class="gauge ' + (cls || '') + '"><div class="t">' + t + '</div><div class="v">' + v + '</div><div class="u">' + u + '</div></div>'; }
function tempCls(t) { return t >= 88 ? 'hot' : t >= 75 ? 'warm' : ''; }
function renderDash() {
  const st = settings();
  const r = S.simulate(build, st);
  const box = document.getElementById('dash');
  if (!r.ok || !r.m) { box.innerHTML = ''; return; }
  const m = r.m;
  let h = '';
  h += gauge(L('解码吞吐','Decode'), m.decode, 't/s ' + L('单流','per stream') + (st.conc > 1 ? L('｜总 ',' | total ') + m.decodeTotal : ''), m.decode >= 55 ? '' : m.decode >= 25 ? 'warm' : 'hot');
  h += gauge(L('预填充速度','Prefill'), m.prefill, 't/s ' + L('（输入吞吐）','(prompt throughput)'));
  h += gauge(L('首字等待 TTFT','Time to first token'), m.ttft >= 100 ? Math.round(m.ttft / 60) + L('分','m ') + Math.round(m.ttft % 60) + L('秒','s') : m.ttft + 's', m.ctxK + 'K ' + L('上下文','context'));
  h += gauge(L('专家命中率','Expert hit rate'), Math.round(m.hit * 100) + '%', L('显存','VRAM ') + Math.round(m.fV * 100) + '%+' + L('内存','RAM ') + Math.round(m.fR * 100) + '%');
  /* 驻留分布条 */
  h += '<div class="gauge" style="grid-column:span 2;text-align:left"><div class="t">' + L('专家驻留（池 ','Expert residency (pool ') + m.pool + 'G: ' + L('显存 ','VRAM ') + m.vramExperts + 'G | ' + L('内存 ','RAM ') + m.ramExperts + 'G | ' + L('盘 ','disk ') + m.diskExperts + 'G)' + '</div>' +
    '<div class="bar" style="height:14px;display:flex"><i style="width:' + (m.fV * 100) + '%;background:var(--gpu)"></i><i style="width:' + (m.fR * 100) + '%;background:var(--ram)"></i><i style="width:' + (m.fD * 100) + '%;background:var(--warn)"></i></div>' +
    '<div style="font-size:10px;color:var(--dim);margin-top:3px">' + L('红=显存常驻(最快) 紫=内存经PCIe流式 黄=盘溢出 ｜ KV ','red = resident in VRAM (fastest) · purple = streamed from RAM over PCIe · yellow = disk spill | KV ') + m.kvG + 'G' + (m.chunkLimited ? L(' ｜ ⚠ chunk≤',' | ⚠ chunk≤') + m.chunkCap + L('（issue#448）',' (issue #448)') : '') + (m.batchOK ? L(' ｜ batch 路径 ✓',' | batch path ✓') : '') + '</div></div>';
  /* 负载/温度/功率 */
  const cpuPct = Math.round(m.cpuLoad * 100), vramMax = Math.max(...m.vramUse.map((v, i) => v / m.cards[i].vram * 100));
  const ramPct = m.ramUsed / m.ramTotal * 100;
  h += '<div class="gauge" style="text-align:left"><div class="t">' + L('负载','Load') + '</div>' +
    '<div style="font-size:10.5px">CPU ' + cpuPct + '%' + L('（',' (') + m.coresUsed + '/' + r.hw.cpu.thr + 'T)<div class="bar"><i style="width:' + cpuPct + '%;background:' + (cpuPct > 85 ? 'var(--err)' : 'var(--cpu)') + '"></i></div></div>' +
    '<div style="font-size:10.5px;margin-top:3px">GPU ' + Math.round(m.gpuLoad * 100) + '%' + L('（推理满载）',' (inference)') + '<div class="bar"><i style="width:' + Math.round(m.gpuLoad * 100) + '%;background:var(--ok)"></i></div></div>' +
    '<div style="font-size:10.5px;margin-top:3px">' + L('显存 ','VRAM ') + Math.round(vramMax) + '%<div class="bar"><i style="width:' + vramMax + '%;background:var(--gpu)"></i></div></div>' +
    '<div style="font-size:10.5px;margin-top:3px">' + L('内存 ','RAM ') + Math.round(ramPct) + '%' + L('（余','(free ') + m.ramFree + 'G)<div class="bar"><i style="width:' + ramPct + '%;background:' + (ramPct > 90 ? 'var(--err)' : 'var(--ram)') + '"></i></div></div></div>';
  h += '<div class="gauge" style="text-align:left"><div class="t">' + L('温度（环境26°C）','Temperatures (26°C ambient)') + '</div>' +
    m.cards.map((c, i) => '<div style="font-size:10.5px" class="' + tempCls(m.temps.gpu[i]) + '">' + DN(c.name).split(' ')[0] + ' ' + m.temps.gpu[i] + '°C</div>').join('') +
    '<div style="font-size:10.5px" class="' + tempCls(m.temps.cpu) + '">CPU ' + m.temps.cpu + '°C' + L(' ｜ 内存 ',' | RAM ') + m.temps.ram + '°C</div>' +
    '<div style="font-size:10.5px">SSD ' + m.temps.ssd + '°C' + L(' ｜ 箱内 ',' | in case ') + m.temps.sys + '°C</div></div>';
  h += gauge(L('整机功率','Wall power'), m.power, 'W ' + L('（电源 ','(PSU ') + (r.hw.psu ? r.hw.psu.w : '-') + 'W)', r.hw.psu && m.power > r.hw.psu.w * 0.85 ? 'hot' : '');
  h += gauge(L('本次回答','This answer'), m.outTokens, 'tokens (' + L('思考','thinking: ') + st.think + ') ≈ ' + Math.round(m.outTokens / m.decode) + 's');
  box.innerHTML = h;
  /* 遥测推送 3D（风扇转速按温度） */
  if (window.STRATA_3D && window.isView3d && window.isView3d()) {
    window.STRATA_3D.setTelemetry(Object.assign({}, m, { mode: window.__inferMode || 'decode' }));
  }
}

/* ---- 开机流程 ---- */
const log = (t, cls) => {
  const el = document.getElementById('bootLog');
  el.innerHTML += '<div class="' + (cls || '') + '">[' + new Date().toLocaleTimeString() + '] ' + t + '</div>';
  el.scrollTop = el.scrollHeight;
};
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* boot 代际令牌：点停机/重新开机时递增，使旧的异步 boot 流程在下一个 await 处作废，
 * 避免"启动动画跑到一半被停止、剩余步骤又把状态改回运行中"的竞态 */
let bootGen = 0;
/* 跑分按钮的可用状态只跟「机器是否已经跑起来」有关。
 * 之前只在 onChange（改配置）里刷新，点完启动后就再也没人碰它 →
 * 机器明明在跑，按钮还是灰的。这里收口成一个函数，boot/shutdown/onChange 都调它。 */
window.syncBenchBtn = function () {
  const bb = document.getElementById('benchBtn');
  if (!bb) return;
  bb.disabled = !running;
  bb.title = running ? L('跑一遍 StrataBench','Run StrataBench') : L('先按「启动」点亮机器','Press Power on first');
};
async function boot() {
  const st = settings();
  const a = P.analyze(build, st);
  if (!a.canPost) return;
  const gen = ++bootGen;
  running = true;
  window.syncBenchBtn();
  const btn = document.getElementById('bootBtn');
  btn.classList.remove('ready'); btn.classList.add('running'); btn.textContent = L('停止','Stop');
  btn.title = L('点击停止仿真','Click to stop the simulation');
  document.getElementById('bootLog').innerHTML = '';
  const v3 = window.STRATA_3D && window.isView3d && window.isView3d();
  const alive = () => gen === bootGen && running; // 每步 await 后校验，停机即中断
  if (v3) { window.STRATA_3D.sync(build, a); window.STRATA_3D.setPhase('boot'); }
  log(L('POST：自检开始…','POST: self-test…'));
  await sleep(500); if (!alive()) return;
  log(L('内存训练：','Memory training: ') + a.ram.total + 'G @ ' + a.ram.mt + 'MT/s ' + (a.ram.derates.length ? '(' + a.ram.derates.join('; ') + ')' : '✓'), a.ram.derates.length ? 'l-w' : 'l-ok');
  /* 插线动画 */
  log(L('连接供电线：24pin 主板 / EPS CPU / PCIe 显卡…','Connecting power: 24-pin board / EPS CPU / PCIe GPU…'));
  if (v3) window.STRATA_3D.setPhase('cables');
  document.querySelectorAll('#caseSVG .cable').forEach((c, i) => setTimeout(() => c.classList.add('plug'), i * 350));
  await sleep(v3 ? 2600 : 350 * (document.querySelectorAll('#caseSVG .cable').length + 1)); if (!alive()) return;
  log(L('安装散热器：','Mounting cooler: ') + DN(P.byId(build.cooler).name) + ' ✓', 'l-ok');
  await sleep(400); if (!alive()) return;
  log(L('风扇通电：机箱 ' + P.byId(build.case).fans + ' 把 + CPU + 显卡风冷','Fans powered: ' + P.byId(build.case).fans + ' case fans + CPU + GPU'), 'l-ok');
  renderCase(Object.assign(P.analyze(build, st), {})); // 重绘带转扇
  /* 引擎启动 */
  log(L('strata.exe 启动：','strata.exe starting: ') + '--pack ' + (st.model === 'ud_q4' ? 'G:\\llm\\dl\\...\\unsloth-UD-Q4_K_XL' : 'G:\\llm\\Strata-data\\packs\\' + st.model));
  await sleep(700); if (!alive()) return;
  const r = S.simulate(build, st);
  if (!r.ok || !r.m) { log(L('引擎退出：无可用显示输出','Engine exited: no usable display output'), 'l-err'); shutdown(); return; }
  const m = r.m;
  log(L('PCIe 探测：','PCIe probe: ') + m.cards.map(c => DN(c.name).split(' ')[0] + ' ' + c.gbps + 'GB/s → frac ' + c.frac).join(', '), m.cards.some(c => c.frac < 0.5) ? 'l-w' : 'l-ok');
  log(L('layer-split auto：','layer-split auto: ') + L(m.dual ? '从 46 种排布选 K 值，双卡流水线' : '单卡', m.dual ? 'K chosen from 46 layouts, dual-card pipeline' : 'single card') + L('；专家装载 显存','; experts in VRAM ') + m.vramExperts + 'G + ' + L('内存arena ','RAM arena ') + m.ramExperts + 'G', m.diskExperts > 0.5 ? 'l-w' : 'l-ok');
  if (m.chunkLimited) log(L('WARNING #448：副卡槽位不足 → prompt chunk ≤ ','WARNING #448: second-card slots too small → prompt chunk ≤ ') + m.chunkCap + L('（helper-cache 可缓解）',' (helper-cache helps)'), 'l-w');
  log(L('session is up ✓ ctx=','session is up ✓ ctx=') + (st.ctx) + L(' 并发=',' streams=') + st.conc, 'l-ok');
  if (v3) window.STRATA_3D.setPhase('run');
  /* prefill→decode 灯光模式：前 6s 红脉冲（prefill），后转绿呼吸（decode） */
  window.__inferMode = 'prefill';
  setTimeout(() => { if (alive()) window.__inferMode = 'decode'; }, 6000);
  renderDash();
  if (window.__dashTimer) clearInterval(window.__dashTimer);
  window.__dashTimer = setInterval(() => { if (running) renderDash(); }, 2500);
  log(L('仿真运行中——改上方 Strata 指标或增删配件，仪表盘实时联动；点右侧停止按钮可关机','Simulation running — change the Strata settings or swap parts and the dashboard follows; press Stop to shut down.'));
}
/* 停机：清定时器 + 3D 回 idle + 按钮复位，可再次启动 */
function shutdown() {
  bootGen++;
  running = false;
  window.syncBenchBtn();
  if (window.__dashTimer) { clearInterval(window.__dashTimer); window.__dashTimer = null; }
  window.__inferMode = 'decode';
  const v3 = window.STRATA_3D && window.isView3d && window.isView3d();
  if (v3) window.STRATA_3D.setPhase('idle');
  log(L('引擎退出：用户停止仿真（strata.exe 已退出，可改配置后重新启动）','Engine exited: stopped by user (strata.exe quit; change the config and power on again)'), 'l-w');
  onChange(); // 按钮/风扇/读数回到未运行态
}
document.getElementById('bootBtn').addEventListener('click', () => { if (!running) boot(); else shutdown(); });

/* ---- StrataBench 跑分：一段有仪式感的序列 + 结果卡 ---- */
let benchGen = 0;
function brow(k, v) { return '<div class="row"><span>' + k + '</span><b>' + v + '</b></div>'; }
async function runBench() {
  if (!running) return;
  const ov = document.getElementById('benchOv');
  const bar = ov.querySelector('.bar i');
  const res = ov.querySelector('.res');
  const ttl = ov.querySelector('.ttl');
  const st = settings(), m = S.simulate(build, st).m;
  const gen = ++benchGen;
  ov.style.display = 'flex';
  bar.style.width = '0%';
  ttl.textContent = 'StrataBench 跑分';
  const steps = ['风扇提速 · 温度爬升', 'prefill：灌入 8K 提示词', 'decode：连续生成 512 tokens', '汇总'];
  for (let i = 0; i < steps.length; i++) {
    if (gen !== benchGen) return;
    res.innerHTML = '<div class="ph">' + steps[i] + ' …</div>';
    await sleep(620 + Math.random() * 380);
    bar.style.width = Math.round((i + 1) / steps.length * 100) + '%';
  }
  if (gen !== benchGen) return;
  /* 综合分 =（解码×100 + Prefill×3）× 乐观系数。
   * 系数只作用在这一个自造的综合分上——解码 t/s、温度、功率这些物理量不动，
   * 因为它们同时驱动仪表盘，掺水会和别处的数字对不上。 */
  const SCORE_SCALE = 1.4;
  const score = Math.round((m.decode * 100 + m.prefill * 3) * SCORE_SCALE);
  ttl.textContent = 'StrataBench · 完成';
  res.innerHTML =
    brow('解码吞吐', m.decode.toFixed(1) + ' t/s' + (st.conc > 1 ? '（总 ' + m.decodeTotal.toFixed(1) + '）' : '')) +
    brow('Prefill', Math.round(m.prefill) + ' t/s') +
    brow('首字延迟 TTFT', m.ttft >= 100 ? Math.round(m.ttft / 60) + ' 分 ' + Math.round(m.ttft % 60) + ' 秒' : m.ttft + ' s') +
    brow('整机功率', Math.round(m.power) + ' W') +
    brow('GPU 温度', m.temps.gpu.join(' / ') + ' °C') +
    '<div class="score">' + score.toLocaleString() + '</div>' +
    '<div class="sl">综合分 =（解码×100 + Prefill×3）× 1.4 —— 只用于同配置横向比较</div>';
}
document.getElementById('benchBtn').addEventListener('click', runBench);
document.getElementById('benchClose').addEventListener('click', () => {
  benchGen++;                                   // 作废还在跑的流程
  document.getElementById('benchOv').style.display = 'none';
});
