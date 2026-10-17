/* ============ Strata 装机模拟器 · 3D 场景（Three.js r170，程序化写实建模） ============
 * 单位：1 = 1mm。坐标系：X=机箱深度（0=主板托盘侧/右，+朝侧透玻璃），Y=上，Z=+朝机箱前面板。
 * 数据层完全复用 parts.js 的真实参数（长/厚/槽位电气/显存带宽），本模块只负责表现。
 * 对外接口 window.STRATA_3D：
 *   init(container) / sync(build, analyze) / setPhase(p) / setTelemetry(m)
 *   toggleDoor() / resetView() / onRemove(cb)
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const P = window.STRATA_PARTS;

/* ---------------- 材质库（共享缓存） ---------------- */
const M = {};
function texCircuit(w, h, base, line) { // 程序化 PCB 电路纹理
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = line; g.lineWidth = 1;
  for (let i = 0; i < 60; i++) {
    g.globalAlpha = 0.12 + Math.random() * 0.25;
    g.beginPath();
    let x = Math.random() * 256, y = Math.random() * 256;
    g.moveTo(x, y);
    for (let k = 0; k < 4; k++) { Math.random() < 0.5 ? x += (Math.random() - .5) * 90 : y += (Math.random() - .5) * 90; g.lineTo(x, y); }
    g.stroke();
  }
  g.globalAlpha = 0.5; g.fillStyle = line;
  for (let i = 0; i < 26; i++) g.fillRect(Math.random() * 250, Math.random() * 250, 3 + Math.random() * 5, 3 + Math.random() * 5);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function texBrushed(color) { // 拉丝金属
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 256, 64);
  for (let i = 0; i < 400; i++) { g.strokeStyle = 'rgba(255,255,255,' + (Math.random() * 0.07) + ')'; g.beginPath(); const y = Math.random() * 64; g.moveTo(0, y); g.lineTo(256, y + (Math.random() - .5) * 3); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function initMaterials() {
  M.steel = new THREE.MeshStandardMaterial({ color: 0x2a3140, metalness: 0.75, roughness: 0.42, map: texBrushed('#2a3140') });
  M.steelDark = new THREE.MeshStandardMaterial({ color: 0x171c26, metalness: 0.7, roughness: 0.5 });
  M.mesh = new THREE.MeshStandardMaterial({ color: 0x0c0f15, metalness: 0.4, roughness: 0.8, transparent: true, opacity: 0.88 });
  M.glass = new THREE.MeshPhysicalMaterial({ color: 0xaaccee, metalness: 0, roughness: 0.05, transmission: 0.92, thickness: 4, transparent: true, opacity: 0.28, side: THREE.DoubleSide });
  M.pcbMobo = new THREE.MeshStandardMaterial({ color: 0x14202c, roughness: 0.6, map: texCircuit(256, 256, '#14202c', '#3fd68f') });
  M.pcbGpu = new THREE.MeshStandardMaterial({ color: 0x10141c, roughness: 0.6, map: texCircuit(256, 256, '#10141c', '#54d6c8') });
  M.pcbRam = new THREE.MeshStandardMaterial({ color: 0x131a28, roughness: 0.55, map: texCircuit(256, 256, '#131a28', '#b98cff') });
  M.alu = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.9, roughness: 0.3, map: texBrushed('#9aa4b2') });
  M.aluDark = new THREE.MeshStandardMaterial({ color: 0x3a4250, metalness: 0.85, roughness: 0.35, map: texBrushed('#3a4250') });
  M.nickel = new THREE.MeshStandardMaterial({ color: 0xc8ccd4, metalness: 1, roughness: 0.22 });
  M.gold = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 1, roughness: 0.3 });
  M.black = new THREE.MeshStandardMaterial({ color: 0x0a0d12, roughness: 0.7 });
  M.rubber = new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.95 });
  M.fanBlade = c => M.fanBlade['c' + c] || (M.fanBlade['c' + c] = new THREE.MeshStandardMaterial({ color: c, transparent: true, opacity: 0.82, roughness: 0.35 }));
  M.emissive = (c, i) => { const m = new THREE.MeshStandardMaterial({ color: 0x05070a, emissive: c, emissiveIntensity: i || 1.4, roughness: 0.4 }); return m; };
}

/* ---------------- 场景常量布局（mm） ---------------- */
const L = {
  caseIn: { w: 210, h: 470, d: 450 },           // 机箱内腔：深×高×长
  mobo: { x: 8, y0: 110, z0: 40, w: 244, h: 305 }, // 主板平面（YZ），厚1.6
  cpu: { y: 352, z: 100, s: 45 },
  dimm: { z0: 168, gap: 19, y0: 252, h: 133 },
  pcieY: { 1: 192, 2: 158, 3: 138, 4: 118 },     // 物理槽 y
  pcieLen: { 16: 89, 8: 51, 4: 36 },
  psuShroud: { h: 88, z: 310 },
  frontZ: 432, topY: 462,
};

/* ---------------- 通用小件 ---------------- */
function box(w, h, d, mat, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; }
function cyl(r, h, mat, seg = 24) { return new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat); }

/* 风扇：frame + 叶轮(注册到 fans[]) + LED 环 */
const fans = [];
function makeFan(size, color, opts = {}) {
  const g = new THREE.Group();
  const t = size * 0.12;
  const frameMat = M.steelDark;
  g.add(box(size, t, size, frameMat, 0, 0, 0));
  // 框边（挖空感：四条边）
  const e = size / 2 - t / 2;
  [[0, e], [0, -e], [e, 0], [-e, 0]].forEach(([ox, oz]) => {
    const isH = ox === 0;
    g.add(box(isH ? size : t, t * 0.6, isH ? t : size, frameMat, ox, t * 0.35, oz));
  });
  const imp = new THREE.Group(); imp.position.y = t * 0.2;
  const hub = cyl(size * 0.16, t * 0.8, M.aluDark, 20); imp.add(hub);
  const bladeGeo = new THREE.BoxGeometry(size * 0.36, t * 0.28, size * 0.14);
  bladeGeo.translate(size * 0.24, 0, 0);
  bladeGeo.rotateY(0.6);
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Mesh(bladeGeo, M.fanBlade(color));
    b.rotation.y = i * Math.PI * 2 / 7; imp.add(b);
  }
  g.add(imp);
  const led = new THREE.Mesh(new THREE.TorusGeometry(size * 0.44, size * 0.018, 8, 40), M.emissive(color, 1.2));
  led.rotation.x = Math.PI / 2; led.position.y = -t * 0.5; g.add(led);
  fans.push({ imp, led, cur: 0, target: 0, dir: opts.dir || 1 });
  return g;
}

/* 鳍片堆叠（散热塔/VRM） */
function fins(count, w, h, d, gap, mat) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const im = new THREE.InstancedMesh(geo, mat, count);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < count; i++) { m4.setPosition(0, 0, i * (h + gap) - (count - 1) * (h + gap) / 2); im.setMatrixAt(i, m4); }
  return im;
}

/* RGB 灯条 */
const rgbs = [];
function rgbBar(w, h, d, hue) { const m = M.emissive(new THREE.Color().setHSL(hue, 1, 0.55), 2.2); const mesh = box(w, h, d, m, 0, 0, 0); rgbs.push({ mat: m, hue }); return mesh; }

/* 线缆：CatmullRom 管，非索引化以支持 drawRange 插线动画 */
function makeCable(pts, r, color) {
  const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
  let geo = new THREE.TubeGeometry(curve, 48, r, 8, false);
  geo = geo.toNonIndexed();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
  geo.setDrawRange(0, 0);
  mesh.userData.total = geo.attributes.position.count;
  return mesh;
}

/* ---------------- 各配件建模 ---------------- */
function buildCasePart(kase) {
  const g = new THREE.Group(); const W = L.caseIn.w, H = L.caseIn.h, D = L.caseIn.d;
  const th = 3;
  g.add(box(W, th, D, M.steel, W / 2, -th / 2, D / 2));            // 底
  g.add(box(W, H, th, M.steel, W / 2, H / 2, -th / 2));            // 后
  g.add(box(W, th, D, M.steel, W / 2, H + th / 2, D / 2));         // 顶
  g.add(box(th, H, D, M.steel, -th / 2, H / 2, D / 2));            // 右（主板托盘侧）
  // 前面板（网格感）
  const front = box(6, H, th + 6, M.mesh, W / 2, H / 2, D + 3); g.add(front);
  g.add(box(W + 8, 14, 10, M.steelDark, W / 2, H + 7, D + 3));     // 顶沿
  // 电源仓罩
  const sh = box(W - 14, 4, L.psuShroud.z, M.steel, (W - 14) / 2 + 4, L.psuShroud.h, L.psuShroud.z / 2);
  g.add(sh);
  g.add(box(4, L.psuShroud.h, L.psuShroud.z, M.steelDark, W - 12, L.psuShroud.h / 2, L.psuShroud.z / 2));
  // 罩上 RGB 装饰条（Strata logo 带）
  const strip = rgbBar(2, 3, L.psuShroud.z - 40, 0.55); strip.position.set(W - 11, 30, L.psuShroud.z / 2); g.add(strip);
  // 主板铜柱
  for (const [my, mz] of [[130, 60], [130, 260], [390, 60], [390, 260], [260, 60]]) {
    const st = cyl(3, 8, M.gold, 10); st.rotation.z = Math.PI / 2; st.position.set(3, my, mz); g.add(st);
  }
  // 前置风扇（case.fans 决定 3 或 7）
  const nf = Math.min(kase.fans >= 3 ? 3 : kase.fans, 3);
  for (let i = 0; i < nf; i++) {
    const f = makeFan(120, 0x3fb6ff); f.position.set(W / 2, 120 + i * 130, L.frontZ); g.add(f);
  }
  if (kase.fans >= 7) { // 顶部 3 + 后 1
    for (let i = 0; i < 3; i++) { const f = makeFan(120, 0x3fb6ff); f.position.set(W / 2, L.topY - 60, 120 + i * 130); g.add(f); }
    const rf = makeFan(120, 0x3fb6ff); rf.rotation.z = Math.PI / 2; rf.position.set(W / 2, 380, 8); g.add(rf);
  }
  // 玻璃侧透门（绕后上棱旋转开合）
  const door = new THREE.Group();
  const pane = box(2, H - 20, D - 20, M.glass, 0, 0, 0);
  const frame = box(6, H - 14, D - 14, M.steelDark, 0, 0, 0); frame.material = M.steel;
  const pane2 = box(4, H - 24, D - 24, M.glass, 0, 0, 0);
  door.add(frame); door.add(pane2);
  door.position.set(W + 2, H / 2, D / 2);
  door.userData.isDoor = true;
  g.add(door);
  g.userData.door = door;
  return g;
}

function buildMotherboard(m, a) {
  const g = new THREE.Group();
  const { y0, z0, w, h } = L.mobo;
  const pcb = box(1.6, h, w, M.pcbMobo, 0, y0 + h / 2, z0 + w / 2); g.add(pcb);
  // I/O 护罩 + VRM 散热
  g.add(box(14, 40, 158, M.aluDark, 8, y0 + h - 22, z0 + 80));
  g.add(fins(10, 12, 30, 6, 4, M.alu).translateX(10).translateY(y0 + h - 60).translateZ(z0 + 150));
  // 芯片组小散热片 + 电池
  const ch = box(10, 40, 40, M.aluDark, 7, y0 + 90, z0 + 150); g.add(ch);
  const batt = cyl(10, 2.5, M.nickel, 20); batt.rotation.z = Math.PI / 2; batt.position.set(6, y0 + 60, z0 + 120); g.add(batt);
  // CPU 插座
  const sk = box(3, L.cpu.s + 8, L.cpu.s + 8, M.black, 1.5, L.cpu.y, L.cpu.z); g.add(sk);
  g.add(box(2, L.cpu.s - 4, L.cpu.s - 4, M.gold, 2.6, L.cpu.y, L.cpu.z));
  // DIMM 槽
  for (let i = 0; i < m.memSlots; i++) {
    const s = box(5, L.dimm.h + 6, 8, M.black, 3, L.dimm.y0 + L.dimm.h / 2, L.dimm.z0 + i * L.dimm.gap); g.add(s);
  }
  // PCIe 槽（按电气着色：绿=frac满分 黄=中 红=芯片组坑）
  a.pcie.forEach(p => {
    const col = p.frac >= 0.9 ? 0x3fd68f : p.frac >= 0.5 ? 0xffb454 : 0xff5d6c;
    const len = L.pcieLen[p.lanes] || 89;
    const slot = box(6, 12, len, M.aluDark, 4, L.pcieY[p.pos], z0 + 8 + len / 2);
    g.add(slot);
    const glow = box(1.5, 2, len, M.emissive(col, 1.6), 7.5, L.pcieY[p.pos] + 7, z0 + 8 + len / 2); g.add(glow);
  });
  // 24pin + EPS 插座
  g.add(box(8, 45, 24, M.black, 5, y0 + 150, z0 + w - 8));
  g.add(box(8, 20, 40, M.black, 5, y0 + h - 10, z0 + 30));
  return g;
}

function buildCPU(c) {
  const g = new THREE.Group();
  g.add(box(2, L.cpu.s, L.cpu.s, M.pcbGpu, 4.5, L.cpu.y, L.cpu.z));
  const ihs = box(3.5, L.cpu.s - 12, L.cpu.s - 8, M.nickel, 6.5, L.cpu.y, L.cpu.z); g.add(ihs);
  return g;
}

function buildCooler(co) {
  const g = new THREE.Group();
  if (co.type === 'aio') {
    const head = cyl(32, 24, M.aluDark, 28); head.rotation.z = Math.PI / 2; head.position.set(20, L.cpu.y, L.cpu.z); g.add(head);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(26, 2.5, 8, 40), M.emissive(0x3fb6ff, 2));
    ring.rotation.y = Math.PI / 2; ring.position.set(33, L.cpu.y, L.cpu.z); g.add(ring); rgbs.push({ mat: ring.material, hue: 0.55 });
    // 水管：冷头→绕到主板后→顶部冷排
    const rad = box(70, 28, 396, M.steelDark, L.caseIn.w / 2, L.topY - 16, 320); g.add(rad);
    for (let i = 0; i < 3; i++) { const f = makeFan(120, 0x7fd1ff); f.position.set(L.caseIn.w / 2, L.topY - 42, 202 + i * 120); g.add(f); }
    g.userData.tubes = [
      [[30, L.cpu.y + 10, L.cpu.z - 8], [-14, L.cpu.y + 40, L.cpu.z - 10], [-18, 430, 250], [L.caseIn.w / 2 - 20, L.topY - 30, 250]],
      [[30, L.cpu.y + 10, L.cpu.z + 8], [-10, L.cpu.y + 55, L.cpu.z + 12], [-12, 440, 270], [L.caseIn.w / 2 - 20, L.topY - 30, 275]],
    ];
  } else {
    const base = box(6, 40, 40, M.copper || (M.copper = new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 1, roughness: 0.35 })), 12, L.cpu.y - 24, L.cpu.z);
    g.add(base);
    const towerH = co.id === 'ag400' ? 140 : 150;
    const nT = co.id === 'd15' || co.id === 'pa120se' ? 2 : 1;
    for (let t = 0; t < nT; t++) {
      const f = fins(26, 12, towerH, 5, 1.2, M.alu);
      f.position.set(24 + t * 32, L.cpu.y + 40, L.cpu.z); g.add(f);
    }
    const fan = makeFan(120, 0x7fd1ff); fan.rotation.z = Math.PI / 2;
    fan.position.set(16 + nT * 34, L.cpu.y + 40, L.cpu.z); g.add(fan);
  }
  return g;
}

function buildDIMM(d, i) {
  const g = new THREE.Group();
  const z = L.dimm.z0 + i * L.dimm.gap;
  g.add(box(2, L.dimm.h, 7, M.pcbRam, 5, L.dimm.y0 + L.dimm.h / 2, z));
  const sp = d.gen === '5' ? 30 : 24; // DDR5 低马甲
  g.add(box(6, L.dimm.h - 8, 2.2, M.aluDark, 5, L.dimm.y0 + L.dimm.h / 2, z - 4.2));
  g.add(box(6, L.dimm.h - 8, 2.2, M.aluDark, 5, L.dimm.y0 + L.dimm.h / 2, z + 4.2));
  const bar = rgbBar(L.dimm.h - 14, 2.5, 3, (i * 0.13) % 1); bar.position.set(5, L.dimm.y0 + L.dimm.h - 3, z); bar.rotation.y = 0; g.add(bar);
  return g;
}

function buildGPU(gpu, assign, i) {
  const g = new THREE.Group();
  const slotY = L.pcieY[assign.slotPos] || L.pcieY[4];
  const th = gpu.thick * 20, len = gpu.len, hgt = 112;
  const z0 = L.mobo.z0 + 8;
  const col = assign.slot.frac >= 0.9 ? 0x3fd68f : assign.slot.frac >= 0.5 ? 0xffb454 : 0xff5d6c;
  // PCB
  g.add(box(len - 20, 3, hgt - 14, M.pcbGpu, 12 + (len - 20) / 2, slotY + th / 2, z0 + hgt / 2));
  // 散热罩（金属外壳）
  const shroud = box(len - 26, th - 4, hgt - 6, M.aluDark, 14 + (len - 26) / 2, slotY + th / 2 + 2, z0 + hgt / 2);
  g.add(shroud);
  // 背板
  g.add(box(len - 16, 1.5, hgt - 2, M.alu, 12 + (len - 16) / 2, slotY + th + 1, z0 + hgt / 2));
  // 挡板
  g.add(box(2, th + 14, 120, M.steel, 4, slotY + th / 2, z0 - 4));
  for (let k = 0; k < 3; k++) g.add(box(3, 8, 16, M.black, 4, slotY + 6 + k * 12, z0 + 14 + k * 20));
  // 风扇（按长度 2 或 3 把）
  const nf = len >= 300 ? 3 : 2;
  for (let k = 0; k < nf; k++) {
    const f = makeFan(Math.min(92, (len - 40) / nf - 8), 0xff4d6d);
    f.position.set(24 + (k + 0.5) * (len - 48) / nf, slotY - 2, z0 + hgt / 2);
    g.add(f);
  }
  // 供电口
  const is16 = /16pin|12pin/.test(gpu.conn);
  g.add(box(is16 ? 22 : 14, 8, 12, M.black, len - 26, slotY + th + 6, z0 + hgt - 16));
  // 侧边 RGB logo 条 + frac 状态灯带
  const logo = rgbBar(len * 0.35, 2.5, 2.5, 0.95); logo.position.set(20 + len * 0.2, slotY + th + 2, z0 + hgt + 2); g.add(logo);
  const strip = box(len - 30, 2, 1.5, M.emissive(col, 2), 16 + (len - 30) / 2, slotY - 3, z0 + 4); g.add(strip);
  g.userData.powerAt = [len - 26, slotY + th + 10, z0 + hgt - 16];
  return g;
}

function buildSSD(s, i) {
  const g = new THREE.Group();
  if (s.type === 'nvme') {
    const y = L.pcieY[2] - 14 - i * 16, z = L.mobo.z0 + 20;
    g.add(box(80, 2, 22, M.pcbGpu, 14, y, z));
    g.add(box(74, 6, 20, M.aluDark, 14, y + 4, z));
  } else {
    g.add(box(146, 26, 101, M.alu, 90, 40, 350)); // 3.5" 机械
  }
  return g;
}

function buildPSU(p) {
  const g = new THREE.Group();
  const len = 140 + Math.round(p.w / 200) * 12;
  g.add(box(150, 85, len, M.steelDark, 95, 45, 20 + len / 2));
  const gr = cyl(60, 2, M.black, 28); gr.rotation.x = Math.PI / 2; gr.position.set(95, 45, 20 + len + 1); g.add(gr);
  const f = makeFan(120, 0xffd166); f.rotation.x = Math.PI / 2; f.position.set(95, 45, 20 + len - 6); g.add(f);
  g.add(box(60, 2, 40, M.emissive(0xffd166, 0.9), 95, 88, 60)); // 标签灯
  return g;
}

/* ---------------- 引擎核心 ---------------- */
let renderer, scene, camera, controls, composer, bloom, container;
let doorOpen = false, ready = false;
const installed = new Map(); // key -> {group, cat, idx, id}
let pickables = [];
let removeCb = null, hoverObj = null;
const raycaster = new THREE.Raycaster(), ptr = new THREE.Vector2();
let phase = 'idle', telemetry = null, t0 = performance.now();

function init(el) {
  container = el;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  el.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f16);
  camera = new THREE.PerspectiveCamera(42, 1, 1, 6000);
  camera.position.set(560, 420, 700);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(100, 240, 230); controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxDistance = 1800; controls.minDistance = 120;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0x8899bb, 0x223344, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(600, 800, 500); scene.add(key);
  const fill = new THREE.DirectionalLight(0x6688cc, 0.5); fill.position.set(-400, 200, -300); scene.add(fill);
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.6, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  initMaterials();
  resize();
  new ResizeObserver(resize).observe(el);
  bindPointer();
  ready = true;
  requestAnimationFrame(loop);
}

function resize() {
  if (!ready) return;
  const w = container.clientWidth, h = container.clientHeight;
  renderer.setSize(w, h); composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}

/* ---- 装配 diff ---- */
function keyOf(cat, idx, id) { return cat + ':' + idx + ':' + id; }
let build_ref = {}, analyze_ref = { pcie: [], gpuAssign: [] };

function sync(build, a) {
  if (!ready) return;
  build_ref = build; analyze_ref = a;
  const want = new Map();
  if (build.case) want.set(keyOf('case', 0, build.case), { cat: 'case', idx: 0, id: build.case });
  if (build.mobo) want.set(keyOf('mobo', 0, build.mobo), { cat: 'mobo', idx: 0, id: build.mobo });
  if (build.cpu) want.set(keyOf('cpu', 0, build.cpu), { cat: 'cpu', idx: 0, id: build.cpu });
  if (build.cooler) want.set(keyOf('cooler', 0, build.cooler), { cat: 'cooler', idx: 0, id: build.cooler });
  if (build.psu) want.set(keyOf('psu', 0, build.psu), { cat: 'psu', idx: 0, id: build.psu });
  build.ram.forEach((id, i) => want.set(keyOf('ram', i, id), { cat: 'ram', idx: i, id }));
  build.ssd.forEach((id, i) => want.set(keyOf('ssd', i, id), { cat: 'ssd', idx: i, id }));
  a.gpuAssign.forEach((g, i) => want.set(keyOf('gpu', i, g.id), { cat: 'gpu', idx: i, id: g.id, assign: g }));
  // 拆除
  for (const [k, v] of installed) if (!want.has(k)) playOut(k, v);
  // 主板换型号 → 重建（子件位置依赖板）
  for (const [k, v] of want) {
    const cur = installed.get(k);
    if (cur && cur.id !== v.id) playOut(k, cur, true);
  }
  // 装配
  for (const [k, v] of want) {
    if (installed.has(k) && installed.get(k).id === v.id) continue;
    const grp = createPart(v);
    if (!grp) continue;
    grp.userData.pick = { cat: v.cat, idx: v.idx, id: v.id };
    scene.add(grp);
    installed.set(k, { group: grp, cat: v.cat, idx: v.idx, id: v.id });
    playIn(grp, v.cat);
  }
  rebuildPickables();
  rebuildCables();
}

function createPart(v) {
  switch (v.cat) {
    case 'case': return buildCasePart(P.byId(v.id));
    case 'mobo': return buildMotherboard(P.byId(v.id), analyze_ref);
    case 'cpu': return buildCPU(P.byId(v.id));
    case 'cooler': return buildCooler(P.byId(v.id));
    case 'psu': return buildPSU(P.byId(v.id));
    case 'ram': return buildDIMM(P.byId(v.id), v.idx);
    case 'ssd': return buildSSD(P.byId(v.id), v.idx);
    case 'gpu': return buildGPU(P.byId(v.id), v.assign, v.idx);
  }
}
function playIn(grp, cat) {
  const from = new THREE.Vector3(320, 300, 620);
  grp.userData.anim = { t: 0, from, to: grp.position.clone(), dur: 0.55 };
  grp.position.copy(from);
  grp.traverse(o => { if (o.material && o.material.transparent !== true) { } });
}
function playOut(k, v, silent) {
  installed.delete(k);
  const g = v.group;
  g.userData.animOut = { t: 0, from: g.position.clone(), to: new THREE.Vector3(320, 300, 620), dur: 0.45, silent };
  setTimeout(() => { scene.remove(g); disposeGroup(g); rebuildPickables(); }, 480);
}
function disposeGroup(g) {
  g.userData._dead = true;
  g.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material && !Object.values(M).includes(o.material)) o.material.dispose && o.material.dispose();
  });
}
function inScene(o) { let p = o; while (p) { if (p.userData && p.userData._dead) return false; if (p === scene) return true; p = p.parent; } return false; }

function rebuildPickables() {
  pickables = [];
  for (const { group } of installed.values()) pickables.push(group);
}

/* ---- 线缆（随配件存在） ---- */
let cableMeshes = [];
function rebuildCables() {
  cableMeshes.forEach(c => scene.remove(c)); cableMeshes = [];
  const has = c => [...installed.values()].some(v => v.cat === c);
  if (!has('psu') || !has('mobo')) return;
  const psuTop = [95, 90, 120];
  const c24 = makeCable([psuTop, [150, 160, 200], [60, 260, 268], [13, L.mobo.y0 + 150, L.mobo.z0 + 236]], 5, 0x1a1d24);
  c24.userData.label = '24pin'; cableMeshes.push(c24);
  if (has('cpu')) {
    const ceps = makeCable([psuTop, [120, 200, 120], [40, 380, 70], [13, L.mobo.y0 + 295, L.mobo.z0 + 30]], 4, 0x141821);
    ceps.userData.label = 'EPS'; cableMeshes.push(ceps);
  }
  if (has('cooler') && P.byId(build_ref.cooler).type === 'aio') {
    const co = buildCooler(P.byId(build_ref.cooler));
    (co.userData.tubes || []).forEach(tp => {
      const t = makeCable(tp, 7, 0x2c3a52); t.userData.label = 'aio'; cableMeshes.push(t);
    });
    disposeGroup(co);
  }
  const gpuInsts = [...installed.values()].filter(v => v.cat === 'gpu');
  gpuInsts.forEach((v, idx) => {
    const gpu = P.byId(v.id);
    const ga = analyze_ref.gpuAssign[idx]; if (!ga) return;
    const slotY = L.pcieY[ga.slotPos] || 150;
    const cg = makeCable([[120, 88, 200], [150, 150, 260], [140, slotY + gpu.thick * 20 + 10, L.mobo.z0 + gpu.len - 6], [gpu.len - 26, slotY + gpu.thick * 20 + 6, L.mobo.z0 + 8 + gpu.len - 32]], 4, 0x2a2418);
    cg.userData.label = 'gpu'; cableMeshes.push(cg);
  });
  cableMeshes.forEach(c => { c.userData.plugged = phase !== 'idle'; scene.add(c); applyPlug(c); });
}
function applyPlug(c) {
  const total = c.userData.total;
  c.geometry.setDrawRange(0, c.userData.plugged ? total : 0);
}

/* ---- 开机/遥测 ---- */
function setPhase(p) {
  phase = p;
  if (p === 'cables') {
    cableMeshes.forEach((c, i) => {
      const total = c.userData.total; let start = null;
      const step = ts => {
        if (!start) start = ts;
        const k = Math.min(1, (ts - start - i * 300) / 700);
        c.geometry.setDrawRange(0, Math.max(0, Math.floor(total * easeOut(k))));
        if (k < 1) requestAnimationFrame(step); else c.userData.plugged = true;
      };
      requestAnimationFrame(step);
    });
  }
  if (p === 'boot' || p === 'run') fans.forEach(f => f.target = 1);
  if (p === 'idle') { fans.forEach(f => f.target = 0); cableMeshes.forEach(c => { c.userData.plugged = false; applyPlug(c); }); }
}
function setTelemetry(m) {
  telemetry = m;
  if (!m) return;
  // 风扇目标转速：按温度（45°C→0.35，90°C→1）
  const tmax = Math.max(m.temps ? m.temps.cpu : 60, ...(m.temps ? m.temps.gpu : [60]));
  const rpm = Math.max(0.25, Math.min(1, (tmax - 40) / 50));
  fans.forEach(f => f.target = rpm);
}
function easeOut(k) { return 1 - Math.pow(1 - k, 3); }

/* ---- 主循环 ---- */
function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (ts - (loop.last || ts)) / 1000); loop.last = ts;
  const time = (ts - t0) / 1000;
  // 风扇
  const visualScale = 0.06; // 1800rpm 视觉降速
  fans.forEach(f => {
    if (!inScene(f.imp)) { f.cur = 0; return; }
    f.cur += (f.target * (phase === 'run' ? 1 : phase === 'idle' ? 0 : 0.55) - f.cur) * dt * 1.5;
    f.imp.rotation.y += f.cur * 60 * visualScale * dt * Math.PI * 2 * f.dir;
    if (f.led) f.led.material.emissiveIntensity = phase === 'idle' ? 0.25 : 0.8 + f.cur * 1.6;
  });
  // RGB 模式：idle 微光 / boot 彩虹 / run 按阶段
  rgbs.forEach((r, i) => {
    if (phase === 'idle') { r.mat.emissiveIntensity = 0.15; return; }
    let hue = r.hue, inten = 1.8;
    if (phase === 'boot') { hue = (time * 0.3 + i * 0.1) % 1; }
    else if (phase === 'run') {
      const mode = telemetry && telemetry.mode === 'prefill' ? 'pf' : 'dc';
      if (mode === 'pf') { hue = 0.0; inten = 1.2 + Math.sin(time * 14) * 1.1; }        // prefill 红脉冲
      else { hue = 0.36; inten = 1.4 + Math.sin(time * 4 + i) * 0.7; }                   // decode 绿呼吸
    }
    r.mat.emissive.setHSL(hue, 1, 0.55); r.mat.emissiveIntensity = inten;
  });
  // 装配/拆除补间
  for (const { group } of installed.values()) {
    const an = group.userData.anim;
    if (an) {
      an.t += dt; const k = Math.min(1, an.t / an.dur);
      group.position.lerpVectors(an.from, an.to, easeOut(k));
      if (k >= 1) delete group.userData.anim;
    }
  }
  scene.children.forEach(o => {
    const an = o.userData.animOut;
    if (an) { an.t += dt; const k = Math.min(1, an.t / an.dur); o.position.lerpVectors(an.from, an.to, k * k); }
  });
  controls.update();
  composer.render();
}

/* ---- 交互：hover 高亮 / 点击拆除 / 拖出机箱 ---- */
let down = null, dragging = false;
function bindPointer() {
  const el = renderer.domElement;
  el.addEventListener('pointermove', e => {
    const r = el.getBoundingClientRect();
    ptr.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    if (down && !dragging && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) { dragging = true; controls.enabled = false; }
    if (dragging && down.obj) { down.obj.position.x += 6; down.obj.position.y += 2; }
    // hover
    raycaster.setFromCamera(ptr, camera);
    const hit = raycaster.intersectObjects(pickables, true)[0];
    const root = hit ? rootPick(hit.object) : null;
    if (hoverObj && hoverObj !== root) setEmissiveBoost(hoverObj, false);
    hoverObj = root;
    if (hoverObj) setEmissiveBoost(hoverObj, true);
    el.style.cursor = hoverObj ? 'pointer' : 'default';
  });
  el.addEventListener('pointerdown', e => {
    raycaster.setFromCamera(ptr, camera);
    const hit = raycaster.intersectObjects(pickables, true)[0];
    down = { x: e.clientX, y: e.clientY, obj: hit ? rootPick(hit.object) : null };
    dragging = false;
    try { el.setPointerCapture(e.pointerId); } catch (err) { }
  });
  el.addEventListener('pointerup', e => {
    controls.enabled = true;
    if (!down) return;
    if (dragging) {
      if (down.obj && removeCb) {
        const p = down.obj.userData.pick;
        // 拖出 canvas 判定：指针在容器边缘外
        const r = container.getBoundingClientRect();
        if (e.clientX < r.left + 4 || e.clientX > r.right - 4 || e.clientY < r.top + 4 || e.clientY > r.bottom - 4) {
          removeCb(p.cat, p.idx);
        } else sync(build_ref, analyze_ref); // 弹回
      }
    } else if (down.obj && removeCb) {
      const p = down.obj.userData.pick;
      const nm = P.byId(p.id) ? P.byId(p.id).name : p.cat;
      if (confirm('从机箱移除 ' + nm + '？')) removeCb(p.cat, p.idx);
    }
    down = null; dragging = false;
  });
  el.addEventListener('dblclick', () => toggleDoor());
}
function rootPick(o) { while (o) { if (o.userData && o.userData.pick) return o; o = o.parent; } return null; }
function setEmissiveBoost(root, on) {
  root.traverse(o => {
    if (o.isMesh && o.material && o.material.emissive !== undefined && !rgbs.some(r => r.mat === o.material)) {
      if (on) {
        if (!o.userData._orig) o.userData._orig = o.material;
        o.material = o.userData._orig.clone();
        o.material.emissive.setHex(0x2a4a6a); o.material.emissiveIntensity = 0.9;
      } else if (o.userData._orig) { o.material = o.userData._orig; o.userData._orig = null; }
    }
  });
}

function toggleDoor() {
  const cg = [...installed.values()].find(v => v.cat === 'case');
  if (!cg) return;
  const door = cg.group.userData.door; if (!door) return;
  doorOpen = !doorOpen;
  const from = door.rotation.y, to = doorOpen ? -1.9 : 0;
  let start = null;
  const step = ts => {
    if (!start) start = ts;
    const k = Math.min(1, (ts - start) / 700);
    door.rotation.y = from + (to - from) * easeOut(k);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function resetView() {
  camera.position.set(560, 420, 700); controls.target.set(100, 240, 230);
}

window.STRATA_3D = { init, sync, setPhase, setTelemetry, toggleDoor, resetView, onRemove: cb => removeCb = cb };
