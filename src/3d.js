/* ============ Strata 装机模拟器 · 3D 场景（Three.js r170，程序化写实建模） ============
 * 单位：1 = 1mm。坐标系：X=机箱深度（0=主板托盘侧/右，+朝侧透玻璃），Y=上，Z=+朝机箱前面板。
 * 数据层完全复用 parts.js 的真实参数（长/厚/槽位电气/显存带宽），本模块只负责表现。
 * 对外接口 window.STRATA_3D：
 *   init(container) / sync(build, analyze) / setPhase(p) / setTelemetry(m)
 *   toggleDoor() / resetView() / onRemove(cb)
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { PANEL_NORMAL_PNG, PANEL_ROUGH_PNG } from './texdata.js';
import { GPU_SHROUD_PNG, MOBO_PCB_PNG, CPU_IHS_PNG, FAN_HUB_PNG } from './texdata2.js';
import { RAM_ARMOR_BLACK_PNG, RAM_ARMOR_WHITE_PNG, COOLER_TOP_PNG, AIO_PUMP_PNG, PSU_LABEL_PNG, CASE_SHROUD_PNG, GPU_BACKPLATE_PNG } from './texdata3.js';
import { CPU_IHS_AMD_PNG, GPU_SHROUD_AMD_PNG, GPU_BACKPLATE_AMD_PNG, RAM_ARMOR_SILVER_PNG } from './texdata4.js';
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
/* 前置防尘网：一张「网丝不透明 / 网孔镂空」的贴图。
 * 网孔用 destination-out 真正挖成透明，材质只开 alphaTest（不透明通道），
 * 这样网孔是**几何级镂空**：能看见后面的风扇、也能正确写深度，不会出现透明件排序问题。
 * 一格 56mm（8×8 个孔），孔径约 4.4mm、网丝 2.6mm，是这个尺寸机箱上比较像真的密度。 */
function texMeshFilter() {
  const S = 256, cell = 32, hole = 20, r = 5;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#39414f'; g.fillRect(0, 0, S, S);          // 网丝底色
  g.globalCompositeOperation = 'destination-out';
  for (let y = 0; y < S; y += cell) for (let x = 0; x < S; x += cell) {
    const x0 = x + (cell - hole) / 2, y0 = y + (cell - hole) / 2;
    g.beginPath();
    g.moveTo(x0 + r, y0);
    g.lineTo(x0 + hole - r, y0); g.arcTo(x0 + hole, y0, x0 + hole, y0 + r, r);
    g.lineTo(x0 + hole, y0 + hole - r); g.arcTo(x0 + hole, y0 + hole, x0 + hole - r, y0 + hole, r);
    g.lineTo(x0 + r, y0 + hole); g.arcTo(x0, y0 + hole, x0, y0 + hole - r, r);
    g.lineTo(x0, y0 + r); g.arcTo(x0, y0, x0 + r, y0, r);
    g.closePath(); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
/* 喷砂 / 粉末涂层的微观法线贴图（程序化）。
 * 用 DataTexture 而不是 canvas：不依赖 2D API，Node 侧的几何审计也能安全执行。
 * 两层 value noise（低频＝喷涂橘皮）+ 逐像素细颗粒（砂面），中心差分求法线。 */
function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function texGrainNormal(size, cellPx, amp, seed) {
  const S = size, hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const gx = x / cellPx, gy = y / cellPx;
    const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const n00 = hash2(x0, y0, seed), n10 = hash2(x0 + 1, y0, seed);
    const n01 = hash2(x0, y0 + 1, seed), n11 = hash2(x0 + 1, y0 + 1, seed);
    const low = (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy;
    hgt[y * S + x] = low + hash2(x + 7919, y + 104729, seed + 31) * 0.55;
  }
  const at = (x, y) => hgt[((y % S + S) % S) * S + ((x % S + S) % S)];
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (at(x - 1, y) - at(x + 1, y)) * amp;
    const dy = (at(x, y - 1) - at(x, y + 1)) * amp;
    const len = Math.hypot(dx, dy, 1), i = (y * S + x) * 4;
    data[i] = Math.round((dx / len * 0.5 + 0.5) * 255);
    data[i + 1] = Math.round((dy / len * 0.5 + 0.5) * 255);
    data[i + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
    data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
function initMaterials() {
  /* 由真实产品照片推导的颗粒贴图（见 texdata.js）。
   * 只挂 normalMap / roughnessMap，不动 color 和 metalness —— 这两张图里没有颜色信息，
   * 所以不可能像上一轮那样把整机箱改黑。Node 审计环境没有 Image，loadTex 返回 null，
   * 参数就退回纯程序化，几何计算不受影响。 */
  const texOff = typeof location !== 'undefined' && /(^|[?&])notex\b/.test(location.search);
  const loadTex = (url, rep) => {
    if (texOff || typeof Image === 'undefined') return null;
    try {
      const t = new THREE.TextureLoader().load(url);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(rep, rep);
      t.anisotropy = 4;
      return t;
    } catch (e) { return null; }
  };
  M.__panelN = loadTex(PANEL_NORMAL_PNG, 4);
  M.__panelR = loadTex(PANEL_ROUGH_PNG, 4);
  M.__grain = texGrainNormal(256, 22, 3.4, 7);
  /* pc53 写实产品贴图（texdata2.js，铭铭验收）：整张贴到单个面上，
     ClampToEdge 防边缘拉伸，sRGB 色彩空间。审计/Node 环境无 Image → null，
     材质退回原程序化外观，几何不受影响。 */
  const loadDecal = url => {
    if (texOff || typeof Image === 'undefined' || !url) return null;
    try {
      const t = new THREE.TextureLoader().load(url);
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      return t;
    } catch (e) { return null; }
  };
  M.__moboPcb = loadDecal(MOBO_PCB_PNG);
  M.__cpuIhs = loadDecal(CPU_IHS_PNG);
  M.__gpuShroud = loadDecal(GPU_SHROUD_PNG);
  M.__fanHub = loadDecal(FAN_HUB_PNG);
  /* 第二批写实贴图（texdata3.js）：内存马甲/塔顶盖/泵顶/电源铭牌格栅/机箱遮罩 */
  M.__ramBlack = loadDecal(RAM_ARMOR_BLACK_PNG);
  M.__ramWhite = loadDecal(RAM_ARMOR_WHITE_PNG);
  M.__coolerTop = loadDecal(COOLER_TOP_PNG);
  M.__aioPump = loadDecal(AIO_PUMP_PNG);
  M.__psuLabel = loadDecal(PSU_LABEL_PNG);
  M.__caseShroud = loadDecal(CASE_SHROUD_PNG);
  M.__gpuBack = loadDecal(GPU_BACKPLATE_PNG);
  /* 第三批（texdata4）：AMD 阵营专属 + 银色马甲。素材未生成时为空串→null→程序化兜底 */
  M.__cpuIhsAmd = loadDecal(CPU_IHS_AMD_PNG);
  M.__gpuShroudAmd = loadDecal(GPU_SHROUD_AMD_PNG);
  M.__gpuBackAmd = loadDecal(GPU_BACKPLATE_AMD_PNG);
  M.__ramSilver = loadDecal(RAM_ARMOR_SILVER_PNG);
  const grain = (mat, mm, ns) => {
    const t = M.__grain.clone();
    t.needsUpdate = true;
    t.repeat.set(220 / mm, 220 / mm);          // 220mm = 机箱特征尺寸，按实际毫米排布
    mat.normalMap = t;
    mat.normalScale = new THREE.Vector2(ns, ns);
    return mat;
  };
  /* 四档灰拉开层次（数值越大越亮）：
   *   0x171c26 内框/加强筋  →  0x2a3140 主体钢板  →  0x333b48 电源仓罩  →  0x3c4554 前面板折边 */
  M.steel = grain(new THREE.MeshStandardMaterial({
    color: 0x2a3140, metalness: 0.75, roughness: 0.42, map: texBrushed('#2a3140'),
  }), 30, 0.32);
  M.steelDark = grain(new THREE.MeshStandardMaterial({
    color: 0x171c26, metalness: 0.7, roughness: 0.5,
  }), 34, 0.30);
  M.shroud = grain(new THREE.MeshStandardMaterial({
    color: 0x333b48, metalness: 0.66, roughness: 0.46,
  }), 44, 0.34);
  M.edge = grain(new THREE.MeshStandardMaterial({
    color: 0x3c4554, metalness: 0.82, roughness: 0.27, map: texBrushed('#3c4554'),
  }), 26, 0.22);
  /* 折边高光：真实机箱的钣金折边会被磨亮一圈，比四周亮两档、粗糙度更低 */
  M.chamfer = new THREE.MeshStandardMaterial({ color: 0x5a6577, metalness: 0.92, roughness: 0.18 });
  /* 机箱的三块大面（主体 / 折边料 / 电源仓罩）换成照片推导的颗粒；
     小件（内框、加强筋）保留程序化颗粒，避免同一张图大量重复时出现明显阵列感。 */
  if (M.__panelN) {
    [M.steel, M.edge, M.shroud].forEach(m => {
      m.normalMap = M.__panelN;
      m.normalScale.set(0.5, 0.5);
      if (M.__panelR) m.roughnessMap = M.__panelR;
      m.needsUpdate = true;
    });
    console.log('3D: 机箱面板已使用照片推导贴图（?notex 可关闭对比）');
  }
  M.mesh = new THREE.MeshStandardMaterial({ color: 0x0c0f15, metalness: 0.4, roughness: 0.8, transparent: true, opacity: 0.88 });
  /* 玻璃侧透：MeshBasicMaterial 最轻（SwiftShader 下 Physical/transmission 都会渲染成灰白块），只留淡蓝 tint */
  M.glass = new THREE.MeshBasicMaterial({ color: 0x7799bb, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false });
  /* 前置防尘网：网孔是 alphaTest 镂空的，不是半透明，所以 side 要双面（从腔内也要看得见） */
  M.meshFilter = new THREE.MeshStandardMaterial({
    map: texMeshFilter(), color: 0xffffff, metalness: 0.55, roughness: 0.62,
    alphaTest: 0.5, side: THREE.DoubleSide,
  });
  M.meshFilter.map.repeat.set(210 / 56, 470 / 56);
  /* 电源仓观察窗：比侧透玻璃更「实」一点（opacity 0.18），否则在小窗口里几乎看不见 */
  M.glassWin = new THREE.MeshBasicMaterial({ color: 0xbcd8ee, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false });
  /* 主板 PCB：贴图底色 #2e3846 已经乘了一次 color，原来又把 color 设成 #14161a，
     两层相乘后接近纯黑，和机箱内壁糊成一片。改成 color=白，让贴图本色直接出来，
     取偏蓝的深板岩灰，和机箱的 #171c26/#2a3140 拉开明度。 */
  M.pcbMobo = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, map: texCircuit(256, 256, '#39434f', '#57a985') });
  /* pc53 写实 PCB 贴图替换程序化电路底图（走线/过孔/丝印/安装孔更真实）。
     只换板面底图，PCIe 槽的 frac 彩色标识与型号丝印仍叠加在上面，玩法信息不丢。 */
  if (M.__moboPcb) M.pcbMobo.map = M.__moboPcb;
  M.pcbGpu = new THREE.MeshStandardMaterial({ color: 0x131518, roughness: 0.6, map: texCircuit(256, 256, '#131518', '#2a4a44') });
  M.pcbRam = new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.58, map: texCircuit(256, 256, '#16181c', '#6d4a8c') });
  M.alu = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.9, roughness: 0.3, map: texBrushed('#9aa4b2') });
  M.aluDark = new THREE.MeshStandardMaterial({ color: 0x3a4250, metalness: 0.85, roughness: 0.35, map: texBrushed('#3a4250') });
  M.nickel = new THREE.MeshStandardMaterial({ color: 0xc8ccd4, metalness: 1, roughness: 0.22 });
  M.gold = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 1, roughness: 0.3 });
  M.black = new THREE.MeshStandardMaterial({ color: 0x0a0d12, roughness: 0.7 });
  /* 显卡外壳：真实非公卡（如 Gigabyte EAGLE）是**中性中灰塑料**，不是蓝灰金属 */
  M.gpuBody = new THREE.MeshStandardMaterial({ color: 0x50545b, metalness: 0.28, roughness: 0.56 });
  M.fanBladeDark = new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.5 });
  M.rubber = new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.95 });
  M.fanBlade = c => M.fanBlade['c' + c] || (M.fanBlade['c' + c] = new THREE.MeshStandardMaterial({ color: c, transparent: true, opacity: 0.82, roughness: 0.35 }));
  M.emissive = (c, i) => { const m = new THREE.MeshStandardMaterial({ color: 0x05070a, emissive: c, emissiveIntensity: i || 1.4, roughness: 0.4 }); return m; };
}

/* 按「实际尺寸」生成一块金属网材质：clone 贴图后改 repeat，保证孔径恒定 56mm 一格，
 * 不管贴在 210mm 的前面板还是 98mm 的电源排风网上，网眼看起来都一样密。
 * 按尺寸缓存：切换机箱时会重建 case，不缓存的话每次都会新建一张 GPU 贴图。 */
const meshMatCache = {};
function meshFilterMat(w, h) {
  const k = w + 'x' + h;
  if (meshMatCache[k]) return meshMatCache[k];
  const t = M.meshFilter.map.clone();
  t.needsUpdate = true;
  t.repeat.set(w / 56, h / 56);
  return meshMatCache[k] = new THREE.MeshStandardMaterial({
    map: t, metalness: 0.5, roughness: 0.62, alphaTest: 0.5, side: THREE.DoubleSide,
  });
}

/* ---------------- 场景常量布局（mm） ----------------
 * 机箱前后方向：Z=0 是进风面（3 个机箱风扇），Z=450 是尾部（主板 I/O、显卡挡板、
 * 电源接口、排风网）。所有配件都贴 Z=450 这一侧对齐。 */
/* 双语助手：i18n.js 先于本模块加载，直接读 window.L；无 window 时回落中文 */
const TM = (zh, en) => (typeof window !== 'undefined' && window.L) ? window.L(zh, en) : zh;

const L = {
  caseIn: { w: 210, h: 470, d: 450 },           // 机箱内腔：深×高×长
  mobo: { x: 8, y0: 110, z0: 200, w: 244, h: 305 }, // 主板平面（YZ），厚1.6。z0=200 → 板尾 I/O 在 444
  cpu: { y: 352, z: 384, s: 45 },
  dimm: { z0: 274, gap: -8, y0: 252, h: 133 },   // 4 条内存并排紧凑（真实 DIMM 间距约 8mm）
  pcieY: { 1: 216, 2: 182, 3: 162, 4: 142 },     // 物理槽 y（原 118~192 太低：4 号槽插卡会扎进电源仓，整体抬 24mm）
  pcieLen: { 16: 89, 8: 51, 4: 36 },
  psuShroud: { h: 88, z: 310 },
  frontZ: 18,                                    // 进风风扇所在端（Z=0 侧）
  topY: 462,
};

/* ---------------- 通用小件 ---------------- */
function box(w, h, d, mat, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; }
function cyl(r, h, mat, seg = 24) { return new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat); }

/* ---------------- 贴花（丝印 / 铭牌 / LOGO） ----------------
 * 不引外部图片：canvas 现画文字，透明底，贴在各部件的平面外侧 0.3mm 处。
 * 用 MeshBasicMaterial 是为了保证在暗场景里也读得出来（丝印本身就是高反射的白漆）。 */
function decalTex(main, sub, opts) {
  const o = opts || {};
  const W = o.w || 512, H = o.h || 128;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.fillStyle = o.color || '#e8eef7';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const f1 = o.font || ('700 ' + Math.round(H * (sub ? 0.42 : 0.55)) + 'px "Segoe UI",Arial,sans-serif');
  g.font = f1;
  g.fillText(main, W / 2, sub ? H * 0.38 : H * 0.52);
  if (sub) {
    g.font = '500 ' + Math.round(H * 0.24) + 'px "Segoe UI",Arial,sans-serif';
    g.globalAlpha = 0.62;
    g.fillText(sub, W / 2, H * 0.72);
    g.globalAlpha = 1;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
/* 整张写实贴图贴到单个面：MeshStandard（吃光照/金属度），透明贴图自动带 alpha。
   polygonOffset 防与母面 z-fighting；偏移 0.3mm 由调用方给。 */
function texPlane(w, h, tex, x, y, z, rot, opts) {
  const o = opts || {};
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({
    map: tex, transparent: true, depthWrite: false,
    roughness: o.rough != null ? o.rough : 0.55, metalness: o.metal != null ? o.metal : 0.15,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  m.position.set(x, y, z);
  if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  m.userData.noShadow = true;
  return m;
}
/* w/h 单位 mm；ry=π/2 时面朝 +X（从侧透看过去正读） */
function decalPlane(w, h, tex, x, y, z, ry) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
    map: tex, transparent: true, alphaTest: 0.06, depthWrite: false, opacity: 0.92,
  }));
  m.position.set(x, y, z);
  m.rotation.y = ry || 0;
  m.userData.noShadow = true;
  return m;
}

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
  /* pc53 写实轮毂贴纸：贴在叶轮中心朝下的一面，随扇叶一起转（真风扇轴心贴纸就是转的）。
     只取源图中心的金属拉丝圆标，不取整张风扇图——整张会和 3D 扇叶双重绘制打架。 */
  if (M.__fanHub) {
    const hd = new THREE.Mesh(new THREE.PlaneGeometry(size * 0.3, size * 0.3), new THREE.MeshStandardMaterial({
      map: M.__fanHub, transparent: true, depthWrite: false, roughness: 0.32, metalness: 0.65,
    }));
    hd.rotation.x = Math.PI / 2;   // 法线朝 -Y（从下方/侧透看得到）
    hd.position.y = -t * 0.45;     // 轮毂底面外侧 0.5mm
    hd.userData.noShadow = true;
    imp.add(hd);
  }
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
  /* 沿 Z 堆叠，节距必须是「鳍片厚度 d + 间隙 gap」。
     原来用 (h + gap) 当节距，h 是塔高（140mm），26 片直接堆出 3.6 米。 */
  const pitch = d + gap;
  for (let i = 0; i < count; i++) { m4.setPosition(0, 0, i * pitch - (count - 1) * pitch / 2); im.setMatrixAt(i, m4); }
  return im;
}

/* RGB 灯条 */
const rgbs = [];
function rgbBar(w, h, d, hue) { const m = M.emissive(new THREE.Color().setHSL(hue, 1, 0.55), 2.2); const mesh = box(w, h, d, m, 0, 0, 0); rgbs.push({ mat: m, hue }); return mesh; }

/* ---------------- GLB 资产加载（assets/manifest.js，缺文件回退程序化） ---------------- */
const gltfLoader = new GLTFLoader();
const glbCache = new Map(); // url -> Promise<THREE.Group|null>
const glbStats = { tried: 0, ok: 0, fail: 0 };
function loadGLB(url) {
  if (glbCache.has(url)) return glbCache.get(url);
  glbStats.tried++;
  /* 同一份资源在两种站点根下路径不同：
   *   本地开发服务器 → ../assets/models/x.glb
   *   GitHub Pages（docs/ 即站点根）→ assets/models/x.glb
   * 主路径失败后自动把前缀换掉再试一次，避免"线上少一层模型"。 */
  const alt = url.startsWith('../') ? url.slice(3) : url;
  const p = new Promise(res => {
    gltfLoader.load(url,
      g => { glbStats.ok++; res(g.scene); },
      undefined,
      () => {
        if (alt === url) { glbStats.fail++; res(null); return; }
        gltfLoader.load(alt,
          g => { glbStats.ok++; res(g.scene); },
          undefined,
          () => { glbStats.fail++; res(null); });   // 两条都失败 → 程序化回退
      });
  });
  glbCache.set(url, p);
  return p;
}
/* 把任意朝向/尺寸的模型标定进目标盒：rot 预旋转 → 居中 → 非等比缩放。
 * 返回包裹组（局部原点 = 模型中心），调用方负责把它移到装配锚点。 */
function fitGLB(src, rot, target, matName) {
  const wrap = new THREE.Group();
  const inner = new THREE.Group();
  if (rot) inner.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  inner.add(src);
  inner.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(inner);
  if (b.isEmpty()) return null;
  const sz = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
  src.position.sub(c); // 居中到原点
  inner.scale.set(target.x / (sz.x || 1), target.y / (sz.y || 1), target.z / (sz.z || 1));
  wrap.add(inner);
  const mat = (M[matName]) || M.aluDark;
  wrap.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true;
      if (o.geometry && !o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      o.material = mat; // AI 白模统一套用场景 PBR 材质
    }
  });
  return wrap;
}
/* 若 manifest 为该配件登记了 GLB，异步加载并替换程序化几何（保留动画/拾取/线缆锚点）。
 * 加载失败或无登记 → 静默保留程序化组，永不报错。 */
function attachGLB(grp, cat, id) {
  const A = window.STRATA_ASSETS; if (!A || !A.parts) return;
  const ent = A.parts[id]; if (!ent || ent.noGlb || !ent.glb) return;
  const anchor = grp.userData.anchor, fitBox = grp.userData.fitBox;
  if (!anchor || !fitBox) return; // 该类别未提供锚点（主板/内存/散热等）→ 不替换
  loadGLB(A.baseUrl + ent.glb).then(scene0 => {
    if (!scene0 || grp.userData._dead) return;
    const wrap = fitGLB(scene0, ent.rot, fitBox, (A.material || {})[cat]);
    if (!wrap) return;
    /* anchor 允许两种写法：数组 [x,y,z] 或对象 {x,y,z}。
       之前只认数组，而显卡给的是对象 → anchor[0] 是 undefined → 位置变 NaN → 整张卡凭空消失。 */
    const ap = Array.isArray(anchor) ? anchor : [anchor.x, anchor.y, anchor.z];
    wrap.position.set(ap[0], ap[1], ap[2]);
    // 隐藏程序化子件，保留 userData（powerAt/anchor 供线缆与拾取用）
    grp.children.slice().forEach(ch => { ch.visible = false; });
    grp.add(wrap);
    grp.userData.glbWrapped = wrap;
    /* GLB 加载完成后再追加「装饰贴图」（如电源铭牌）：这些面片不属于程序化几何，
       不能被上面的 visible=false 隐藏，所以挂在 GLB 之后、按世界坐标浮在观察窗一侧。 */
    if (grp.userData.postGlbDecal) grp.userData.postGlbDecal();
  });
}

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
  g.add(box(W, H, th, M.steel, W / 2, H / 2, D + th / 2));         // 尾部墙（Z=D 一侧）
  /* ---------------- 尾部面板：三段接线区 ----------------
   * 由下往上：①电源（220V 插座 + 排风网）②显卡（PCIe 挡板条 + 92mm 排风口）③主板 I/O（USB / 视频 / 网口 / 音频）。
   * 细节全部做在尾板**外表面**（z ≥ D+th）：从机箱外面看是实打实的接口，而不是一块黑板。
   * 接口做成 4mm 厚的块，一半嵌进尾板、一半露在外面，从腔内也能看到接口的屁股。 */
  const zw = D + th;                                     // 尾板外表面 z = 453
  const portBox = (w, h, x, y, mat) => g.add(box(w, h, 4, mat || M.black, x, y, zw + 1.3));

  /* ③ 主板 I/O 区（y 356…414，与主板顶沿 415 对齐） */
  g.add(box(152, 58, 2.4, M.steelDark, 80, 385, zw + 0.2));        // I/O 挡板
  g.add(box(146, 52, 0.8, M.black, 80, 385, zw + 1.5));            // 挡板内深色底
  for (const [px, py] of [[16, 402], [33, 402], [16, 392], [33, 392]]) {   // USB-A ×4（2×2）
    portBox(13, 6.5, px, py, M.steelDark);
    g.add(box(9, 3, 1.2, M.black, px, py, zw + 3.4));              // 口内的黑腔
  }
  portBox(9, 3.6, 49, 397, M.steelDark);                           // USB-C
  portBox(16, 13, 67, 397, M.nickel);                              // RJ45 网口（金属壳）
  g.add(box(12, 9, 1.2, M.black, 67, 396, zw + 3.4));
  for (let i = 0; i < 3; i++) {                                    // 3.5mm 音频 ×3
    const j = cyl(3.2, 4, M.black, 14); j.rotation.x = Math.PI / 2;
    j.position.set(88 + i * 9, 397, zw + 1.8); g.add(j);
  }
  portBox(15, 6.5, 18, 371, M.steelDark);                          // HDMI
  portBox(16, 7.5, 40, 371, M.steelDark);                          // DisplayPort
  for (const px of [128, 139]) {                                   // WiFi 天线座 ×2
    const a = cyl(3, 4, M.gold, 12); a.rotation.x = Math.PI / 2;
    a.position.set(px, 404, zw + 1.8); g.add(a);
  }
  const bbtn = cyl(2, 3, M.steelDark, 10); bbtn.rotation.x = Math.PI / 2;   // BIOS 刷写按钮
  bbtn.position.set(120, 388, zw + 2); g.add(bbtn);

  /* ② 显卡区：7 条 PCIe 挡板条（带排风百叶） */
  for (let i = 0; i < 7; i++) {
    const sy = 242 - i * 20;
    g.add(box(122, 11, 1.6, M.steelDark, 62, sy, zw + 0.7));
    for (let k = 0; k < 5; k++) g.add(box(14, 2, 1, M.black, 20 + k * 22, sy, zw + 1.6));
  }
  /* 尾部 92mm 排风口（夹在显卡区和 I/O 之间）：塑料圈 + 金属网 */
  const vring = new THREE.Mesh(new THREE.TorusGeometry(42, 3, 8, 40), M.steelDark);
  vring.position.set(105, 300, zw + 1.2); g.add(vring);
  const vmesh = new THREE.Mesh(new THREE.CircleGeometry(41, 40), meshFilterMat(82, 82));
  vmesh.position.set(105, 300, zw + 0.8); g.add(vmesh);

  /* ① 电源区：排风网 + 220V 插座 + 开关 */
  const pv = new THREE.Mesh(new THREE.PlaneGeometry(98, 60), meshFilterMat(98, 60));
  pv.position.set(78, 52, zw + 0.5); g.add(pv);
  g.add(box(106, 4, 2, M.steelDark, 78, 84, zw + 0.9));            // 网框 上
  g.add(box(106, 4, 2, M.steelDark, 78, 20, zw + 0.9));            // 网框 下
  g.add(box(4, 68, 2, M.steelDark, 27, 52, zw + 0.9));             // 网框 左
  g.add(box(4, 68, 2, M.steelDark, 129, 52, zw + 0.9));            // 网框 右
  g.add(box(32, 24, 2.4, M.steelDark, 148, 50, zw + 0.2));         // 插座外框
  g.add(box(24, 16, 2, M.black, 148, 50, zw + 1.4));               // 插座凹槽
  g.add(box(2.6, 7, 1.6, M.nickel, 143, 50, zw + 2.1));            // 零线/火线插片
  g.add(box(2.6, 7, 1.6, M.nickel, 153, 50, zw + 2.1));
  g.add(box(3, 3, 1.6, M.nickel, 148, 44, zw + 2.1));              // 接地
  g.add(box(14, 12, 2.4, M.steelDark, 148, 76, zw + 0.2));         // 电源开关
  g.add(box(10, 5, 1.6, M.emissive(0xff4b3a, 0.7), 148, 79, zw + 1.6));
  g.add(box(10, 4, 1.6, M.black, 148, 73.5, zw + 1.6));
  /* 尾板四角螺丝 */
  for (const [sx, sy] of [[9, 9], [201, 9], [9, 461], [201, 461]]) {
    const s = cyl(3.2, 2, M.steelDark, 10); s.rotation.x = Math.PI / 2;
    s.position.set(sx, sy, zw + 0.8); g.add(s);
  }
  g.add(box(W, th, D, M.steel, W / 2, H + th / 2, D / 2));         // 顶
  g.add(box(th, H, D, M.steel, -th / 2, H / 2, D / 2));            // 右（主板托盘侧）
  /* 另一侧端面：四条边框（原来是 box(6,H,th+6)——只有 6mm 宽，看起来像机箱中间竖着一根杆）。 */
  const bz = 16, fzP = -3, fthP = th + 6;
  g.add(box(W + 8, bz, fthP, M.edge, W / 2, H - bz / 2, fzP));   // 上（折边料，比主体亮一档）
  g.add(box(W + 8, bz, fthP, M.edge, W / 2, bz / 2, fzP));       // 下
  g.add(box(bz, H, fthP, M.edge, bz / 2, H / 2, fzP));           // 左
  g.add(box(bz, H, fthP, M.edge, W - bz / 2, H / 2, fzP));       // 右
  g.add(box(W + 8, 14, 10, M.edge, W / 2, H + 7, -3));     // 顶沿
  /* 折边高光：沿外轮廓加 1.8mm 的亮边（顶前棱 + 两条前立柱 + 仓罩前唇），
     相当于真实钣金折边被磨亮的那一圈，用来勾出机箱轮廓。 */
  const CH = 1.8;
  g.add(box(W + 12, CH, CH, M.chamfer, W / 2, H + 2.2, -7.9));      // 顶前棱
  g.add(box(CH, H + 2, CH, M.chamfer, -4.2, H / 2, -7.9));          // 左前立柱
  g.add(box(CH, H + 2, CH, M.chamfer, W + 4.2, H / 2, -7.9));       // 右前立柱
  g.add(box(W - 6, CH, CH, M.chamfer, (W) / 2, L.psuShroud.h + 2.6, 140.6)); // 电源仓罩前唇
  /* 前置金属网防尘板：铺满进风面，网孔用 alphaTest 镂空（真·透孔，不是半透明）。
     放在 z=0.5，正好落进四条边框的厚度里（-7.5…1.5），四周被边框压住，不会露毛边。 */
  const filt = new THREE.Mesh(new THREE.PlaneGeometry(W, H), M.meshFilter);
  filt.position.set(W / 2, H / 2, 0.5);
  filt.userData.noShadow = true;           // 镂空面投影会糊成一整块黑板，跳过投影
  g.add(filt);
  // 电源仓罩（跟着电源一起挪到 Z 尾部侧）
  const sh = box(W - 14, 4, L.psuShroud.z, M.shroud, (W - 14) / 2 + 4, L.psuShroud.h, D - L.psuShroud.z / 2);
  g.add(sh);
  /* 写实遮罩贴花（pc53 正交生成：STRATA logo 拉丝面板，铭铭验收）：贴仓罩顶面前部露出区
     （z 150…230，显卡前缘之前，从侧透看得到）。logo 横向沿 X，rot=[-π/2,0,0] 躺平法线 +Y。 */
  if (M.__caseShroud) g.add(texPlane(150, 70, M.__caseShroud, (W - 14) / 2 + 4, L.psuShroud.h + 2.4, 190,
    [-Math.PI / 2, 0, 0], { metal: 0.6, rough: 0.4 }));
  /* 电源仓侧板：改成「四条框 + 中间玻璃观察窗」。
     窗洞 z 200…410（正对电源本体 232…444）、y 12…78，四周留 40/10/12 的框边。 */
  const shX = W - 12, shZ0 = D - L.psuShroud.z;   // 侧板所在 x=198，罩体起点 z=140
  g.add(box(4, L.psuShroud.h, 60, M.shroud, shX, L.psuShroud.h / 2, shZ0 + 30));            // 前段框
  g.add(box(4, L.psuShroud.h, 40, M.shroud, shX, L.psuShroud.h / 2, D - 20));               // 尾段框
  g.add(box(4, 10, 210, M.shroud, shX, 83, 305));                                          // 上框（78…88，贴罩顶）
  g.add(box(4, 12, 210, M.shroud, shX, 6, 305));                                           // 下框
  /* 观察窗玻璃：标成 isShroudGlass，射线打上去不能停在这块玻璃上——
     要穿过去命中后面的电源（否则永远只能选中整只机箱）。
     透明度也压到 0.07，接近真机上的亚克力/钢化玻璃，能看清电源本体的铭牌。 */
  const glassWin = box(1.6, 66, 210, M.glassWin, shX, 45, 305);
  glassWin.userData.isShroudGlass = true;
  g.add(glassWin);
  /* 窗框：一圈 1.5mm 亮边，让玻璃有「装进去」的厚度感 */
  g.add(box(1.5, 1.5, 212, M.nickel, shX + 1.7, 78.4, 305));
  g.add(box(1.5, 1.5, 212, M.nickel, shX + 1.7, 11.6, 305));
  g.add(box(1.5, 68, 1.5, M.nickel, shX + 1.7, 45, 200.4));
  g.add(box(1.5, 68, 1.5, M.nickel, shX + 1.7, 45, 409.6));
  // 罩上 RGB 装饰条（Strata logo 带）：让到窗洞前面，别横穿玻璃
  const strip = rgbBar(2, 3, 46, 0.55); strip.position.set(W - 11, 30, 170); g.add(strip);
  /* 机箱铭牌贴花：印在电源仓侧板前段（透过侧透玻璃能看到，正对机箱前部） */
  g.add(decalPlane(52, 13, decalTex('STRATA', 'MFT-3F', { w: 512, h: 128, color: '#dce6f2' }),
    200.4, 52, 172, Math.PI / 2));
  // 主板铜柱
  for (const [my, mz] of [[130, 60], [130, 260], [390, 60], [390, 260], [260, 60]]) {
    const st = cyl(3, 8, M.gold, 10); st.rotation.z = Math.PI / 2; st.position.set(3, my, D - mz); g.add(st);
  }
  // 进风风扇（case.fans 决定 3 或 7）：立在 Z=0 这一端，轴向沿 Z（前后吹）
  const nf = Math.min(kase.fans >= 3 ? 3 : kase.fans, 3);
  for (let i = 0; i < nf; i++) {
    const f = makeFan(120, 0x3fb6ff);
    f.rotation.x = Math.PI / 2;                                   // makeFan 默认躺平在 XZ 平面
    f.position.set(W / 2, 120 + i * 130, L.frontZ); g.add(f);
  }
  if (kase.fans >= 7) { // 顶部 3（躺平正确）+ 尾部 1（立起来，轴向沿 Z）
    for (let i = 0; i < 3; i++) { const f = makeFan(120, 0x3fb6ff); f.position.set(W / 2, L.topY - 60, D - 120 - i * 130); g.add(f); }
    const rf = makeFan(92, 0x3fb6ff); rf.rotation.x = Math.PI / 2; rf.position.set(W / 2, 300, D - 8); g.add(rf);
  }
  /* 玻璃侧透门：整块玻璃 + 四周边框条（不能是实心板，否则挡死内腔）。
   * 转轴 = 门的一条竖棱：组原点直接放在那条棱上，子件沿 z 偏移半个门深，
   * 这样 door.rotation.y 才是绕棱开合。原点放门中间会让一半玻璃扎进机箱。 */
  const door = new THREE.Group();
  const dLen = D - 20;                            // 门宽（沿 z）
  const dz = (DOOR_HINGE_FRONT ? -1 : 1) * dLen / 2;  // 门中心相对铰链的 z 偏移
  door.add(box(2, H - 20, dLen, M.glass, 0, 0, dz));
  const fw = 14; // 边框条宽
  door.add(box(8, fw, dLen, M.steel, 0, (H - 20) / 2 - fw / 2, dz));   // 上
  door.add(box(8, fw, dLen, M.steel, 0, -(H - 20) / 2 + fw / 2, dz));  // 下
  door.add(box(8, H - 20, fw, M.steel, 0, 0, dz - dLen / 2 + fw / 2)); // 铰链侧
  door.add(box(8, H - 20, fw, M.steel, 0, 0, dz + dLen / 2 - fw / 2)); // 自由边
  door.position.set(W + 2, H / 2, DOOR_HINGE_FRONT ? D - 10 : 10);     // 铰链棱
  door.userData.isDoor = true;
  g.add(door);
  g.userData.door = door;
  return g;
}

function buildMotherboard(m, a) {
  const g = new THREE.Group();
  const { y0, z0, w, h } = L.mobo;
  const pcb = box(1.6, h, w, M.pcbMobo, 0.8, y0 + h / 2, z0 + w / 2); g.add(pcb);
  /* 尾部 I/O 护罩：真板（如 ROG STRIX）是一整块**银色铝**，比我们原来的深色小方块大得多 */
  g.add(box(16, 35, 66, M.alu, 8, y0 + h - 18, z0 + w - 36));
  /* 顶部供电模块：6 片，整体贴到与主板顶沿齐平（y 385…415），
     不再和内存条在 z 方向上堆叠 */
  g.add(fins(6, 12, 30, 6, 4, M.alu).translateX(10).translateY(y0 + h - 15).translateZ(320));
  /* 芯片组（南北桥）：梯形散热片，放在 CPU 下方 —— 用 Shape + 挤出做真正的梯形截面 */
  const cs = new THREE.Shape();
  cs.moveTo(-32, -18); cs.lineTo(32, -18); cs.lineTo(24, 18); cs.lineTo(-24, 18); cs.closePath();
  const chip = new THREE.Mesh(new THREE.ExtrudeGeometry(cs, { depth: 9, bevelEnabled: false }), M.alu);
  chip.rotation.y = Math.PI / 2;      // 截面贴主板（YZ 面），厚度沿 +X
  chip.position.set(3, 288, 360);
  g.add(chip);
  // 电池
  const batt = cyl(10, 2.5, M.nickel, 20); batt.rotation.z = Math.PI / 2; batt.position.set(6, y0 + 60, z0 + w - 120); g.add(batt);
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
    /* 槽 y：布局表只定义了物理槽 1~4；HEDT/服务器板（TRX40 槽5、H11DSi 槽5/7/9）
       按 20mm 槽距向下外推，避免 undefined 坐标变 NaN 让整块槽消失 */
    const sy = L.pcieY[p.pos] != null ? L.pcieY[p.pos] : Math.max(120, L.pcieY[4] - (p.pos - 4) * 20);
    const slot = box(6, 12, len, M.aluDark, 4, sy, z0 + w - 8 - len / 2);
    g.add(slot);
    const glow = box(1.5, 2, len, M.emissive(col, 1.6), 7.5, sy + 7, z0 + w - 8 - len / 2); g.add(glow);
  });
  // 24pin + EPS 插座（贴板头一侧）
  g.add(box(8, 45, 24, M.black, 5, y0 + 150, z0 + 8));
  g.add(box(8, 20, 40, M.black, 5, y0 + h - 10, z0 + w - 30));
  /* 板载丝印：印在**内存与第一张显卡之间的空档**（y≈241，x=1.75 板面外侧）。
     原来在 y=300、z=250，正好被四条内存（z 246…278、x 5…36）整块挡住。
     y 240 这条带子在第一条 PCIe 槽（顶 228）之上、内存底边（252）之下，
     z 取 285…329，左右都空着，从侧透看得到。 */
  g.add(decalPlane(44, 11, decalTex('STRATA', m.form + ' · ' + m.socket, { w: 512, h: 128, color: '#cfe4ff' }),
    1.75, 241, 307, Math.PI / 2));
  return g;
}

function buildCPU(c) {
  const g = new THREE.Group();
  g.add(box(2, L.cpu.s, L.cpu.s, M.pcbGpu, 4.5, L.cpu.y, L.cpu.z));
  const ihs = box(3.5, L.cpu.s - 12, L.cpu.s - 8, M.nickel, 6.5, L.cpu.y, L.cpu.z); g.add(ihs);
  /* pc53 写实 IHS 顶盖贴图：贴 +X 面（侧透可见面），镀镍拉丝+蚀刻型号。
     装了散热器时被冷头/塔体遮住，和真机一致。
     AMD 阵营（AM4/AM5/TRX4/SP3）用红黑 IHS 贴图（texdata4），素材缺失时不贴（宁缺勿错）。 */
  const ihsTex = c.brand === 'AMD' ? M.__cpuIhsAmd : M.__cpuIhs;
  if (ihsTex) g.add(texPlane(L.cpu.s - 8, L.cpu.s - 12, ihsTex, 8.55, L.cpu.y, L.cpu.z,
    [0, Math.PI / 2, 0], { metal: 0.9, rough: 0.25 }));
  g.userData.anchor = [5.5, L.cpu.y, L.cpu.z];
  g.userData.fitBox = { x: 6, y: L.cpu.s, z: L.cpu.s };
  return g;
}

function buildCooler(co) {
  const g = new THREE.Group();
  if (co.type === 'aio') {
    const head = cyl(32, 24, M.aluDark, 28); head.rotation.z = Math.PI / 2; head.position.set(20, L.cpu.y, L.cpu.z); g.add(head);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(26, 2.5, 8, 40), M.emissive(0x3fb6ff, 2));
    ring.rotation.y = Math.PI / 2; ring.position.set(33, L.cpu.y, L.cpu.z); g.add(ring); rgbs.push({ mat: ring.material, hue: 0.55 });
    /* 写实泵顶贴图（pc53 正交俯视图：圆形金属泵盖+中心镜面logo）：贴冷头 +X 圆面（侧透可见）。
       冷头半径 32，贴图取直径 ~58 的圆面，rot=[0,π/2,0] 让圆面法线朝 +X。 */
    if (M.__aioPump) g.add(texPlane(58, 58, M.__aioPump, 32.6, L.cpu.y, L.cpu.z, [0, Math.PI / 2, 0], { metal: 0.7, rough: 0.35 }));
    /* 顶部冷排：长度读数据（radLen 默认 380=360 冷排）。380mm 居中放在 z=250（占 60…440），
       240 冷排（270mm）居中占 115…385——尾部对齐后都不会顶穿端面。风扇数读 radFans。
       风扇起点公式按冷排中心推（-50 偏移保证 360 冷排时与原布局 390/265/140 完全一致）。 */
    const radLen = co.radLen || 380, nRad = co.radFans || 3;
    const rad = box(70, 28, radLen, M.steelDark, L.caseIn.w / 2, L.topY - 16, 250); g.add(rad);
    for (let i = 0; i < nRad; i++) {
      const f = makeFan(120, 0x7fd1ff);           // makeFan 默认轴沿 Y，正对上方冷排吹
      f.position.set(L.caseIn.w / 2, L.topY - 42, 250 + radLen / 2 - 50 - i * 125); g.add(f);
    }
    // 水管：从冷头绕到顶部冷排
    g.userData.tubes = [
      [[30, L.cpu.y + 10, L.cpu.z + 8], [46, L.cpu.y + 46, L.cpu.z + 14], [58, 420, 300], [L.caseIn.w / 2 - 20, L.topY - 30, 300]],
      [[30, L.cpu.y + 10, L.cpu.z - 8], [52, L.cpu.y + 58, L.cpu.z - 14], [64, 424, 240], [L.caseIn.w / 2 - 20, L.topY - 30, 240]],
    ];
  } else {
    const copper = M.copper || (M.copper = new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 1, roughness: 0.35 }));
    g.add(box(6, 40, 40, copper, 12, L.cpu.y - 24, L.cpu.z));   // 底座
    /* 塔体：鳍片沿 Z 叠成一块 finX(X) × towerH(Y) 的方块。
       尺寸全部读 parts.js 数据字段（finW/fanD/towerH/towers，2026-10-19 扩库时参数化）：
       NH-D15 150mm、PA120SE 125mm、AX120 120mm、AK620 127mm。
       （高度没敢照抄 165mm —— 见 towerH 那行的说明。） */
    const finX = co.finW || 120;
    const fanD = co.fanD || 120;
    /* 高度受机箱限制：本机箱内腔 470 高，CPU 中心在 352，到顶只剩 118mm。
       真机 D15 是 165mm，照抄会直接顶穿顶板，所以数据里统一按可用净空压到 150。 */
    const towerH = co.towerH || 150;
    const nT = co.towers || 1;
    /* 塔体：鳍片沿 Z 叠成一块 finX(X) × towerH(Y) 的方块。
       塔心稍微前移（cz），否则 118~160mm 深的塔体会顶穿机箱后窗。 */
    const nFin = nT === 2 ? 10 : 19, pitch = 5 + 1.2;
    const depth = nFin * pitch;
    const cz = L.cpu.z - (nT === 2 ? 8 : 4);
    for (let t = 0; t < nT; t++) {
      const f = fins(nFin, finX, towerH, 5, 1.2, M.alu);
      const tz = cz - (nT === 1 ? 0 : (t - 0.5) * (depth + 20));
      f.position.set(14 + finX / 2, L.cpu.y + 40, tz);
      g.add(f);
      /* 写实塔顶盖贴图（pc53 正交俯视图：镀镍顶板+蚀刻logo+四角螺丝）：贴塔体顶面（法线 +Y）。
         只取贴图中心顶板区，避免与 3D 鳍片双重绘制——裁掉源图两侧鳍片列。 */
      if (M.__coolerTop) g.add(texPlane(finX - 14, depth - 14, M.__coolerTop,
        14 + finX / 2, L.cpu.y + 40 + towerH / 2 + 0.4, tz, [-Math.PI / 2, 0, 0], { metal: 0.85, rough: 0.3 }));
    }
    // 风扇正对塔体吹（轴向沿 Z）。原来绕 Z 转了 90°，变成朝侧透吹
    const fan = makeFan(fanD, 0x7fd1ff);
    fan.rotation.x = Math.PI / 2;
    fan.position.set(14 + finX / 2, L.cpu.y + 40, cz - (nT === 1 ? depth / 2 + 15 : depth + 26));
    g.add(fan);
    /* 实测结论（probe_cooler_glb.cjs A/B）：混元3D 双塔 GLB 鳍片糊+风扇静态，
       不如程序化（鳍片清晰+旋转动画），散热全部保持 noGlb，不设 anchor/fitBox。 */
  }
  return g;
}

function buildDIMM(d, i) {
  const g = new THREE.Group();
  const z = L.dimm.z0 + i * L.dimm.gap;
  const yc = L.dimm.y0 + L.dimm.h / 2;
  /* 内存条是「片状」而不是细长棍，三个尺寸缺一不可：
   *   Y = 133mm 金手指长度（沿主板竖直方向）
   *   X = 31mm  内存高度（垂直主板向外伸出）
   *   Z = 1.6mm PCB 厚度（槽距方向）
   * 旧版把 31mm 写成了 2mm，整条就只剩 133×7 的一根棍子。 */
  const X0 = 5, HGT = 31, PCB = 1.6;
  /* 马甲颜色读 parts.js color 字段（2026-10-19 扩库参数化）：
   * 真实市场同容量就有 黑/白/银 三种马甲（LPX 黑、复仇者白、Ripjaws 银）；green=裸 PCB 无马甲 */
  const white = d.color === 'white', silver = d.color === 'silver', bare = d.color === 'green';
  const armor = white
    ? new THREE.MeshStandardMaterial({ color: 0xd8dbe1, metalness: 0.55, roughness: 0.34 })
    : silver
    ? new THREE.MeshStandardMaterial({ color: 0xa7adb8, metalness: 0.8, roughness: 0.3 })
    : bare
    ? new THREE.MeshStandardMaterial({ color: 0x1d3326, metalness: 0.35, roughness: 0.6 })
    : new THREE.MeshStandardMaterial({ color: 0x2d3036, metalness: 0.72, roughness: 0.42 });
  g.add(box(HGT, L.dimm.h, PCB, M.pcbRam, X0 + HGT / 2, yc, z));                 // PCB
  if (!bare) {
  g.add(box(HGT - 4, L.dimm.h - 8, 2, armor, X0 + HGT / 2, yc, z - 1.9));        // 马甲（前）
  g.add(box(HGT - 4, L.dimm.h - 8, 2, armor, X0 + HGT / 2, yc, z + 1.9));        // 马甲（后）
  /* 马甲侧面的竖向鳍片：真马甲是一排冲压出来的立筋，平板上看只有明暗条纹 */
  for (let k = 0; k < 6; k++) {
    const rx = X0 + 3 + k * ((HGT - 8) / 5);
    g.add(box(1.6, L.dimm.h - 14, 1.2, armor, rx, yc, z - 3.1));
    g.add(box(1.6, L.dimm.h - 14, 1.2, armor, rx, yc, z + 3.1));
  }
  }
  /* 顶部 RGB 导光条：沿 Y 铺在离板最远的那条边上（裸条/RECC 服务器条没有灯） */
  if (!bare) {
  const bar = rgbBar(4, L.dimm.h - 16, 6, (i * 0.13) % 1);
  bar.position.set(X0 + HGT - 2, yc, z); g.add(bar);
  }
  /* 写实马甲贴图（Kingston FURY Beast 官方正侧视图，黑/白按套条；银色用 texdata4 素材，缺则纯色兜底）：
     贴马甲 ±Z 大面。贴图已 CW 转 90°：长边（金手指长度）沿 v、金手指落 u=0。马甲面 27(X)×125(Y)。
     后脸(+Z) rot=0 使金手指(u=0)落在靠主板侧(低X)；前脸(-Z) 绕 Y 翻 180°。 */
  const ramTex = bare ? null : silver ? (M.__ramSilver || M.__ramBlack) : white ? M.__ramWhite : M.__ramBlack;
  if (ramTex && !bare) {
    g.add(texPlane(27, 125, ramTex, X0 + HGT / 2, yc, z + 3.0, [0, 0, 0], { metal: 0.5, rough: 0.42 }));
    g.add(texPlane(27, 125, ramTex, X0 + HGT / 2, yc, z - 3.0, [0, Math.PI, 0], { metal: 0.5, rough: 0.42 }));
  }
  return g;
}

/* 显卡卡高（金手指平面 → 卡顶，沿 X）。
 * 来源：NVIDIA 官方规格页 —— RTX 4090 FE 304×137×61；RTX 3080 FE 285×112×40。
 * 之前所有卡都写死 112mm，结果 4090 这种三槽高卡和 3080 一样薄，和实物比例明显不符。 */
const GPU_HGT = {
  'rtx-3080-10g': 112, 'rtx-3080-20g': 120, 'rtx-3090': 120, 'rtx-2080ti-22g': 112,
  'rtx-4070s': 130, 'rtx-4090': 137, 'rtx-5090': 137, 'rtx-pro-4500': 112, 'rtx-a6000': 112,
  /* 2026-10-19 扩库新增（FE/公版或主流非公官方规格，mm） */
  'rtx-3060-12g': 112, 'rtx-3070-8g': 112, 'rtx-4060ti-16g': 115, 'rtx-4070': 115,
  'rtx-4070tis': 137, 'rtx-4080s': 137, 'rtx-5070': 114, 'rtx-5070tis': 130, 'rtx-5080': 130,
  'rx-6750xt-12g': 115, 'rx-7600-8g': 110, 'rx-7800xt-16g': 115, 'rx-7900xtx-24g': 110, 'rx-9070xt-16g': 130,
};
function buildGPU(gpu, assign, i) {
  const g = new THREE.Group();
  /* HEDT/服务器板物理槽超出布局表（TRX40 槽5、H11DSi 槽5/7/9）：按 20mm 槽距外推，
     钳到主板下沿 118 以上。多卡在高数槽位上视觉会贴近/略叠（内腔高度物理上限），数据层不受影响。 */
  const slotY = L.pcieY[assign.slotPos] != null ? L.pcieY[assign.slotPos] : Math.max(118, L.pcieY[4] - (assign.slotPos - 4) * 20);
  const th = gpu.thick * 20;              // 厚度（沿 Y）：2 槽 40 / 3 槽 60
  const len = gpu.len;                    // 长度（沿 Z）
  const HGT = GPU_HGT[gpu.id] || 112;     // 高度（沿 X）：从金手指平面到卡顶
  const x0 = 4;                           // 金手指平面（插槽内的位置）
  const x1 = x0 + HGT;                    // 卡顶，朝侧透一侧
  const xc = (x0 + x1) / 2;
  const zR = L.caseIn.d;                // 卡尾与后面板内壁齐平（铭铭 2026-10-18 定：挡板贴 I/O 面，显卡与机箱后面齐平）
  const zc = zR - len / 2;
  const botY = slotY - th;                // 散热罩底面
  const col = assign.slot.frac >= 0.9 ? 0x3fd68f : assign.slot.frac >= 0.5 ? 0xffb454 : 0xff5d6c;

  /* 朝向按 ATX 塔式真实插装来定（坐标系 X=深/0 托盘侧, Y=高, Z=后→前）：
   *   PCB 水平（法线 +Y），高度沿 X 从插槽伸向侧透，长度沿 Z 前后；
   *   散热罩挂在 PCB 下方，风扇朝下；挡板在 Z 尾、与卡同高。
   * 旧版把「厚度」当成了 X、「高度」当成了 Y，整张卡是竖着贴在主板上的，
   * 于是挡板横穿机箱、风扇圆心落在托盘里、卡体只有 30mm 厚却堆了 98mm 高。 */
  g.add(box(HGT - 8, 1.6, len - 14, M.pcbGpu, xc, slotY, zc));                        // PCB
  /* A 卡（vendor:'amd'）散热罩用偏黑塑料+红黑配色基调；N 卡保持中性灰。
     写实导风罩/背板贴图按阵营分流：A 卡优先 texdata4 素材，缺则纯色程序化兜底。 */
  const isAmd = gpu.vendor === 'amd';
  const bodyMat = isAmd
    ? (M.gpuBodyAmd || (M.gpuBodyAmd = new THREE.MeshStandardMaterial({ color: 0x23262b, metalness: 0.3, roughness: 0.5 })))
    : M.gpuBody;
  g.add(box(HGT - 12, th - 12, len - 22, bodyMat, xc, botY + 12 + (th - 12) / 2, zc)); // 散热罩
  /* pc53 写实导风罩贴图：贴在散热罩底面（风扇安装面），三圆口透出真实 3D 风扇。
     贴图已裁掉挡板/金手指、RGB 灯带朝向卡顶前缘（与 Gaming X Slim 实物一致）。 */
  const shroudTex = isAmd ? M.__gpuShroudAmd : M.__gpuShroud;
  if (shroudTex) g.add(texPlane(HGT - 12, len - 22, shroudTex, xc, botY + 11.7, zc,
    [Math.PI / 2, 0, 0], { metal: 0.35, rough: 0.5 }));
  g.add(box(HGT - 16, 1.5, len - 18, M.alu, xc, slotY + 2.3, zc));                    // 背板
  /* 写实背板贴图（pc53 正交生成：拉丝铝+RTX logo+栅格+四角螺丝，铭铭验收）：
     贴卡顶面（法线 +Y，侧透主视角）。rot=[-π/2,0,0] → u 沿世界 +X（卡顶边缘，栅格落这边）、
     v 沿 -Z（卡长）。程序化版贴背板顶 3.2；GLB 版由 postGlbDecal 在白模顶(slotY+4)补挂。 */
  const addBack = yTop => {
    const backTex = isAmd ? M.__gpuBackAmd : M.__gpuBack;
    if (backTex) g.add(texPlane(HGT - 16, len - 18, backTex, xc, yTop, zc,
      [-Math.PI / 2, 0, 0], { metal: 0.85, rough: 0.32 }));
  };
  addBack(slotY + 3.2);
  g.userData.postGlbDecal = () => addBack(slotY + 4.4);
  // 挡板（XY 平面，贴尾部墙面）
  g.add(box(HGT, th + 10, 2, M.steel, xc, slotY - th / 2 + 5, zR + 3));
  // 挡板开孔示意（DP/HDMI）
  for (let k = 0; k < 3; k++) g.add(box(12, 8, 3.5, M.black, x1 - 12 - k * 16, slotY - th / 2 + 6, zR + 3));
  // 风扇：轴沿 Y 朝下。makeFan 本身就在 XZ 平面上，不需要再绕 X 转
  /* 真实非公卡（EAGLE / TUF / Gaming OC）是**黑色扇叶 + 浅灰轴心圆标**，
     不是彩色叶片。LED 圈留在风扇外沿，只在开机时亮。 */
  const nf = len >= 300 ? 3 : 2;
  for (let k = 0; k < nf; k++) {
    const d = Math.min(92, (len - 40) / nf - 8);
    const f = makeFan(d, 0x3a3f47);
    f.position.set(xc, botY + 6, zR - 12 - (k + 0.5) * (len - 40) / nf);
    const cap = cyl(d * 0.17, 1.4, M.alu, 20);            // 轴心圆标
    cap.position.set(0, -d * 0.06 - 0.6, 0);
    f.add(cap);
    g.add(f);
  }
  // 供电口：装在卡**边缘朝侧透那侧**（原来在 slotY-12，埋在散热罩里面，线根本插不进去）
  const is16 = /16pin|12pin/.test(gpu.conn);
  const connZ = zR - len + 40;
  g.add(box(6, 12, is16 ? 26 : 18, M.black, x1 + 1, slotY + 6, connZ));
  // 侧边 RGB logo 条 + frac 状态灯带
  const logo = rgbBar(2.5, 2.5, len * 0.35, 0.95); logo.position.set(x1 - 2, slotY - 4, zc); g.add(logo);
  const strip = box(1.5, 2, len - 30, M.emissive(col, 2), x1 - 3, slotY - 2, zc); g.add(strip);
  /* 贴花：卡顶朝侧透那面印型号 + 显存/供电，真实显卡的丝印就在这个位置 */
  /* 卡顶边缘的银色拉丝饰条 —— 真卡（EAGLE / ROG）外缘都有一条拉丝铝 */
  g.add(box(0.7, th * 0.5, len - 34, M.alu, x1 + 0.35, slotY - th / 2, zc));
  g.add(decalPlane(Math.min(64, len * 0.34), 9,
    decalTex(gpu.name, gpu.vram + 'GB · ' + gpu.conn, { w: 512, h: 96 }),
    x1 + 0.78, slotY - th / 2, zc, Math.PI / 2));
  /* 折边高光：卡体外侧上下两条棱（真卡的散热罩折边会磨出一圈亮线） */
  g.add(box(1.4, 1.4, len - 18, M.chamfer, x1 - 0.4, slotY + 2.4, zc));
  g.add(box(1.4, 1.4, len - 18, M.chamfer, x1 - 0.4, slotY - th + 2.4, zc));
  /* 线缆插点：在卡的 +X 外侧，留 4mm 让插头露在卡外，线从外面横着插进来 */
  g.userData.powerAt = [x1 + 4, slotY + 8, connZ];
  g.userData.frontZ = zR - len;          // 卡前缘（走线竖井判断是否被长卡占满）
  /* GLB 装配锚点必须是数组：attachGLB 按 anchor[0..2] 取坐标，
     之前这里是对象 {x,y,z}，取出来全是 undefined，位置变 NaN，整张卡直接消失。 */
  g.userData.anchor = [xc, slotY - th / 2 + 2, zc];
  g.userData.fitBox = { x: HGT, y: th + 4, z: len };
  return g;
}

function buildSSD(s, i) {
  const g = new THREE.Group();
  if (s.type === 'nvme') {
    /* M.2 平贴主板：板面是 YZ 平面，所以 80mm 长度沿 Z、22mm 宽度沿 Y、2mm 厚度沿 X。
       原来是 box(80,2,22)，把 80mm 放在了 X 上，等于一根 80mm 的板子横插进机箱。 */
    const y = L.pcieY[2] - 14 - i * 16, z = L.mobo.z0 + L.mobo.w - 60;
    g.add(box(2, 22, 80, M.pcbGpu, 4, y, z));
    g.add(box(6, 20, 74, M.aluDark, 8, y, z));
  } else if (s.type === 'sata_ssd') {
    /* 2.5" SATA SSD：7×100×69.9mm，立在电源仓前部的硬盘位（Y 向薄、Z 向长） */
    g.add(box(7, 100, 70, M.aluDark, 90, 100, 120));
    g.add(box(1, 60, 40, M.emissive(0x54d6c8, 0.5), 94, 100, 120));
  } else {
    g.add(box(146, 26, 101, M.alu, 90, 40, 100)); // 3.5" 机械盘（放在 Z=0 侧的硬盘位，避开尾部电源仓）
  }
  return g;
}

function buildPSU(p) {
  const g = new THREE.Group();
  const len = 140 + Math.round(p.w / 200) * 12;
  const y = 45;                       // 85mm 高 → 2.5…87.5，不再沉到机箱底板以下
  const zR = L.caseIn.d - 6;          // 电源接口朝向尾部（Z=444）
  g.add(box(150, 85, len, M.steelDark, 95, y, zR - len / 2));
  g.add(box(60, 2, 40, M.emissive(0xffd166, 0.9), 95, 84, zR - 40)); // 标签灯
  /* 侧脸（朝 +X，正对电源仓观察窗）：写实铭牌 + 一列模组接口。
     铭牌用 pc53 正交生成图（AX1200i 帆船 logo + 规格表 + 四角螺丝，铭铭验收），
     替换旧的文字贴花。程序化版直接挂；GLB 版由 postGlbDecal 在白模加载后补挂
     ——attachGLB 会把程序化子件整组 visible=false，直接挂会被一起藏掉。 */
  const addLabel = () => {
    /* 铭牌贴图是 AX1200i（海盗船帆船logo）——只挂海盗船电源，其它品牌用程序化标签灯，
       免得振华/海韵的电源印着海盗船的标（张冠李戴比素面更假）。 */
    if (M.__psuLabel && p.brand === '海盗船') g.add(texPlane(150, 75, M.__psuLabel, 170.8, y + 2, zR - len / 2,
      [0, Math.PI / 2, 0], { metal: 0.3, rough: 0.55 }));
  };
  addLabel();
  g.userData.postGlbDecal = addLabel;
  for (let i = 0; i < 4; i++) g.add(box(0.8, 9, 15, M.black, 170.5, y - 20, zR - 34 - i * 19)); // 模组接口
  g.userData.anchor = [95, y, zR - len / 2];
  g.userData.fitBox = { x: 150, y: 85, z: len };
  return g;
}

/* ---------------- 引擎核心 ---------------- */
let renderer, scene, camera, controls, composer, bloom, container;
let doorOpen = false, ready = false;
/* 玻璃侧盖铰链在哪条棱：true = Z=D-10 一侧（尾部，有 I/O 和显卡挡板那端），
 * false = Z=10 一侧（进风风扇那端）。换边只改这一行，转轴位置和摆角符号会自动跟着算。 */
const DOOR_HINGE_FRONT = true;
const DOOR_SWING = 1.76;   // 开启角约 101°，过了垂直一点，不会怼到前面板
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
  renderer.shadowMap.enabled = true;                  // 真实投影：机箱要在台面上留影
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  el.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f16);
  camera = new THREE.PerspectiveCamera(42, 1, 1, 6000);
  camera.position.set(760, 560, 980);
  scene.add(camera);            // 背景板挂在相机上，相机必须在场景图里才会被渲染
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(100, 240, 230); controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxDistance = 1800; controls.minDistance = 120;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0x99aacc, 0x334455, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(600, 800, 500); scene.add(key);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 1.2;
  {
    const sc = key.shadow.camera;
    sc.left = -900; sc.right = 900; sc.top = 900; sc.bottom = -900;
    sc.near = 200; sc.far = 3200; sc.updateProjectionMatrix();
  }
  const fill = new THREE.DirectionalLight(0x88aaee, 0.9); fill.position.set(-400, 200, -300); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.7); rim.position.set(-200, 300, 800); scene.add(rim);
  scene.add(new THREE.AmbientLight(0x445566, 0.8));
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.6, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  initMaterials();
  resize();
  new ResizeObserver(resize).observe(el);
  bindPointer();
  loadBackdrop();
  ready = true;
  requestAnimationFrame(loop);
}

function resize() {
  if (!ready) return;
  const w = container.clientWidth, h = container.clientHeight;
  renderer.setSize(w, h); composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  layoutBackdrop();
}

/* ---- 背景板（PC 店铺工作台照片） ----
 * 不用 scene.background：那是拉伸铺满，面板宽高比和照片不一致时会把人压扁。
 * 改成挂在相机上的一块板，按 cover 规则算 UV 裁剪，随视口变化实时重算。
 * 图片加载失败（比如单文件版没有外部资源）就安静退回深色背景。 */
let backdrop = null, backdropTex = null;
function layoutBackdrop() {
  if (!backdrop || !backdropTex || !backdropTex.image) return;
  const d = 2400;
  const h = 2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const w = h * camera.aspect;
  backdrop.scale.set(w, h, 1);
  backdrop.position.set(0, 0, -d);
  const ia = backdropTex.image.width / backdropTex.image.height;
  const va = w / h;
  if (va > ia) { const s = ia / va; backdropTex.repeat.set(1, s); backdropTex.offset.set(0, (1 - s) / 2); }
  else { const s = va / ia; backdropTex.repeat.set(s, 1); backdropTex.offset.set((1 - s) / 2, 0); }
}
function texShadowBlob() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(0.5, 'rgba(0,0,0,0.24)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/* ---- 3D 工作台 ----
 * 照片当背景只能"看起来像有张桌子"，桌子不会随视角变化、也不会接住投影，
 * 所以机箱永远像浮在贴图前面。这里铺一张真的台面：有厚度、吃光、接影。 */
function texWoodBench() {
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#d9c49b'; g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 2400; i++) {          // 木纹
    const y = Math.random() * 1024;
    const a = 0.03 + Math.random() * 0.07;
    g.strokeStyle = 'rgba(150,118,80,' + a.toFixed(3) + ')';
    g.lineWidth = 0.6 + Math.random() * 1.8;
    g.beginPath(); g.moveTo(0, y);
    g.bezierCurveTo(340, y + (Math.random() - .5) * 10, 700, y + (Math.random() - .5) * 10, 1024, y);
    g.stroke();
  }
  for (let i = 0; i <= 4; i++) {            // 拼板缝
    g.fillStyle = 'rgba(96,74,48,0.30)';
    g.fillRect(0, i * 256 - 1.5, 1024, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3.2, 2.4);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function buildBench() {
  const W = 2800, D = 2100, TH = 64;
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(W, TH, D),
    /* color 会乘到贴图上：贴图本身偏亮，再被三盏灯 + IBL 一照就过曝，
       压到中调木色才像实木台面 */
    new THREE.MeshStandardMaterial({ map: texWoodBench(), color: 0x9a8768, roughness: 0.72, metalness: 0.0 })
  );
  top.position.set(105, -3 - TH / 2, 225);   // 台面正好在机箱底面 y=-3
  top.receiveShadow = true;
  scene.add(top);
  benchTop = top;
  return top;
}
function loadBackdrop() {
  /* 台面是几何体，和背景照片是两件事：照片没加载到也不该让机箱浮在半空。
     以前 buildBench() 写在 loader 的成功回调里，Pages 上图片路径不匹配时
     桌子、接触阴影、泛光/环境参数会一起丢掉——线上"背景和桌子都不见了"就是这个。 */
  buildBench();
  if (/[?&]nobg/.test(location.search)) return;
  const apply = tex => {
    tex.colorSpace = THREE.SRGBColorSpace;
    backdropTex = tex;
    backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: tex, depthWrite: false, depthTest: false, toneMapped: true,
    }));
    backdrop.renderOrder = -10;
    backdrop.frustumCulled = false;
    camera.add(backdrop);                 // 挂在相机上 = 永远铺满视野
    layoutBackdrop();
    /* 明亮背景下把泛光阈值抬到 1.35：只让自发光部件（灯条/风扇环）发亮。
       阈值原来设 1.05，结果被灯光打亮的木台面也会越线，整屏糊成一片白。 */
    if (bloom) { bloom.threshold = 1.35; bloom.strength = 0.3; }
    scene.environmentIntensity = 0.75;
  };
  /* 两条候选：本地从 /src 打开时是 ../assets；Pages 把 docs/ 当站点根，是 assets。
     第一个 404 就自动换下一个，不用改构建产物里的字符串。 */
  const cands = ['../assets/bg/store.png', 'assets/bg/store.png'];
  let i = 0;
  const next = () => {
    if (i >= cands.length) return;        // 全失败 → 保持深色背景，但台面还在
    new THREE.TextureLoader().load(cands[i++], apply, undefined, next);
  };
  next();
}

/* ---- 装配 diff ---- */
function keyOf(cat, idx, id) { return cat + ':' + idx + ':' + id; }
let build_ref = {}, analyze_ref = { pcie: [], gpuAssign: [] };

function sync(build, a) {
  if (!ready) return;
  hidePickPop();          // 装配变化后旧的确认框已经指向不存在的部件
  build_ref = build; analyze_ref = a;
  const want = new Map();
  if (build.case) want.set(keyOf('case', 0, build.case), { cat: 'case', idx: 0, id: build.case });
  if (build.mobo) want.set(keyOf('mobo', 0, build.mobo), { cat: 'mobo', idx: 0, id: build.mobo });
  if (build.cpu) want.set(keyOf('cpu', 0, build.cpu), { cat: 'cpu', idx: 0, id: build.cpu });
  if (build.cooler) want.set(keyOf('cooler', 0, build.cooler), { cat: 'cooler', idx: 0, id: build.cooler });
  if (build.psu) want.set(keyOf('psu', 0, build.psu), { cat: 'psu', idx: 0, id: build.psu });
  build.ram.forEach((id, i) => { if (id) want.set(keyOf('ram', i, id), { cat: 'ram', idx: i, id }); });
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
    /* 投影：除玻璃侧盖（透明件投出来是一块黑板）外，其余网格都投/接影 */
    grp.traverse(o => {
      if (!o.isMesh) return;
      o.receiveShadow = true;
      if (!isDoorNode(o) && !o.userData.noShadow) o.castShadow = true;
    });
    installed.set(k, { group: grp, cat: v.cat, idx: v.idx, id: v.id });
    playIn(grp, v.cat);
    attachGLB(grp, v.cat, v.id); // 有登记 GLB 则异步替换程序化几何（失败静默回退）
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
  if (g.userData.droppedFree) {
    /* 自由拖拽落桌：不播「飞向货架」动画也不销毁——setSpares 会在同一帧内
       用自由位姿重建这只备用件，部件视觉上原地留在桌面。 */
    scene.remove(g); disposeGroup(g); rebuildPickables(); return;
  }
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

/* 走线规划（纯函数，不碰场景）。
 *
 * 机箱里唯一一条「从电源通往上方」的无障碍通道在**前侧**：电源仓罩只盖 z≥140，
 * 罩子前面（z<140）是空的；显卡从 z=141 才起步，所以 z≈126 这条竖井从前到顶
 * 全程不会碰到任何东西。旧走线是几个拍脑袋的数字，从仓罩里穿出来、横着穿过显卡，
 * 一开机就能看见线从散热罩里钻出来。
 *
 * 统一套路：电源前面板出来 → 贴着仓罩底面往前走到 z≈128 → 从罩前缘外侧竖起来
 * → 沿目标高度横着走过去 → 最后一小段横插进插座。
 */
function planCables(ctx) {
  const { psuFrontZ, hasCpu, gpus, gpusFront } = ctx;
  const PF = psuFrontZ + 4;            // 刚出电源前面板
  /* 竖井的 x 必须按**实际卡高**算，不能写死：
   * 卡高（金手指→卡顶）从统一的 112 改成按型号取值后，4090 顶到 x=141，
   * 原来写死的 124/126/130 全都落进卡体里。 */
  const cardTop = gpus.length ? Math.max(...gpus.map(p => p[0])) : 124;  // pa[0] = 卡顶 + 4
  const riser0 = Math.max(126, cardTop + 6);       // 显卡供电竖井（卡外侧）
  /* 短卡（前缘 z>120）时 z=126 这条前侧通道是空的，走 x≈26 最贴边；
     长卡把通道占满，三条竖井只能依次排到卡外侧：GPU / 24pin / EPS。 */
  const longCard = gpusFront != null && gpusFront < 120;
  const CX = longCard ? riser0 + 26 : 26;          // 24pin 竖井
  const EX = longCard ? riser0 + 38 : CX + 4;      // EPS 竖井（与 24pin 错开 12mm）
  const R = [];
  // 24pin：竖井 → 贴主板前沿 → 插进插座（插座 z 196…220、y 237…282）
  const t24 = longCard
    ? [[CX - 20, 257, 158], [60, 259, 186], [8, 260, 204]]
    : [[14, 257, 160], [8, 260, 204]];
  R.push({
    label: '24pin', r: 5, color: 0x1a1d24,
    pts: [[34, 54, PF], [30, 62, 172], [CX, 72, 130], [CX, 210, 126], [CX, 250, 132], ...t24],
  });
  /* EPS（CPU 供电）：竖井上来后贴着主板顶沿内侧（y=424）往尾部走 ——
   * 这条高度正好在 VRM 散热片（y≤415）上方、一体水冷冷排（y≥432）下方，
   * 也在风冷塔体（x≥14）的**左侧**，所以水冷/风冷两套配置都不会撞。
   * 长卡时竖井在卡外侧，会穿过顶部风扇（x 45…165、y 342…462），
   * 所以先升到 y=250（卡上方）就横移到贴板位置，再从那里往上走。 */
  if (hasCpu) {
    const headE = longCard
      ? [[48, 62, PF], [46, 70, 180], [EX, 74, 134], [EX, 120, 126], [EX, 250, 126],
        [EX - 90, 264, 126], [14, 300, 126], [10, 390, 126], [10, 424, 126]]
      : [[48, 62, PF], [46, 70, 180], [EX, 74, 134], [EX, 120, 126], [EX, 424, 126],
        [20, 424, 160], [10, 424, 230]];
    R.push({
      label: 'EPS', r: 4, color: 0x141821,
      pts: [...headE, [9, 424, 372], [9, 414, 396], [7, 406, 414]],
    });
  }
  // 显卡供电：在卡外侧升起 → 横着插进卡边缘的供电口
  gpus.forEach((pa, i) => {
    const xr = riser0 + i * 12;
    R.push({
      label: 'gpu', r: 4, color: 0x2a2418,
      pts: [[68 + i * 16, 70, PF], [96 + i * 16, 72, 176], [xr - 8, 74, 148],
        [xr, 80, 124], [xr, pa[1] + 26, 122],
        [xr, pa[1] + 16, 146], [xr, pa[1] + 6, pa[2] - 14], [pa[0] + 3, pa[1], pa[2]]],
    });
  });
  return R;
}

function rebuildCables() {
  cableMeshes.forEach(c => scene.remove(c)); cableMeshes = [];
  const has = c => [...installed.values()].some(v => v.cat === c);
  if (!has('psu') || !has('mobo')) return;
  const psuEnt = [...installed.values()].find(v => v.cat === 'psu');
  const aa = psuEnt.group.userData.anchor || [95, 45, 328];
  const fb = psuEnt.group.userData.fitBox || { x: 150, y: 85, z: 212 };
  const gpus = [...installed.values()].filter(v => v.cat === 'gpu')
    .map(v => v.group.userData.powerAt).filter(Boolean);
  const fronts = [...installed.values()].filter(v => v.cat === 'gpu')
    .map(v => v.group.userData.frontZ).filter(n => typeof n === 'number');
  planCables({
    psuFrontZ: aa[2] - fb.z / 2, hasCpu: has('cpu'), gpus,
    gpusFront: fronts.length ? Math.min(...fronts) : null,
  })
    .forEach(rt => {
      const c = makeCable(rt.pts, rt.r, rt.color);
      c.userData.label = rt.label;
      cableMeshes.push(c);
    });
  if (has('cooler') && P.byId(build_ref.cooler).type === 'aio') {
    const co = buildCooler(P.byId(build_ref.cooler));
    (co.userData.tubes || []).forEach(tp => {
      /* 水管是装散热器时就接好的，不是「开机才插」的线：
         always=true → 不受 phase 影响，任何状态都画满整根。 */
      const t = makeCable(tp, 7, 0x2c3a52);
      t.userData.label = 'aio'; t.userData.always = true; t.userData.plugged = true;
      cableMeshes.push(t);
    });
    disposeGroup(co);
  }
  cableMeshes.forEach(c => {
    c.userData.plugged = c.userData.always || phase !== 'idle';
    scene.add(c); applyPlug(c);
  });
}
function applyPlug(c) {
  const total = c.userData.total;
  const on = c.userData.always ? true : c.userData.plugged;
  c.geometry.setDrawRange(0, on ? total : 0);
}

/* ---- 开机/遥测 ---- */
function setPhase(p) {
  phase = p;
  if (p === 'cables') {
    const wires = cableMeshes.filter(c => !c.userData.always);   // 水管不参与插线动画
    wires.forEach((c, i) => {
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
  if (p === 'idle') {
    fans.forEach(f => f.target = 0);
    cableMeshes.forEach(c => { if (c.userData.always) return; c.userData.plugged = false; applyPlug(c); });
  }
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
  /* 容器被隐藏（切回 2D → display:none，clientWidth 归 0）时跳过整帧：
     bloom 后处理 + 2048² PCFSoft 阴影每帧全量重绘，用户看不见却一直在烧
     GPU/CPU。这里保留 rAF 心跳（极廉价），一旦切回 3D 容器有尺寸即自动恢复。 */
  if (!container || container.clientWidth === 0 || container.clientHeight === 0) { loop.last = ts; return; }
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
  /* 自由拖拽落桌/回弹补间 */
  if (deskPlace) {
    const dp = deskPlace; dp.t += dt;
    const k = Math.min(1, dp.t / dp.dur), e = easeOut(k);
    dp.obj.position.lerpVectors(dp.fromP, dp.toP, e);
    dp.obj.quaternion.slerpQuaternions(dp.fromR, dp.toR, e);
    if (k >= 1) deskPlace = null;
  }
  controls.update();
  composer.render();
}

/* ---- 交互：hover 高亮 / 点击拆除 / 拖出机箱拆除 ----
 * 手势划分（三者互不抢占）：
 *   画布内任意位置按住拖动 → 一律交给 OrbitControls 转视角，配件也不例外
 *   按着配件拖到画布外   → 才算「拆件」：配件抬起跟随指针，松手移除
 *   单击配件（位移 ≤5px）→ 弹确认框移除
 */
let down = null, dragging = false;
const PICK_LIFT = { x: 45, y: 25, z: 0 };   // 抓起示意：朝侧透玻璃 + 向上
const _vRight = { x: 0, y: 0, z: 0 }, _vUp = { x: 0, y: 0, z: 0 };

/* ---- 自由拖拽（铭铭 2026-10-18 玩法）：按住配件在画布内拖 → 弹出脱离装配位，
 * 跟随光标在相机焦平面移动，滚轮=绕相机竖轴旋转（Shift+滚轮=绕相机横轴侧翻），
 * 松手：射线打到木台面 → 落桌（登记自由位姿，数据层同步拆成备用件）；
 * 打不到台面 → 弹回装配位。纯视觉玩法：模拟数值仍由 2D/数据层决定。 ---- */
let benchTop = null;
let freeDrag = null;                 // {obj, uid?, orig, origRot, grabOff, cat, id}
const freePose = new Map();          // uid -> {p:[x,y,z], r:[x,y,z]} 桌面自由位姿（不被货架重排）
let pendingFree = null;              // 刚甩到桌面的 {cat,id,pose}，等 setSpares 生成 uid 后绑定位姿
let deskPlace = null;                // 落桌/回弹补间 {obj, t, dur, fromP, toP, fromR, toR, onEnd}
const _rayPlane = new THREE.Plane(), _hitPt = new THREE.Vector3();
const _fdDir = new THREE.Vector3(), _fdUp = new THREE.Vector3(), _fdRight = new THREE.Vector3();

/* 开始自由拖拽：以抓取点建一个垂直相机视线的平面，之后光标射线与该平面的交点 = 物体新家。
   抓取瞬间沿相机 up 抬 25mm + 放大 5% = 「弹出脱离装配位」的手感。 */
function startFreeDrag() {
  raycaster.setFromCamera(ptr, camera);
  const h = raycaster.intersectObject(down.obj, true)[0];
  const anchor = h ? h.point.clone()
    : new THREE.Box3().setFromObject(down.obj).getCenter(new THREE.Vector3());
  camera.getWorldDirection(_fdDir);
  _rayPlane.setFromNormalAndCoplanarPoint(_fdDir, anchor);
  const o = down.obj;
  freeDrag = {
    obj: o, uid: down.spare || null, orig: down.orig.clone(), origRot: o.rotation.clone(),
    grabOff: anchor.sub(o.position.clone()),
    pick: o.userData.pick ? { cat: o.userData.pick.cat, id: o.userData.pick.id, idx: o.userData.pick.idx } : null,
  };
  controls.enabled = false; controls.enableZoom = false;
  renderer.domElement.style.cursor = 'grabbing';
  o.scale.setScalar(1.05);
}
function followFree() {
  raycaster.setFromCamera(ptr, camera);
  if (!raycaster.ray.intersectPlane(_rayPlane, _hitPt)) return;
  _fdUp.set(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(25);
  freeDrag.obj.position.copy(_hitPt).sub(freeDrag.grabOff).add(_fdUp);
}
/* 松手：射线打中木台面 → 落桌；打不到 → 补间弹回装配位 */
function endFreeDrag() {
  const fd = freeDrag; freeDrag = null;
  controls.enabled = true; controls.enableZoom = true; renderer.domElement.style.cursor = 'default';
  const obj = fd.obj;
  obj.scale.setScalar(1);
  raycaster.setFromCamera(ptr, camera);
  const onDesk = benchTop && raycaster.intersectObject(benchTop, false)[0];
  if (onDesk) {
    /* 落桌：以射线打中的台面点为落点（指哪放哪），再按当前旋转把包围盒底面坐实到台面 y=-3 */
    obj.position.set(onDesk.point.x, obj.position.y, onDesk.point.z);
    obj.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(obj);
    const pose = { p: [obj.position.x, obj.position.y + (-3 - bb.min.y), obj.position.z],
      r: [obj.rotation.x, obj.rotation.y, obj.rotation.z] };
    if (fd.uid) {
      freePose.set(fd.uid, pose);                       // 台面备用件落桌：纯视觉挪位，不动数据
      deskPlace = { obj, t: 0, dur: 0.16, fromP: obj.position.clone(), toP: new THREE.Vector3(...pose.p),
        fromR: obj.quaternion.clone(), toR: obj.quaternion.clone() };
    } else if (fd.pick && removeCb) {
      obj.userData.droppedFree = true;                  // 装机件落桌：数据层拆成备用件，
      pendingFree = { cat: fd.pick.cat, id: fd.pick.id, pose };  // setSpares 用自由位姿原地重建
      removeCb(fd.pick.cat, fd.pick.idx);
    }
  } else {
    deskPlace = { obj, t: 0, dur: 0.35, fromP: obj.position.clone(), toP: fd.orig,
      fromR: obj.quaternion.clone(), toR: new THREE.Quaternion().setFromEuler(fd.origRot) };
  }
}

/* 指针是否已离开机箱画布（留 6px 容差，避免贴边抖动误判） */
function outsideCanvas(e) {
  const r = container.getBoundingClientRect(), pad = 6;
  return e.clientX < r.left + pad || e.clientX > r.right - pad ||
    e.clientY < r.top + pad || e.clientY > r.bottom - pad;
}

function bindPointer() {
  const el = renderer.domElement;
  el.addEventListener('pointermove', e => {
    const r = el.getBoundingClientRect();
    ptr.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);

    if (down && down.obj && !down.onDoor && !dragging && !freeDrag &&
      Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) {
      /* 画布内拖配件 → 自由拖拽（弹出/跟随/落桌）；拖出画布 → 老规矩拆件。
         画布内的拖动全部让给 OrbitControls——以前只要位移超阈值就禁用控制器，
         导致每次拖动只转十来像素就停住。 */
      if (outsideCanvas(e)) { dragging = true; controls.enabled = false; el.style.cursor = 'grabbing'; }
      else startFreeDrag();
    }
    if (freeDrag) followFree();
    else if (dragging && down.obj) {
      /* 跟随指针（屏幕空间近似）：把像素位移投到相机的 right/up 轴上，不再按事件次数累加 */
      const m = camera.matrixWorld.elements;
      _vRight.x = m[0]; _vRight.y = m[1]; _vRight.z = m[2];
      _vUp.x = m[4]; _vUp.y = m[5]; _vUp.z = m[6];
      const dx = (e.clientX - down.x) * 0.5, dy = (e.clientY - down.y) * 0.5; // 0.5 mm/px
      const o = down.obj.position;
      o.set(
        down.orig.x + _vRight.x * dx - _vUp.x * dy + PICK_LIFT.x,
        down.orig.y + _vRight.y * dx - _vUp.y * dy + PICK_LIFT.y,
        down.orig.z + _vRight.z * dx - _vUp.z * dy + PICK_LIFT.z
      );
    }
    // hover —— 射线拾取（pickThroughGlass + spareHitUid 各一次全场景递归求交）
    // 节流到 ~16/s：高刷鼠标每秒能触发上百次 pointermove，逐次求交纯属浪费，
    // 高亮晚 60ms 出现人眼无感。ptr 与拖拽跟随仍逐事件更新，不影响手感。
    const now = performance.now();
    if (now - (bindPointer._hoverAt || 0) < 60) return;
    bindPointer._hoverAt = now;
    raycaster.setFromCamera(ptr, camera);
    const hit = pickThroughGlass();
    const root = hit ? rootPick(hit.object) : null;
    if (hoverObj && hoverObj !== root) setEmissiveBoost(hoverObj, false);
    hoverObj = root;
    if (hoverObj) setEmissiveBoost(hoverObj, true);
    if (!dragging && !freeDrag) el.style.cursor = hoverObj ? 'pointer' : 'default';
    /* 台面备用件：悬停出标签，点一下装回机箱，点 × 才彻底删除 */
    if (!dragging && sparePickList.length) {
      const su = spareHitUid();
      if (su) { showSpareTip(su, e); if (!hoverObj) el.style.cursor = 'pointer'; }
      else hideSpareTip();
    }
  });
  el.addEventListener('pointerdown', e => {
    hidePickPop();                 // 在别处按下去 → 收起上一次的浮窗
    raycaster.setFromCamera(ptr, camera);
    const hit = pickThroughGlass();
    const hitObj = hit ? hit.object : null;
    const obj = hitObj ? rootPick(hitObj) : null;
    const spareUid = spareHitUid();
    down = {
      x: e.clientX, y: e.clientY,
      obj: obj || (spareUid && spareObjs.get(spareUid) ? spareObjs.get(spareUid).group : null),  // 台面备用件也能抓起来玩
      onDoor: hitObj ? isDoorNode(hitObj) : false,   // 命中的是玻璃侧盖 → 点击=开关门
      spare: spareUid,                               // 命中的是台面备用件 → 点击=装回机箱
      orig: null
    };
    down.orig = down.obj ? down.obj.position.clone() : null;
    dragging = false;
    try { el.setPointerCapture(e.pointerId); } catch (err) { }
  });
  el.addEventListener('pointerup', e => {
    controls.enabled = true;
    el.style.cursor = 'default';
    if (!down) return;
    if (freeDrag) { endFreeDrag(); down = null; dragging = false; return; }
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (!dragging && moved <= 6 && down.spare) {
      if (spareInstallCb) spareInstallCb(down.spare);   // 点台面上的零件 → 装回去
      down = null; return;
    }
    if (dragging) {
      if (down.obj && removeCb && outsideCanvas(e)) {
        removeCb(down.obj.userData.pick.cat, down.obj.userData.pick.idx); // 拖出机箱 → 拆除
      } else {
        sync(build_ref, analyze_ref); // 又拖回来了 → 弹回原位
      }
    } else if (moved <= 5 && down.obj) {
      /* 只有「点一下没怎么动」才算单击。
         不然在配件上拖动转视角之后松手，会莫名弹确认框。 */
      if (down.onDoor) {
        toggleDoor();                       // 玻璃侧盖：单击开合
      } else if (removeCb) {
        const p = down.obj.userData.pick;
        const nm = P.byId(p.id) ? DN(P.byId(p.id).name) : (p.cat === 'case' ? TM('机箱','Case') : p.cat);
        const target = down.obj;
        showPickPop({
          obj: target, danger: true, okLabel: TM('移除','Remove'),
          text: p.cat === 'case'
            ? TM('移除整只 <b>','Remove the whole <b>') + esc(nm) + '</b>?'
            : TM('从机箱移除 <b>','Remove <b>') + esc(nm) + '</b>?',
          onOk: () => removeCb(p.cat, p.idx),
        });
      }
    }
    down = null; dragging = false;
  });
  /* 拖拽中滚轮 = 旋转部件（铭铭玩法）：默认绕相机竖轴（世界 Y）转，Shift+滚轮绕相机横轴侧翻。
     不 stopPropagation → OrbitControls 自己的 wheel 也照旧缩放？不行，缩放会和旋转抢。
     所以捕获阶段拦截：拖拽中滚轮只转部件，不缩放。 */
  el.addEventListener('wheel', e => {
    if (!freeDrag) return;
    e.preventDefault(); e.stopPropagation();
    const k = e.deltaY * 0.0035;
    if (e.shiftKey) {
      _fdRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
      freeDrag.obj.rotateOnWorldAxis(_fdRight, k);
    } else {
      freeDrag.obj.rotateOnWorldAxis(_fdUp.set(0, 1, 0), k);
    }
  }, { capture: true, passive: false });
  /* 指针被系统取消（切窗口、触控中断、capture 丢失）时 pointerup 不会触发。
     不兜底的话 controls.enabled 会永久停在 false——3D 旋转彻底失灵。 */
  el.addEventListener('pointercancel', () => {
    if (freeDrag) { const fd = freeDrag; freeDrag = null; controls.enabled = true; controls.enableZoom = true;
      fd.obj.scale.setScalar(1);
      deskPlace = { obj: fd.obj, t: 0, dur: 0.35, fromP: fd.obj.position.clone(), toP: fd.orig,
        fromR: fd.obj.quaternion.clone(), toR: new THREE.Quaternion().setFromEuler(fd.origRot) }; }
    if (dragging && down && down.obj) sync(build_ref, analyze_ref);
    down = null; dragging = false; controls.enabled = true; el.style.cursor = 'default';
  });
}
function rootPick(o) { while (o) { if (o.userData && o.userData.pick) return o; o = o.parent; } return null; }
/* 命中的网格是否属于玻璃侧盖（门组带 userData.isDoor 标记） */
function isDoorNode(o) { while (o) { if (o.userData && o.userData.isDoor) return true; o = o.parent; } return false; }
function isShroudGlassNode(o) { while (o) { if (o.userData && o.userData.isShroudGlass) return true; o = o.parent; } return false; }
/* 电源仓观察窗是透明件。射线打上去不能停在玻璃上，否则永远只能选中整只机箱；
   穿过玻璃后优先命中真实配件（电源），打到机箱内壁则当没点到。 */
function pickThroughGlass() {
  const hits = raycaster.intersectObjects(pickables, true);
  if (!hits.length) return null;
  if (!isShroudGlassNode(hits[0].object)) return hits[0];
  for (let i = 1; i < hits.length; i++) {
    const r = rootPick(hits[i].object);
    if (r && r.userData.pick && r.userData.pick.cat !== 'case') return hits[i];
  }
  return null;
}
function setEmissiveBoost(root, on) {
  /* 机箱是结构性外壳，一悬停就把整台机箱点成蓝色（占用视野一大半），
     而且它本来就不是"点一下拆一个"的配件——所以整只机箱不做高亮。 */
  if (root && root.userData && root.userData.pick && root.userData.pick.cat === 'case') return;
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
  /* 转向跟着铰链侧走：+X 是侧透那一侧，门体从铰链伸向 -Z（前铰链）或 +Z（后铰链），
     所以前铰链要负向转、后铰链要正向转，才是向外掀而不是往机箱里怼。 */
  const from = door.rotation.y;
  const to = doorOpen ? (DOOR_HINGE_FRONT ? -DOOR_SWING : DOOR_SWING) : 0;
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
  camera.position.set(760, 560, 980); controls.target.set(100, 240, 230);
}

/* ---- 台面备用件 ----
 * 从机箱拆下来的零件不销毁，侧躺摆到台面**侧面**（+X，玻璃那侧）待用；
 * 悬停浮出「名称 + 规格 + 点击装回」，点 × 才真正删除（回调到 app.js 的 spares 列表）。 */
let spareObjs = new Map(), sparePickList = [], hoverSpare = null;
let spareDelCb = null, spareInstallCb = null, spareTipEl = null;

/* 备用件的一句话规格：摆在台面上时能直接看出这是哪一档，不用回头翻侧栏 */
function specText(p) {
  if (!p) return '';
  switch (p.cat) {
    case 'cpu':
      return (p.e ? p.p + 'P+' + p.e + 'E' : p.p + 'P') + '/' + p.thr + 'T · ' + p.socket + ' · PL2 ' + p.pl2 + 'W';
    case 'gpu':
      return p.vram + 'GB · ' + p.len + 'mm · ' + p.thick + TM(' 槽',' slots') + ' · ' + p.tdp + 'W';
    case 'mobo':
      return p.form + ' · ' + p.socket + ' · ' + p.memSlots + '×DIMM · PCIe×' + p.slots.length;
    case 'ram':
      return 'DDR' + p.gen + ' ' + p.size + 'G · ' + p.mt + 'MT/s';
    case 'ssd':
      return (p.type === 'nvme' ? 'NVMe Gen' + p.gen : 'SATA') + ' · ' + p.read + 'MB/s · ' + p.tdp + 'W';
    case 'psu':
      return p.w + 'W · ' + p.conn8 + '×8pin' + (p.conn16pin ? ' + ' + p.conn16pin + '×16pin' : '');
    case 'cooler':
      return (p.type === 'aio' ? TM('一体水冷','AIO liquid') : TM('风冷','Air')) + TM(' · 解热 ',' · cools ') + p.cap + 'W';
    case 'case':
      return p.formMax + TM(' · 显卡≤',' · GPU ≤') + p.gpuMaxLen + 'mm · ' + p.fans + TM(' 风扇',' fans');
  }
  return '';
}
function spareTip() {
  if (spareTipEl) return spareTipEl;
  const d = document.createElement('div');
  d.className = 'spareTip';
  d.innerHTML = '<div class="tx"><span class="nm"></span><span class="sp"><b></b><em>' + TM('点击装回','click to reinstall') + '</em></span></div>' +
    '<button class="x" title="' + TM('彻底删除','Delete') + '">×</button>';
  d.style.display = 'none';
  container.appendChild(d);
  d.querySelector('.x').addEventListener('click', ev => {
    ev.stopPropagation();
    if (hoverSpare && spareDelCb) spareDelCb(hoverSpare.uid);
    d.style.display = 'none'; hoverSpare = null;
  });
  spareTipEl = d;
  return d;
}
function showSpareTip(uid, e) {
  const o = spareObjs.get(uid); if (!o) return;
  hoverSpare = o;
  const tip = spareTip();
  const part = P.byId(o.id);
  tip.querySelector('.nm').textContent = (part ? DN(part.name) : o.id);
  tip.querySelector('.sp b').textContent = specText(part);
  o.group.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(o.group);
  const c = b.getCenter(new THREE.Vector3()).project(camera);
  const r = container.getBoundingClientRect();
  tip.style.display = 'flex';
  tip.style.left = ((c.x * 0.5 + 0.5) * r.width) + 'px';
  tip.style.top = ((-c.y * 0.5 + 0.5) * r.height) + 'px';
}
function hideSpareTip() {
  hoverSpare = null;
  if (spareTipEl) spareTipEl.style.display = 'none';
}
/* ---- 就地操作浮窗 ----
 * 替代原生 confirm/alert：浏览器弹的那个白色方块会跑到窗口最上方，
 * 和「点哪拆哪」的空间关系完全断开。浮窗由 app.js 统一实现（2D/3D 共用），
 * 这里只负责把物体包围盒中心投到**视口坐标**再交出去。
 */
function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function anchorScreen(obj) {
  const r = container.getBoundingClientRect();
  if (!obj) return { x: r.left + r.width / 2, y: r.top + r.height * 0.55 };
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj);
  const c = b.getCenter(new THREE.Vector3()).project(camera);
  return {
    x: r.left + (c.x * 0.5 + 0.5) * r.width,
    y: r.top + (-c.y * 0.5 + 0.5) * r.height,
    inBox: { left: r.left, top: r.top, width: r.width, height: r.height },
  };
}
function showPickPop(opt) {
  const a = anchorScreen(opt.obj);
  window.showUiPop({ x: a.x, y: a.y - 10, bound: a.inBox, text: opt.text, okLabel: opt.okLabel, danger: opt.danger, cancel: opt.cancel, onOk: opt.onOk });
}
function hidePickPop() { if (window.hideUiPop) window.hideUiPop(); }
function toast3d(text) {
  const a = anchorScreen(null);
  window.showUiPop({ x: a.x, y: a.y, text, okLabel: TM('知道了','Got it'), cancel: false });
}
/* 光标下的备用件 uid（pointerdown / pointermove 共用） */
function spareHitUid() {
  if (!sparePickList.length) return null;
  raycaster.setFromCamera(ptr, camera);
  const h = raycaster.intersectObjects(sparePickList, true)[0];
  let p = h ? h.object : null;
  while (p && !(p.userData && p.userData.__spareUid)) p = p.parent;
  return p ? p.userData.__spareUid : null;
}
function setSpares(list) {
  if (!ready) return;
  list = list || [];
  const want = new Set(list.map(s => s.uid));
  for (const [uid, o] of [...spareObjs]) {
    if (!want.has(uid)) { scene.remove(o.group); disposeGroup(o.group); spareObjs.delete(uid); freePose.delete(uid); }
  }
  let n = 0;
  /* 台面排位用「货架式」紧凑摆放：沿 -Z 一件接一件排，间距按每件自己的进深算，
   * 不再用固定 320mm 间距 —— 内存/CPU 这种小件以前也占一格，看起来又散又空，
   * 件多了还会排出桌面。排到 z≈-760（台面近边）就换下一列。 */
  let curZ = 250, colX = 470;
  for (const s of list) {
    if (s.cat === 'case') continue;                 // 整只机箱不上台面
    if (!spareObjs.has(s.uid)) {
      const part = P.byId(s.id); if (!part) continue;
      const assign = s.cat === 'gpu'
        ? { slotPos: 1, slot: { pos: 1, frac: 1, lanes: 16, gen: 5, gbps: 55 }, thick: part.thick }
        : null;
      const grp = createPart({ cat: s.cat, id: s.id, idx: 0, assign });
      if (!grp) continue;
      grp.userData.__spareUid = s.uid;
      scene.add(grp);
      spareObjs.set(s.uid, { group: grp, cat: s.cat, id: s.id, uid: s.uid });
    }
    /* 排位：机箱**侧面**（+X，玻璃那侧）的台面上，从机箱中段往前往下排 */
    const o = spareObjs.get(s.uid); if (!o) continue;
    const g = o.group;
    /* 自由拖拽落桌的备用件：按用户摆放的位姿放，不参与货架排位（铭铭玩法）。
       装机件落桌时 pendingFree 带着位姿过来，在这里绑定到 app.js 新生成的 uid 上。 */
    if (pendingFree && !freePose.has(s.uid) && pendingFree.cat === s.cat && pendingFree.id === s.id) {
      freePose.set(s.uid, pendingFree.pose); pendingFree = null;
    }
    const fp = freePose.get(s.uid);
    if (fp) {
      g.rotation.set(fp.r[0], fp.r[1], fp.r[2]);
      g.position.set(fp.p[0], fp.p[1], fp.p[2]);
      g.updateMatrixWorld(true);
      const fb = new THREE.Box3().setFromObject(g);
      g.position.y += -3 - fb.min.y;                    // 底面贴台面
      g.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      n++; continue;
    }
    g.rotation.set(0, 0, -Math.PI / 2);             // 侧躺平放
    g.position.set(0, 0, 0);
    g.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(g);
    const c = b.getCenter(new THREE.Vector3());
    const footW = b.max.x - b.min.x, footD = b.max.z - b.min.z;
    if (curZ - footD < -760) { colX += Math.max(320, footW + 50); curZ = 250; }
    const tx = colX, tz = curZ - footD / 2;
    curZ -= footD + 26;                             // 下一件的起点
    g.position.x += tx - c.x;
    g.position.z += tz - c.z;
    g.position.y += -3 - b.min.y;                   // 底面贴台面
    g.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    n++;
  }
  sparePickList = [...spareObjs.values()].map(o => o.group);
  /* 装回机箱后那只零件已经从场景里移除，浮标要跟着收起来 */
  if (hoverSpare && !spareObjs.has(hoverSpare.uid)) hideSpareTip();
  if (!sparePickList.length) hideSpareTip();
}

window.STRATA_3D = { init, sync, setPhase, setTelemetry, toggleDoor, resetView, setSpares,
  /* 探针专用：把相机精确摆到 pos、看向 target（判断 GLB 朝向用，避免鼠标拖不准） */
  setCam: (pos, target) => { if (!ready) return; camera.position.set(pos[0], pos[1], pos[2]); controls.target.set(target[0], target[1], target[2]); controls.update(); },
  /* 探针专用：世界坐标 → canvas 像素坐标（拖拽探针按屏幕坐标下鼠标） */
  project: (x, y, z) => {
    if (!ready) return null;
    const v = new THREE.Vector3(x, y, z).project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height, visible: v.z < 1 };
  },
  firstFreeScreen: () => {
    for (const [uid, pose] of freePose) {
      const o = spareObjs.get(uid); if (!o) continue;
      const v = new THREE.Vector3(pose.p[0], pose.p[1] + 30, pose.p[2]).project(camera);
      const r = renderer.domElement.getBoundingClientRect();
      return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height, visible: v.z < 1 };
    }
    return null;
  },
  /* 探针专用：在部件包围盒里采样，返回一个「射线最前面就是它」的屏幕点。
     必须走 pickThroughGlass 真实拾取路径——只验 intersectObject(自己) 会骗人：
     那个点可能先打到机箱/散热，按下选中的根本不是它。 */
  partScreen: (cat, idx) => {
    if (!ready) return null;
    const v = [...installed.values()].find(x => x.cat === cat && x.idx === (idx == null ? 0 : idx));
    if (!v) return null;
    const bb = new THREE.Box3().setFromObject(v.group);
    const r = renderer.domElement.getBoundingClientRect();
    const fr = [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7],
      [0.3, 0.3], [0.7, 0.7], [0.3, 0.7], [0.7, 0.3]];
    for (const [a, c] of fr) {
      const w = new THREE.Vector3(bb.min.x + (bb.max.x - bb.min.x) * a,
        bb.min.y + (bb.max.y - bb.min.y) * c, (bb.min.z + bb.max.z) / 2);
      const n = w.project(camera);
      const sx = (n.x * 0.5 + 0.5) * r.width, sy = (-n.y * 0.5 + 0.5) * r.height;
      if (sx < 12 || sy < 12 || sx > r.width - 12 || sy > r.height - 12) continue;
      raycaster.setFromCamera(new THREE.Vector2(sx / r.width * 2 - 1, -(sy / r.height * 2 - 1)), camera);
      const hit = pickThroughGlass();
      if (hit && rootPick(hit.object) === v.group) return { x: sx, y: sy, hit: true };
    }
    return null;
  },
  /* 探针诊断：打印部件包围盒 + 各采样点的实际命中（定位"选不中"用） */
  dbgPick: (cat, idx) => {
    if (!ready) return { err: 'not-ready' };
    const v = [...installed.values()].find(x => x.cat === cat && x.idx === (idx == null ? 0 : idx));
    if (!v) return { err: 'not-installed', have: [...installed.values()].map(x => x.cat + '#' + x.idx) };
    const bb = new THREE.Box3().setFromObject(v.group);
    const r = renderer.domElement.getBoundingClientRect();
    const out = [];
    for (const [a, c] of [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7]]) {
      const w = new THREE.Vector3(bb.min.x + (bb.max.x - bb.min.x) * a,
        bb.min.y + (bb.max.y - bb.min.y) * c, (bb.min.z + bb.max.z) / 2);
      const n = w.clone().project(camera);
      const sx = (n.x * 0.5 + 0.5) * r.width, sy = (-n.y * 0.5 + 0.5) * r.height;
      raycaster.setFromCamera(new THREE.Vector2(sx / r.width * 2 - 1, -(sy / r.height * 2 - 1)), camera);
      const hits = raycaster.intersectObjects(pickables, true);
      const fr = hits[0] ? rootPick(hits[0].object) : null;
      out.push({ sx: Math.round(sx), sy: Math.round(sy), ndcZ: +n.z.toFixed(2),
        inCanvas: sx > 12 && sy > 12 && sx < r.width - 12 && sy < r.height - 12,
        first: fr && fr.userData.pick ? fr.userData.pick.cat + '#' + fr.userData.pick.idx : 'none',
        isSelf: fr === v.group, selfHit: !!raycaster.intersectObject(v.group, true)[0] });
    }
    return { bb: [bb.min.toArray().map(Math.round), bb.max.toArray().map(Math.round)],
      canvas: [Math.round(r.width), Math.round(r.height)], cam: camera.position.toArray().map(Math.round), samples: out };
  },
  /* 探针专用：扫描画布找射线打中木台面、且落在机箱 footprint 外（x>230/x<-20/z>470/z<-20）
     的屏幕点；找不到机箱外空地就退回任意桌面点并标记 outside=false（落机箱顶上也是合法摆放）。 */
  deskScreen: () => {
    if (!ready || !benchTop) return null;
    const r = renderer.domElement.getBoundingClientRect();
    let any = null;
    for (let fy = 0.45; fy < 0.97; fy += 0.05) for (let fx = 0.1; fx < 0.92; fx += 0.05) {
      raycaster.setFromCamera(new THREE.Vector2(fx * 2 - 1, -(fy * 2 - 1)), camera);
      const h = raycaster.intersectObject(benchTop, false)[0];
      if (!h) continue;
      const pt = { x: fx * r.width, y: fy * r.height, wx: Math.round(h.point.x), wz: Math.round(h.point.z) };
      if (!any) any = Object.assign(pt, { outside: false, visible: true });
      const out = h.point.x > 230 || h.point.x < -20 || h.point.z > 470 || h.point.z < -20;
      if (out) return Object.assign(pt, { outside: true, visible: true });
    }
    return any;
  },
  toast: toast3d, hidePickPop,
  onRemove: cb => removeCb = cb,
  onSpareDelete: cb => spareDelCb = cb,
  onSpareInstall: cb => spareInstallCb = cb,
  /* 无头验证探针：装配件清单 + GLB 命中数 */
  debugState: () => ({
    installed: [...installed.values()].map(v => ({ cat: v.cat, idx: v.idx, id: v.id, glb: !!(v.group.userData && v.group.userData.glbWrapped) })),
    glb: glbStats, phase, ready,
    /* 自由拖拽探针用：台面上备用件数 + 用户自由摆放数 + 是否正在拖 */
    spareCount: spareObjs.size, freeCount: freePose.size, draggingFree: !!freeDrag,
    camera: ready ? camera.position.toArray().map(v => Math.round(v)) : null,
    target: ready ? controls.target.toArray().map(v => Math.round(v)) : null,
    canvas: renderer ? [renderer.domElement.width, renderer.domElement.height] : null,
    /* pc53 写实贴图状态（探针 scripts/probe_tex.js 用）：
       loaded=对象存在，img=图片已解码，inScene=场景里有多少网格正在用它。
       inScene>0 才证明贴图真的贴到了部件上（不只是加载了）。 */
    tex: (() => {
      const count = t => { if (!t) return 0; let n = 0; scene.traverse(o => { if (o.isMesh && o.material && o.material.map === t) n++; }); return n; };
      const st = t => ({ loaded: !!t, img: !!(t && t.image && t.image.complete), inScene: count(t) });
      return { moboPcb: st(M.__moboPcb), cpuIhs: st(M.__cpuIhs), gpuShroud: st(M.__gpuShroud), fanHub: st(M.__fanHub),
        ramBlack: st(M.__ramBlack), ramWhite: st(M.__ramWhite), coolerTop: st(M.__coolerTop), aioPump: st(M.__aioPump),
        psuLabel: st(M.__psuLabel), caseShroud: st(M.__caseShroud), gpuBack: st(M.__gpuBack),
        cpuIhsAmd: st(M.__cpuIhsAmd), gpuShroudAmd: st(M.__gpuShroudAmd), gpuBackAmd: st(M.__gpuBackAmd), ramSilver: st(M.__ramSilver) };
    })(),
  }) };
