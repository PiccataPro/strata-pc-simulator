/* ============ Strata 装机模拟器 · 装配与渲染 ============ */
'use strict';
const P = window.STRATA_PARTS, S = window.STRATA_SIM;

/* ---- 状态 ---- */
const build = { cpu: null, mobo: null, ram: [], gpu: [], ssd: [], psu: null, cooler: null, case: null };
let running = false, phase = 'idle'; // idle|cables|boot|run
const CATS = [
  { k: 'cpu', arr: 'cpus', t: 'CPU 处理器' }, { k: 'mobo', arr: 'mobos', t: '主板' }, { k: 'ram', arr: 'dimms', t: '内存条（拖多次=多槽）' },
  { k: 'gpu', arr: 'gpus', t: '显卡（最多2张）' }, { k: 'ssd', arr: 'ssds', t: 'SSD / 存储' },
  { k: 'psu', arr: 'psus', t: '电源' }, { k: 'cooler', arr: 'coolers', t: 'CPU 散热器' }, { k: 'case', arr: 'cases', t: '机箱' },
];

function settings() {
  return {
    model: document.getElementById('sModel').value,
    ctx: +document.getElementById('sCtx').value * 1024,
    conc: +document.getElementById('sConc').value,
    think: document.getElementById('sThink').value,
    igpuDisplay: document.getElementById('sIgpu').checked,
    helperCache: document.getElementById('sHelper').checked,
  };
}
function totalPrice() {
  let s = 0;
  if (build.cpu) s += P.byId(build.cpu).price;
  if (build.mobo) s += P.byId(build.mobo).price;
  if (build.psu) s += P.byId(build.psu).price;
  if (build.cooler) s += P.byId(build.cooler).price;
  if (build.case) s += P.byId(build.case).price;
  build.ram.filter(Boolean).forEach(r => s += P.byId(r).price);
  build.gpu.forEach(g => s += P.byId(g).price);
  build.ssd.forEach(x => s += P.byId(x).price);
  return s;
}

/* ---- 货架 ---- */
const MULTI = { ram: 4, gpu: 2, ssd: 4 }; // 可重复装配的品类及上限
function renderShelves() {
  /* 单件制品类：装了就置灰；多件制（内存/显卡/SSD）：显示已装×N，到上限才置灰 */
  const inUse = new Set([build.cpu, build.mobo, build.psu, build.cooler, build.case].filter(Boolean));
  const cnt = {};
  [].concat(build.ram.filter(Boolean), build.gpu, build.ssd).forEach(id => { cnt[id] = (cnt[id] || 0) + 1; });
  const half = Math.ceil(CATS.length / 2);
  [[document.getElementById('shelfL'), CATS.slice(0, half)], [document.getElementById('shelfR'), CATS.slice(half)]].forEach(([el, cats]) => {
    el.innerHTML = '';
    cats.forEach(c => {
      const h = document.createElement('h3'); h.textContent = c.t; el.appendChild(h);
      P[c.arr].forEach(p => {
        const n = cnt[p.id] || 0, lim = c.k === 'ram' ? ramSlotCount() : MULTI[c.k]; // 内存上限=当前主板槽数
        const d = document.createElement('div');
        d.className = 'part cat-' + c.k + ((inUse.has(p.id) || (lim && n >= lim)) ? ' inuse' : '');
        d.draggable = true; d.dataset.id = p.id; d.dataset.cat = c.k;
        const sp = c.k === 'cpu' ? (p.p + 'P' + (p.e ? '+' + p.e + 'E' : '') + '/' + p.thr + 'T · ' + ({ '512': 'AVX-512', vnni: 'AVX-VNNI', avx2: 'AVX2' })[p.simd] + (p.igpu !== 'none' ? ' · 核显' : ' · 无核显'))
          : c.k === 'mobo' ? (p.socket + ' · DDR' + p.ddr + ' · 槽:' + p.slots.map(s => 'x' + s.lanes + (s.src === 'cpu' ? 'CPU' : '芯')).join('+'))
          : c.k === 'ram' ? ('DDR' + p.gen + ' ' + p.size + 'G ' + p.mt + 'MT/s')
          : c.k === 'gpu' ? (p.vram + 'G · ' + p.bw + 'GB/s · SM' + p.sm + ' · ' + p.tdp + 'W' + (p.mod ? ' · 魔改' : ''))
          : c.k === 'ssd' ? (p.type === 'nvme' ? 'NVMe Gen' + p.gen + ' ' + p.read + 'MB/s' : 'SATA机械 ' + p.read + 'MB/s')
          : c.k === 'psu' ? (p.w + 'W · 8pin×' + p.conn8 + ' · 16pin×' + p.conn16pin)
          : c.k === 'cooler' ? ('解热' + p.cap + 'W · ' + (p.type === 'aio' ? '360水冷' : '风冷'))
          : ('限长' + p.gpuMaxLen + 'mm · ' + p.fans + '风扇');
        d.innerHTML = '<span class="pr">¥' + p.price.toLocaleString() + (lim && n ? ' <b style="color:#3fd68f">已装×' + n + '/' + lim + '</b>' : '') + '</span><div class="nm">' + p.name + '</div><div class="sp">' + sp + '</div>' + (p.note ? '<div class="sp" style="color:#6fa8dc">📌' + p.note.slice(0, 46) + (p.note.length > 46 ? '…' : '') + '</div>' : '');
        d.title = p.note || '';
        d.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', p.id); });
        d.addEventListener('dblclick', () => install(p.id, p.cat));
        el.appendChild(d);
      });
    });
  });
}

/* ---- 装配/拆除 ----
 * 内存为槽位制：build.ram 稀疏数组，build.ram[i]=null|条id，i=物理槽（A1A2B1B2…）。
 * 自动落位优先 A2/B2（每通道第2槽，主板手册推荐首选），再 A1/B1。 */
function ramSlotCount() { const m = build.mobo ? P.byId(build.mobo) : null; return m ? m.memSlots : 4; }
function ramPickSlot() {
  const n = ramSlotCount();
  const order = [];
  for (let i = 0; i < n; i++) if (i % 2 === 1) order.push(i); // 各组第2槽优先（A2,B2,C2…）
  for (let i = 0; i < n; i++) if (i % 2 === 0) order.push(i); // 再第1槽（A1,B1…）
  for (const i of order) if (!build.ram[i]) return i;
  return -1;
}
/* ---- 台面备用件：从机箱拆下来的零件不再凭空消失，摆到桌上待用 ---- */
let spares = [], spareSeq = 0;
function addSpare(id, cat) {
  if (!id || cat === 'case') return;            // 整只机箱不留台面
  spares.push({ uid: 'sp' + (++spareSeq), id, cat });
}
function consumeSpare(id, uid) {
  const i = uid ? spares.findIndex(s => s.uid === uid) : spares.findIndex(s => s.id === id);
  if (i >= 0) spares.splice(i, 1);
}
window.delSpare = uid => { spares = spares.filter(s => s.uid !== uid); onChange(); };

function install(id, cat, slotIdx, uid) {
  /* 注意：先装成功再吃掉台面上的那只。
     原来是把 consumeSpare 放在最前面，槽位已满（比如已有两张卡）时会先删掉备用件、
     然后在下面的长度判断里直接 return —— 结果就是「点了装不回去，零件还凭空消失」。 */
  if (cat === 'ram') {
    const n = ramSlotCount();
    while (build.ram.length < n) build.ram.push(null);
    const i = (slotIdx != null && slotIdx >= 0 && slotIdx < n) ? slotIdx : ramPickSlot();
    if (i < 0) return false;
    build.ram[i] = id; // 占用槽→替换
  }
  else if (cat === 'gpu') {
    if (build.gpu.length >= 2) return false;
    build.gpu.push(id);
  }
  else if (cat === 'ssd') {
    if (build.ssd.length >= 4) return false;
    build.ssd.push(id);
  }
  else build[cat] = id;
  consumeSpare(id, uid);
  onChange();
  return true;
}
/* 点台面上的零件 → 装回机箱（3D 视图里点一下就走这条路） */
window.installSpare = uid => {
  const s = spares.find(x => x.uid === uid);
  if (!s) return;
  if (!install(s.id, s.cat, null, uid)) {
    const nm = (P.byId(s.id) || {}).name || s.cat;
    alert('装不回去了：' + nm + ' 对应的插槽已满（显卡最多 2 张 / 固态最多 4 块 / 内存槽已插满）');
  }
};
function removePart(cat, idx) {
  if (cat === 'ram') {
    const id = build.ram[idx]; addSpare(id, 'ram');
    build.ram[idx] = null; onChange(); return;
  }
  if (cat === 'gpu' || cat === 'ssd') {
    addSpare(build[cat][idx], cat);
    build[cat].splice(idx, 1);
  } else {
    addSpare(build[cat], cat);
    build[cat] = null;
  }
  onChange();
}

/* ---- 机箱 SVG（写实侧透：主板托盘/PCIe槽/CPU座/内存槽/M.2/电源仓/风扇位） ---- */
const SLOT_GEO = { // 主板布局：CPU座、内存槽、PCIe槽位（物理槽1-4）
  mobo: { x: 150, y: 60, w: 380, h: 330 },
  cpuSock: { x: 250, y: 100, w: 92, h: 92 },
  ramSlots: [{ x: 400, y: 92 }, { x: 418, y: 92 }, { x: 436, y: 92 }, { x: 454, y: 92 }],
  pcieSlots: { 1: { x: 175, y: 250, w: 210, h: 26 }, 2: { x: 175, y: 292, w: 150, h: 22 }, 3: { x: 175, y: 322, w: 150, h: 22 }, 4: { x: 175, y: 352, w: 190, h: 26 } },
  m2: [{ x: 175, y: 285 }, { x: 175, y: 318 }],
  psuBay: { x: 150, y: 430, w: 380, h: 90 },
  coolerPos: { x: 236, y: 86 },
  frontFans: [{ x: 60, y: 110 }, { x: 60, y: 210 }, { x: 60, y: 310 }],
  rearFan: { x: 552, y: 80 },
  gpuPos: [{ x: 178, y: 236 }, { x: 178, y: 338 }],
};

function fanSVG(cx, cy, r, cls, color) {
  let blades = '';
  for (let i = 0; i < 7; i++) blades += '<path d="M0,0 Q' + (r * .55) + ',' + (-r * .28) + ' ' + (r * .82 * Math.cos(i * 0.9)) + ',' + (-r * .82 * Math.sin(i * 0.9)) + '" stroke="' + color + '" stroke-width="' + (r * .16) + '" fill="none" stroke-linecap="round" transform="rotate(' + (i * 51.4) + ')"/>';
  return '<g class="fan ' + cls + '" transform="translate(' + cx + ',' + cy + ')"><circle r="' + (r + 4) + '" fill="#0a0e15" stroke="#39465c" stroke-width="2"/>' +
    '<circle r="' + r + '" fill="#11161f"/>' + blades + '<circle r="' + (r * .3) + '" fill="#1d2635" stroke="#4a5a74"/>' +
    '<circle r="' + (r + 4) + '" fill="none" stroke="' + color + '" stroke-width="1" opacity=".5" class="led"/></g>';
}

function renderCase(a) {
  const svg = document.getElementById('caseSVG');
  const G = SLOT_GEO;
  let s = '';
  let slotName = []; // 内存槽名（A1A2B1B2…），供空槽点击处理器闭包引用
  /* 机箱框架 */
  s += '<rect x="30" y="30" width="620" height="500" rx="16" fill="#151b27" stroke="#3a475c" stroke-width="3"/>';
  s += '<rect x="42" y="42" width="596" height="476" rx="10" fill="#0e131d" stroke="#232d3f"/>';
  /* 电源仓隔断 */
  s += '<rect x="140" y="418" width="410" height="6" fill="#1a2230"/>';
  /* 主板 */
  if (build.mobo) {
    const m = P.byId(build.mobo);
    s += '<g class="partBox" data-cat="mobo"><rect x="' + G.mobo.x + '" y="' + G.mobo.y + '" width="' + G.mobo.w + '" height="' + G.mobo.h + '" rx="6" fill="#14202e" stroke="#3fd68f" stroke-width="1.5"/>';
    s += '<text x="' + (G.mobo.x + 8) + '" y="' + (G.mobo.y + 16) + '" fill="#7fd1a0" font-size="11">' + m.name + '（' + m.socket + '）</text>';
    /* PCIe 槽（电气着色） */
    a.pcie.forEach(p => {
      const g = G.pcieSlots[p.pos]; if (!g) return;
      const col = p.frac >= 0.9 ? '#3fd68f' : p.frac >= 0.5 ? '#ffb454' : '#ff5d6c';
      s += '<rect x="' + g.x + '" y="' + g.y + '" width="' + g.w + '" height="' + g.h + '" rx="3" fill="#0a0f18" stroke="' + col + '" stroke-width="1.6"/>';
      s += '<text x="' + (g.x + g.w + 6) + '" y="' + (g.y + 15) + '" fill="' + col + '" font-size="10">槽' + p.pos + ' x' + p.lanes + ' Gen' + p.gen + ' · ' + p.gbps + 'GB/s · frac ' + p.frac + (p.src === 'chipset' ? ' 芯片组' : '') + '</text>';
    });
    /* 内存槽（稀疏槽位制：索引0=CPU侧最近槽；同字母=同通道，典型 A1A2B1B2） */
    const chan = m.memChan || Array.from({ length: m.memSlots }, (_, i) => String.fromCharCode(65 + Math.floor(i / 2)));
    slotName = chan.map((c, i) => c + (chan.slice(0, i + 1).filter(x => x === c).length));
    for (let i = 0; i < m.memSlots; i++) {
      const x = 400 + i * 18;
      const filled = build.ram[i];
      s += '<rect x="' + x + '" y="92" width="10" height="120" rx="2" fill="' + (filled ? '#2a1f45' : '#0a0f18') + '" stroke="' + (filled ? '#b98cff' : '#39465c') + '" stroke-dasharray="' + (filled ? 'none' : '4 3') + '"' + (filled ? ' class="partBox" data-cat="ram" data-idx="' + i + '"' : ' class="ramSlotEmpty" data-slot="' + i + '"') + '/>';
      s += '<text x="' + (x + 5) + '" y="' + (92 + 128) + '" fill="' + (filled ? '#b98cff' : '#5c6b82') + '" font-size="8" text-anchor="middle" pointer-events="none">' + slotName[i] + '</text>';
    }
    if (build.ram.filter(Boolean).length && a.ram && !a.ram.error) {
      const rr = a.ram;
      s += '<text x="' + G.ramSlots[0].x + '" y="' + (G.ramSlots[0].y + 148) + '" fill="#b98cff" font-size="10">' + rr.total + 'G ' + rr.chanLabel + ' @' + rr.mt + (rr.derates.length ? ' ⚠' : '') + '</text>';
    }
    /* M.2 */
    build.ssd.forEach((x, i) => {
      const g = G.m2[i % 2]; const off = i >= 2 ? 24 : 0;
      s += '<g class="partBox" data-cat="ssd" data-idx="' + i + '"><rect x="' + g.x + '" y="' + (g.y + 30 + off) + '" width="70" height="12" rx="2" fill="#0f2a26" stroke="#54d6c8"/><text x="' + (g.x + 76) + '" y="' + (g.y + 40 + off) + '" fill="#54d6c8" font-size="9">' + P.byId(x).name + '</text></g>';
    });
    s += '</g>';
  } else {
    s += '<rect x="' + G.mobo.x + '" y="' + G.mobo.y + '" width="' + G.mobo.w + '" height="' + G.mobo.h + '" rx="6" fill="none" stroke="#2d3646" stroke-dasharray="6 4"/><text x="290" y="230" fill="#3d4a61" font-size="13">拖入主板</text>';
  }
  /* CPU + 散热器 */
  if (build.cpu) {
    const c = P.byId(build.cpu), k = G.cpuSock;
    s += '<g class="partBox" data-cat="cpu"><rect x="' + k.x + '" y="' + k.y + '" width="' + k.w + '" height="' + k.h + '" rx="4" fill="#101c2c" stroke="#3fb6ff" stroke-width="1.5"/>';
    if (!build.cooler) s += '<text x="' + (k.x + 8) + '" y="' + (k.y + 40) + '" fill="#3fb6ff" font-size="9">' + c.name + '</text>';
    s += '</g>';
    if (build.cooler) {
      const co = P.byId(build.cooler), p = G.coolerPos;
      if (co.type === 'aio') {
        s += '<g class="partBox" data-cat="cooler"><rect x="' + p.x + '" y="' + p.y + '" width="120" height="120" rx="8" fill="#182233" stroke="#7fd1ff" opacity=".95"/>';
        s += '<circle cx="' + (p.x + 60) + '" cy="' + (p.y + 60) + '" r="34" fill="#0d1520" stroke="#7fd1ff"/>';
        s += fanSVG(p.x + 60, p.y + 60, 26, running ? 'spinning' : '', '#7fd1ff');
        s += '<path d="M' + (p.x + 100) + ',' + (p.y + 20) + ' C 420,40 480,60 540,50 M' + (p.x + 100) + ',' + (p.y + 30) + ' C 420,55 480,75 540,66" stroke="#2c3a52" stroke-width="7" fill="none" class="cable' + (running ? ' done' : '') + '" data-cab="aio"/>';
        s += '<text x="' + (p.x + 14) + '" y="' + (p.y + 114) + '" fill="#7fd1ff" font-size="9">360水冷</text></g>';
      } else {
        s += '<g class="partBox" data-cat="cooler"><rect x="' + p.x + '" y="' + p.y + '" width="120" height="120" rx="4" fill="#141d2b" stroke="#7fd1ff"/>';
        for (let i = 0; i < 9; i++) s += '<rect x="' + (p.x + 8 + i * 12) + '" y="' + (p.y + 6) + '" width="4" height="108" fill="#22304a"/>';
        s += fanSVG(p.x + 60, p.y + 60, 30, running ? 'spinning' : '', '#7fd1ff');
        s += '<text x="' + (p.x + 14) + '" y="' + (p.y + 116) + '" fill="#7fd1ff" font-size="9">' + co.name + '</text></g>';
      }
    }
  }
  /* 显卡（按分配槽位渲染，厚度=块高） */
  a.gpuAssign.forEach((g, i) => {
    const slot = G.pcieSlots[g.slotPos] || G.pcieSlots[4];
    const hgt = 20 + g.thick * 14;
    const col = g.slot.frac >= 0.9 ? '#3fd68f' : g.slot.frac >= 0.5 ? '#ffb454' : '#ff5d6c';
    s += '<g class="partBox" data-cat="gpu" data-idx="' + i + '">';
    s += '<rect x="' + slot.x + '" y="' + (slot.y - 4) + '" width="' + (slot.w + 40) + '" height="' + hgt + '" rx="4" fill="#1a1220" stroke="' + col + '" stroke-width="1.6"/>';
    s += fanSVG(slot.x + 40, slot.y + hgt / 2 - 4, Math.min(16, hgt / 2 - 3), running ? 'spinning fast' : '', '#ff4d6d');
    s += fanSVG(slot.x + 100, slot.y + hgt / 2 - 4, Math.min(16, hgt / 2 - 3), running ? 'spinning fast' : '', '#ff4d6d');
    s += '<text x="' + (slot.x + 140) + '" y="' + (slot.y + 14) + '" fill="#ff8fa5" font-size="10">' + g.name + ' · ' + g.vram + 'G</text>';
    s += '<text x="' + (slot.x + 140) + '" y="' + (slot.y + 27) + '" fill="' + col + '" font-size="9">x' + g.slot.lanes + ' ' + g.slot.gbps + 'GB/s frac' + g.slot.frac + ' · ' + g.tdp + 'W</text>';
    /* 供电线 */
    s += '<path d="M150,470 C 160,' + (slot.y + 60) + ' 170,' + (slot.y + 40) + ' ' + (slot.x + 10) + ',' + (slot.y + 10) + '" stroke="#ffd166" stroke-width="4" fill="none" opacity=".85" class="cable' + (running ? ' done' : '') + '" data-cab="gpu' + i + '"/>';
    s += '</g>';
  });
  /* 电源 */
  if (build.psu) {
    const ps = P.byId(build.psu), b = G.psuBay;
    s += '<g class="partBox" data-cat="psu"><rect x="' + b.x + '" y="' + (b.y + 14) + '" width="200" height="66" rx="6" fill="#1c1a12" stroke="#ffd166"/>';
    s += fanSVG(b.x + 40, b.y + 47, 24, running ? 'spinning' : '', '#ffd166');
    s += '<text x="' + (b.x + 76) + '" y="' + (b.y + 42) + '" fill="#ffd166" font-size="10">' + ps.name + '</text>';
    s += '<text x="' + (b.x + 76) + '" y="' + (b.y + 58) + '" fill="#8b98ab" font-size="9">24pin 主供电</text></g>';
    s += '<path d="M350,' + (b.y + 24) + ' C 380,380 400,300 520,80" stroke="#ffd166" stroke-width="5" fill="none" opacity=".8" class="cable' + (running ? ' done' : '') + '" data-cab="atx"/>';
    s += '<path d="M350,' + (b.y + 34) + ' C 340,300 320,240 ' + (G.cpuSock.x + 100) + ',' + (G.cpuSock.y + 10) + '" stroke="#3fb6ff" stroke-width="4" fill="none" opacity=".8" class="cable' + (running ? ' done' : '') + '" data-cab="eps"/>';
  }
  /* 机箱风扇 + 前置面板 */
  if (build.case) {
    const cs = P.byId(build.case);
    G.frontFans.slice(0, cs.fans >= 3 ? 3 : cs.fans).forEach((f, i) => { s += fanSVG(f.x + 22, f.y + 60, 34, running ? 'spinning' : '', '#3fb6ff'); });
    if (cs.fans >= 7) { s += fanSVG(G.rearFan.x + 20, G.rearFan.y + 30, 26, running ? 'spinning' : '', '#3fb6ff'); s += fanSVG(300, 505, 26, running ? 'spinning' : '', '#3fb6ff'); s += fanSVG(380, 505, 26, running ? 'spinning' : '', '#3fb6ff'); s += fanSVG(460, 505, 26, running ? 'spinning' : '', '#3fb6ff'); }
    s += '<rect x="46" y="60" width="14" height="440" rx="6" fill="#10161f" stroke="#2c3749"/>';
    /* 电源按钮 LED */
    s += '<circle cx="53" cy="72" r="5" fill="' + (running ? '#3fd68f' : '#2c3749') + '" class="led ' + (running ? 'on glow' : '') + '" style="color:#3fd68f"/>';
  }
  /* 核显输出示意 */
  if (a.igpuChosen && build.cpu) {
    s += '<g class="led ' + (running ? 'on' : '') + '"><rect x="548" y="150" width="70" height="46" rx="4" fill="#0d1520" stroke="#3fb6ff"/><text x="556" y="168" fill="#3fb6ff" font-size="9">核显输出</text><text x="556" y="182" fill="#8b98ab" font-size="8">' + P.byId(build.cpu).igpu + ' → 显示器</text></g>';
  }
  svg.innerHTML = s;
  /* 机箱内点击退回。注意：内存条/SSD 的 partBox 嵌在主板 partBox 内，
   * 必须 stopPropagation，否则点内存会连带冒泡触发主板的移除确认（用户反馈 bug） */
  const CATNAME = { cpu: 'CPU', mobo: '主板', ram: '内存条', gpu: '显卡', ssd: 'M.2 固态硬盘', psu: '电源', cooler: 'CPU 散热器', case: '机箱' };
  svg.querySelectorAll('.partBox').forEach(el => {
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      const nm = (el.querySelector('text') ? el.querySelector('text').textContent : '') || CATNAME[el.dataset.cat];
      if (!confirm('从机箱移除 ' + nm + '？')) return;
      removePart(el.dataset.cat, el.dataset.idx != null ? +el.dataset.idx : undefined);
    });
    el.addEventListener('dragstart', ev => {
      ev.stopPropagation(); // 防止冒泡到主板导致主板被一并拆除
      ev.dataTransfer.setData('text/plain', 'REMOVE:' + el.dataset.cat + ':' + (el.dataset.idx || ''));
    });
    el.setAttribute('draggable', 'true');
  });
  /* 空内存槽：可直接把内存条拖到指定槽位（选择具体槽 A1A2B1B2） */
  svg.querySelectorAll('.ramSlotEmpty').forEach(el => {
    el.style.cursor = 'copy';
    el.addEventListener('dragover', ev => { ev.preventDefault(); ev.stopPropagation(); el.setAttribute('stroke', '#e0c4ff'); el.setAttribute('stroke-width', '2.5'); });
    el.addEventListener('dragleave', ev => { el.setAttribute('stroke', '#39465c'); el.setAttribute('stroke-width', '1'); });
    el.addEventListener('drop', ev => {
      ev.preventDefault(); ev.stopPropagation();
      const id = ev.dataTransfer.getData('text/plain');
      const p = P.byId(id); if (!p || p.cat !== 'ram') return;
      install(p.id, 'ram', +el.dataset.slot);
    });
    /* 点击空槽 → 从已装货架类型里选一条插入（无则提示先拖一条到别的槽） */
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      const types = [...new Set([].concat(build.ram, []).filter(Boolean))];
      if (!types.length) { alert('先把一条内存拖到任意槽，再点其它空槽即可复制插入'); return; }
      const nm = types.map((t, i) => (i + 1) + '. ' + P.byId(t).name).join('\n');
      const pick = prompt('插入到槽 ' + slotName[+el.dataset.slot] + '，选择序号：\n' + nm, '1');
      if (pick == null) return;
      const t = types[(+pick || 1) - 1]; if (t) install(t, 'ram', +el.dataset.slot);
    });
  });
}

/* ---- 拖放目标：机箱 ---- */
const wrap = document.getElementById('caseWrap');
wrap.addEventListener('dragover', e => { e.preventDefault(); wrap.classList.add('dragover'); });
wrap.addEventListener('dragleave', () => wrap.classList.remove('dragover'));
wrap.addEventListener('drop', e => {
  e.preventDefault(); wrap.classList.remove('dragover');
  const id = e.dataTransfer.getData('text/plain');
  if (id.startsWith('REMOVE:')) {
    const [, cat, idx] = id.split(':');
    removePart(cat, idx ? +idx : undefined); return;
  }
  const p = P.byId(id); if (!p) return;
  install(p.id, p.cat);
});

/* ---- 3D 视图 ---- */
let view3d = false, inited3d = false;
function ensure3D() {
  if (inited3d || !window.STRATA_3D) return;
  window.STRATA_3D.init(document.getElementById('case3d'));
  window.STRATA_3D.onRemove((cat, idx) => removePart(cat, idx));
  window.STRATA_3D.onSpareDelete(uid => window.delSpare(uid));
  window.STRATA_3D.onSpareInstall(uid => window.installSpare(uid));
  inited3d = true;
}
function applyView() {
  if (view3d && !window.STRATA_3D) view3d = false; // 3D 模块未加载（如 file:// 直开）→ 回退 2D
  document.getElementById('caseSVG').style.display = view3d ? 'none' : 'block';
  document.getElementById('case3d').style.display = view3d ? 'block' : 'none';
  document.getElementById('btnDoor').style.display = view3d ? '' : 'none';
  document.getElementById('btnReset').style.display = view3d ? '' : 'none';
  document.getElementById('btnView').textContent = view3d ? '⇄ 切回 2D' : '⇄ 切到 3D';
  if (view3d) {
    ensure3D();
    if (inited3d) {
      const a = P.analyze(build, settings());
      window.STRATA_3D.sync(build, a);
      window.STRATA_3D.setSpares(spares);
      window.STRATA_3D.setPhase(running ? 'run' : 'idle');
    }
  }
  mark3dState();
}
/* ---- 3D 不可用时的诊断 ----
 * 以前这里只是一句 alert('3D 模块未加载')，看不出到底哪里错了。
 * 实际上 99% 是下面两种之一，直接把人指到正确操作上。 */
function why3dUnavailable() {
  if (location.protocol === 'file:') {
    return '当前是 file:// 直接打开的 src/index.html。浏览器会拦截 ES module 与本地资源请求，3D 起不来。\n\n' +
      '两条路任选：\n' +
      '① 打开单文件版 dist/strata-pc-simulator.html（3D 已内联，双击即用）\n' +
      '② 在项目根目录运行 npm run serve，再访问 http://127.0.0.1:8080/src/index.html';
  }
  return '3D 模块没能加载：取不到 ../vendor/three.module.js。\n\n' +
    '最常见原因：把 src/ 当成了服务根目录。src/index.html 引用的是 ../vendor/ 和 ../assets/，\n' +
    '服务根必须是仓库根目录。\n\n' +
    '在仓库根目录运行 npm run serve，然后打开 http://127.0.0.1:8080/src/index.html';
}
function show3dNotice() {
  const wrap = document.getElementById('caseWrap');
  if (!wrap || document.getElementById('notice3d')) return;
  const d = document.createElement('div');
  d.id = 'notice3d';
  d.className = 'notice3d';
  d.innerHTML = '<b>3D 视图不可用</b><pre></pre>';
  d.querySelector('pre').textContent = why3dUnavailable();
  wrap.appendChild(d);
}
function mark3dState() {
  const b = document.getElementById('btnView');
  const cta = document.getElementById('cta3d');
  const ok = !!window.STRATA_3D;
  if (b) {
    if (ok) {
      b.classList.remove('off');
      b.title = '';
      b.textContent = view3d ? '⇄ 切回 2D' : '⇄ 切到 3D';
    } else {
      b.classList.add('off');
      b.textContent = '⇄ 3D 不可用';
      b.title = why3dUnavailable();
    }
  }
  /* 右栏那颗大按钮：3D 可用时跟随视图状态换文案，不可用时置灰并说明原因 */
  if (cta) {
    cta.classList.toggle('off', !ok);
    cta.classList.toggle('on', ok && view3d);
    const t = cta.querySelector('.t'), s = cta.querySelector('.s'), ic = cta.querySelector('.ic');
    if (!ok) {
      ic.textContent = '⚠';
      t.textContent = '3D 不可用';
      s.textContent = '点击查看原因';
      cta.title = why3dUnavailable();
    } else if (view3d) {
      ic.textContent = '▦';
      t.textContent = '切回 2D 平面图';
      s.textContent = '回到装配视图继续换件';
      cta.title = '';
    } else {
      ic.textContent = '⬢';
      t.textContent = '进入 3D 实景装机台';
      s.textContent = '真机模型 · 玻璃侧透 · 可拆可装';
      cta.title = '';
    }
  }
}
function toggleView() {
  if (!window.STRATA_3D) { show3dNotice(); return; }
  view3d = !view3d; applyView();
}
document.getElementById('btnView').addEventListener('click', toggleView);
document.getElementById('cta3d').addEventListener('click', () => {
  if (!window.STRATA_3D) { show3dNotice(); return; }
  if (!view3d) { view3d = true; applyView(); } else { view3d = false; applyView(); }
});
document.getElementById('btnDoor').addEventListener('click', () => window.STRATA_3D && window.STRATA_3D.toggleDoor());
document.getElementById('btnReset').addEventListener('click', () => window.STRATA_3D && window.STRATA_3D.resetView());
/* 模块是异步加载的：等 load 之后再看一眼 STRATA_3D 在不在，不在就把按钮标灰。 */
window.addEventListener('load', () => setTimeout(mark3dState, 200));

/* ---- 主刷新 ---- */
function onChange() {
  document.getElementById('vCtx').textContent = (+document.getElementById('sCtx').value) + 'K';
  document.getElementById('vConc').textContent = document.getElementById('sConc').value + ' 路';
  const st = settings();
  const a = P.analyze(build, st);
  renderShelves();
  renderCase(a);
  if (view3d && inited3d) { window.STRATA_3D.sync(build, a); window.STRATA_3D.setSpares(spares); }
  document.getElementById('priceTag').textContent = '整机参考造价 ¥' + totalPrice().toLocaleString() + '（闲鱼 2026-10-17 成交行情：内存/SSD 已按涨价潮校准）';
  const btn = document.getElementById('bootBtn');
  if (!running) {
    btn.disabled = !a.canPost;
    btn.classList.toggle('ready', a.canPost);
    btn.textContent = a.canPost ? '启动' : '未就绪';
  }
  /* 跑分按钮：只有开机运行中才可用（状态收口在 app2.js 的 syncBenchBtn） */
  if (window.syncBenchBtn) window.syncBenchBtn();
  else {
    const bb = document.getElementById('benchBtn');
    if (bb) { bb.disabled = !running; bb.title = running ? '跑一遍 StrataBench' : '先按启动点亮机器'; }
  }
  if (window.updateStatus) updateStatus(a, st);
}
window.isView3d = () => view3d;
document.querySelectorAll('#strataBar select,#strataBar input').forEach(el => el.addEventListener('input', onChange));

/* 初始化权重下拉 */
P.models.forEach(m => {
  const o = document.createElement('option'); o.value = m.id; o.textContent = m.name;
  document.getElementById('sModel').appendChild(o);
});
document.getElementById('sModel').value = 'ud_q4';

window.addEventListener('DOMContentLoaded', () => {
  /* 预载"现机"配置，让页面一打开就有东西看 */
  build.cpu = 'i7-12700KF'; build.mobo = 'z790-gaming-plus';
  build.ram = ['d5-16-5600', 'd5-32-5200', 'd5-16-5600', 'd5-32-5200'];
  build.gpu = ['rtx-3080-20g', 'rtx-4070s'];
  build.ssd = ['ti600-1t']; build.psu = 'psu-1250t'; build.cooler = 'aio360'; build.case = 'mft3f';
  onChange();
  /* URL 参数：?3d 直接进 3D 视图；?3d&boot 再自动开机（演示/截图用） */
  const q = location.search;
  if (/[?&]3d/.test(q)) {
    view3d = true; applyView();
    if (/[&?]boot/.test(q)) setTimeout(() => { if (!running) boot(); }, 900);
  }
});
