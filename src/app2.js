/* ============ Strata 装机模拟器 · 状态/动画/仪表盘 ============ */
'use strict';

/* ---- 状态消息 + 三联读数（CPU核显内存显存） ---- */
function updateStatus(a, st) {
  const box = document.getElementById('status');
  let h = '';
  a.errors.forEach(e => h += '<div class="msg e">✗ ' + e + '</div>');
  a.warns.slice(0, 6).forEach(w => h += '<div class="msg w">⚠ ' + w + '</div>');
  if (a.canPost) h += '<div class="msg i">✓ 配置可点亮（POST 通过）——按启动按钮开始仿真</div>';
  box.innerHTML = h;

  /* 三联读数 */
  const ro = document.getElementById('readouts');
  let c1 = '', c2 = '', c3 = '';
  if (a.cpu) {
    const c = a.cpu;
    c1 = '<h4>CPU · ' + c.name + '</h4><div class="big">' + c.p + 'P + ' + c.e + 'E = ' + c.thr + ' 线程</div>' +
      '<div style="font-size:11px;color:var(--dim)">' + ({ '512': 'AVX-512 ✓', vnni: 'AVX-VNNI ✓', avx2: '仅 AVX2' })[c.simd] +
      ' · 核显 ' + c.igpu + ' · PCIe Gen' + c.pcie.gen + ' ×' + c.pcie.lanes + ' 直连</div>' +
      '<div class="bar"><i style="width:' + Math.round(c.p / 16 * 100) + '%;background:var(--cpu)"></i></div>' +
      '<div style="font-size:10px;color:var(--dim)">P核 ' + c.pt + 'T（' + c.p + '核）｜E核 ' + c.et + 'T（' + c.e + '核）</div>';
  } else c1 = '<h4>CPU</h4><div class="big" style="color:var(--dim)">未装配</div>';
  if (a.ram && !a.ram.error) {
    const r = a.ram;
    const slotTxt = r.slots.map((d, i) => d ? ('槽' + (i + 1) + ':' + d.size + 'G') : ('槽' + (i + 1) + ':空')).join(' ');
    c2 = '<h4>内存 · ' + r.total + 'G ' + (r.channels === 2 ? '双通道' : r.channels === 1.5 ? '弹性1.5通道' : '单通道') + '</h4>' +
      '<div class="big">DDR' + r.slots.filter(Boolean)[0].gen + ' @ ' + r.mt + ' MT/s · ' + Math.round(r.bw) + 'GB/s</div>' +
      '<div style="font-size:11px;color:var(--dim)">' + slotTxt + ' · ' + (r.symmetric ? '对称插法 ✓' : '非对称混插 ⚠') + '</div>' +
      (r.derates.length ? '<div style="font-size:10.5px;color:var(--warn)">' + r.derates.join('；') + '</div>' : '');
  } else c2 = '<h4>内存</h4><div class="big" style="color:var(--dim)">' + (a.ram && a.ram.error ? a.ram.error : '未装配') + '</div>';
  if (a.gpuAssign.length) {
    const tot = a.gpuAssign.reduce((s, g) => s + g.vram, 0);
    c3 = '<h4>显存 · ' + tot + 'G ' + (a.gpuAssign.length > 1 ? '双卡 layer-split' : '单卡') + (a.igpuChosen ? ' · 核显输出' : ' · 独卡显示') + '</h4>';
    a.gpuAssign.forEach(g => {
      const col = g.slot.frac >= 0.9 ? 'var(--ok)' : g.slot.frac >= 0.5 ? 'var(--warn)' : 'var(--err)';
      c3 += '<div class="big" style="font-size:12px;color:' + col + '">' + g.name + ' ' + g.vram + 'G · 槽' + g.slot.pos + ' x' + g.slot.lanes + 'Gen' + g.slot.gen + ' ' + g.slot.gbps + 'GB/s</div>';
    });
    const asym = new Set(a.gpuAssign.map(g => g.vram)).size > 1;
    if (asym) c3 += '<div style="font-size:10.5px;color:var(--warn)">非对称显存：K值自动切分（本机实测 K=35/48 层）</div>';
  } else c3 = '<h4>显存</h4><div class="big" style="color:var(--dim)">' + (a.igpuChosen || (a.cpu && a.cpu.igpu !== 'none') ? '核显（decode 个位数）' : '未装配') + '</div>';
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
  h += gauge('解码吞吐', m.decode, 't/s 单流' + (st.conc > 1 ? '｜总 ' + m.decodeTotal : ''), m.decode >= 55 ? '' : m.decode >= 25 ? 'warm' : 'hot');
  h += gauge('预填充速度', m.prefill, 't/s（输入吞吐）');
  h += gauge('首字等待 TTFT', m.ttft >= 100 ? Math.round(m.ttft / 60) + '分' + Math.round(m.ttft % 60) + '秒' : m.ttft + 's', m.ctxK + 'K 上下文');
  h += gauge('专家命中率', Math.round(m.hit * 100) + '%', '显存' + Math.round(m.fV * 100) + '%+内存' + Math.round(m.fR * 100) + '%');
  /* 驻留分布条 */
  h += '<div class="gauge" style="grid-column:span 2;text-align:left"><div class="t">专家驻留（池 ' + m.pool + 'G：显存 ' + m.vramExperts + 'G ｜ 内存 ' + m.ramExperts + 'G ｜ 盘 ' + m.diskExperts + 'G）</div>' +
    '<div class="bar" style="height:14px;display:flex"><i style="width:' + (m.fV * 100) + '%;background:var(--gpu)"></i><i style="width:' + (m.fR * 100) + '%;background:var(--ram)"></i><i style="width:' + (m.fD * 100) + '%;background:var(--warn)"></i></div>' +
    '<div style="font-size:10px;color:var(--dim);margin-top:3px">红=显存常驻(最快) 紫=内存经PCIe流式 黄=盘溢出 ｜ KV ' + m.kvG + 'G' + (m.chunkLimited ? ' ｜ ⚠ chunk≤' + m.chunkCap + '（issue#448）' : '') + (m.batchOK ? ' ｜ batch 路径 ✓' : '') + '</div></div>';
  /* 负载/温度/功率 */
  const cpuPct = Math.round(m.cpuLoad * 100), vramMax = Math.max(...m.vramUse.map((v, i) => v / m.cards[i].vram * 100));
  const ramPct = m.ramUsed / m.ramTotal * 100;
  h += '<div class="gauge" style="text-align:left"><div class="t">负载</div>' +
    '<div style="font-size:10.5px">CPU ' + cpuPct + '%（' + m.coresUsed + '/' + r.hw.cpu.thr + 'T）<div class="bar"><i style="width:' + cpuPct + '%;background:' + (cpuPct > 85 ? 'var(--err)' : 'var(--cpu)') + '"></i></div></div>' +
    '<div style="font-size:10.5px;margin-top:3px">GPU ' + Math.round(m.gpuLoad * 100) + '%（推理满载）<div class="bar"><i style="width:' + Math.round(m.gpuLoad * 100) + '%;background:var(--ok)"></i></div></div>' +
    '<div style="font-size:10.5px;margin-top:3px">显存 ' + Math.round(vramMax) + '%<div class="bar"><i style="width:' + vramMax + '%;background:var(--gpu)"></i></div></div>' +
    '<div style="font-size:10.5px;margin-top:3px">内存 ' + Math.round(ramPct) + '%（余' + m.ramFree + 'G）<div class="bar"><i style="width:' + ramPct + '%;background:' + (ramPct > 90 ? 'var(--err)' : 'var(--ram)') + '"></i></div></div></div>';
  h += '<div class="gauge" style="text-align:left"><div class="t">温度（环境26°C）</div>' +
    m.cards.map((c, i) => '<div style="font-size:10.5px" class="' + tempCls(m.temps.gpu[i]) + '">' + c.name.split(' ')[0] + ' ' + m.temps.gpu[i] + '°C</div>').join('') +
    '<div style="font-size:10.5px" class="' + tempCls(m.temps.cpu) + '">CPU ' + m.temps.cpu + '°C ｜ 内存 ' + m.temps.ram + '°C</div>' +
    '<div style="font-size:10.5px">SSD ' + m.temps.ssd + '°C ｜ 箱内 ' + m.temps.sys + '°C</div></div>';
  h += gauge('整机功率', m.power, 'W（电源 ' + (r.hw.psu ? r.hw.psu.w : '-') + 'W）', r.hw.psu && m.power > r.hw.psu.w * 0.85 ? 'hot' : '');
  h += gauge('本次回答', m.outTokens, 'tokens（思考' + st.think + '）≈ ' + Math.round(m.outTokens / m.decode) + 's');
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

async function boot() {
  const st = settings();
  const a = P.analyze(build, st);
  if (!a.canPost) return;
  running = true;
  const btn = document.getElementById('bootBtn');
  btn.classList.remove('ready'); btn.classList.add('running'); btn.textContent = '运行中';
  document.getElementById('bootLog').innerHTML = '';
  const v3 = window.STRATA_3D && window.isView3d && window.isView3d();
  if (v3) { window.STRATA_3D.sync(build, a); window.STRATA_3D.setPhase('boot'); }
  log('POST：自检开始…');
  await sleep(500);
  log('内存训练：' + a.ram.total + 'G @ ' + a.ram.mt + 'MT/s ' + (a.ram.derates.length ? '（' + a.ram.derates.join('；') + '）' : '✓'), a.ram.derates.length ? 'l-w' : 'l-ok');
  /* 插线动画 */
  log('连接供电线：24pin 主板 / EPS CPU / PCIe 显卡…');
  if (v3) window.STRATA_3D.setPhase('cables');
  document.querySelectorAll('#caseSVG .cable').forEach((c, i) => setTimeout(() => c.classList.add('plug'), i * 350));
  await sleep(v3 ? 2600 : 350 * (document.querySelectorAll('#caseSVG .cable').length + 1));
  log('安装散热器：' + P.byId(build.cooler).name + ' ✓', 'l-ok');
  await sleep(400);
  log('风扇通电：机箱 ' + P.byId(build.case).fans + ' 把 + CPU + 显卡风冷', 'l-ok');
  renderCase(Object.assign(P.analyze(build, st), {})); // 重绘带转扇
  /* 引擎启动 */
  log('strata.exe 启动：--pack ' + (st.model === 'ud_q4' ? 'G:\\llm\\dl\\...\\unsloth-UD-Q4_K_XL' : 'G:\\llm\\Strata-data\\packs\\' + st.model));
  await sleep(700);
  const r = S.simulate(build, st);
  if (!r.ok || !r.m) { log('引擎退出：无可用显示输出', 'l-err'); running = false; btn.textContent = '未就绪'; return; }
  const m = r.m;
  log('PCIe 探测：' + m.cards.map(c => c.name.split(' ')[0] + ' ' + c.gbps + 'GB/s→frac ' + c.frac).join('，'), m.cards.some(c => c.frac < 0.5) ? 'l-w' : 'l-ok');
  log('layer-split auto：' + (m.dual ? '从 46 种排布选 K 值，双卡流水线' : '单卡') + '；专家装载 显存' + m.vramExperts + 'G + 内存arena ' + m.ramExperts + 'G', m.diskExperts > 0.5 ? 'l-w' : 'l-ok');
  if (m.chunkLimited) log('WARNING #448：副卡槽位不足 → prompt chunk ≤ ' + m.chunkCap + '（helper-cache 可缓解）', 'l-w');
  log('session is up ✓ ctx=' + (st.ctx) + ' 并发=' + st.conc, 'l-ok');
  if (v3) window.STRATA_3D.setPhase('run');
  /* prefill→decode 灯光模式：前 6s 红脉冲（prefill），后转绿呼吸（decode） */
  window.__inferMode = 'prefill';
  setTimeout(() => { if (running) window.__inferMode = 'decode'; }, 6000);
  renderDash();
  let dashTimer = window.__dashTimer;
  if (dashTimer) clearInterval(dashTimer);
  window.__dashTimer = setInterval(() => { if (running) renderDash(); }, 2500);
  log('仿真运行中——改上方 Strata 指标或增删配件，仪表盘实时联动');
}
document.getElementById('bootBtn').addEventListener('click', () => { if (!running) boot(); });
