/* 纯 CPU 软件光栅器（开发工具，不参与构建）
 *
 *   node scripts/render3d.js                # → tmp/strata-render.png
 *   node scripts/render3d.js --view=front   # 换视角：default / front / rear / top
 *
 * 为什么需要它：本机没有可用的无头浏览器（沙箱里 Edge/Chrome 都起不来），
 * 也没法用 GPU 渲染，所以「改完到底长什么样」一直只能靠人眼。
 * 这里用 Node 直接读 3d.js 里的建模函数，取三角形 → 透视投影 → Z-buffer 光栅化
 * → 朗伯着色（主光 + 环境）→ 写 PNG。不使用 WebGL，不需要任何原生模块。
 *
 * 它只能验证**几何与明暗关系**（比例、遮挡、谁亮谁暗），不能验证贴图与泛光。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');
const vendorDir = path.join(root, 'vendor');
const tmpDir = path.join(os.tmpdir(), 'strata-render');
fs.mkdirSync(tmpDir, { recursive: true });

/* ---------- 1. 打包 3d.js（挂出建模函数） ---------- */
const EXPOSE = [
  'buildCasePart', 'buildMotherboard', 'buildCPU', 'buildCooler', 'buildPSU',
  'buildDIMM', 'buildSSD', 'buildGPU', 'planCables',
  'L', 'M', 'initMaterials', 'THREE',
];
let src = fs.readFileSync(path.join(srcDir, '3d.js'), 'utf8');
src = src.replace("from './texdata.js'", "from '" + path.join(srcDir, 'texdata.js').replace(/\\/g, '/') + "'");
src += '\nwindow.__RENDER = { ' + EXPOSE.join(', ') + ' };\n';
const entry = path.join(tmpDir, '3d-render.js');
fs.writeFileSync(entry, src);

function findEsbuild() {
  const exe = process.platform === 'win32' ? 'esbuild.exe' : 'esbuild';
  const cands = [
    process.env.ESBUILD_BIN,
    path.join(root, 'node_modules', '@esbuild', process.platform + '-' + process.arch, exe),
    path.join(root, 'node_modules', '.bin', exe),
    'esbuild',
  ].filter(Boolean);
  for (const c of cands) if (c === 'esbuild' || fs.existsSync(c)) return c;
  return null;
}
const bundlePath = path.join(tmpDir, 'bundle.cjs');
const ESBUILD = findEsbuild();
if (!ESBUILD) { console.error('找不到 esbuild，先 npm install'); process.exit(1); }
execFileSync(ESBUILD, [
  entry, '--bundle', '--format=cjs', '--platform=node', '--outfile=' + bundlePath,
  '--alias:three=' + path.join(vendorDir, 'three.module.js'),
  '--alias:three/addons=' + vendorDir,
], { cwd: root, stdio: 'inherit' });

/* ---------- 2. DOM 桩 ---------- */
const noopCtx = new Proxy({}, { get: () => () => { } });
global.document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => noopCtx }) };
global.window = { devicePixelRatio: 1, addEventListener() { }, innerWidth: 1440, innerHeight: 900 };
const P = require(path.join(srcDir, 'parts.js'));
global.window.STRATA_PARTS = P;
global.window.STRATA_ASSETS = { baseUrl: '', parts: {} };
require(bundlePath);
const A = global.window.__RENDER;
A.initMaterials();
const THREE = A.THREE;

/* ---------- 3. 组装场景 ---------- */
const CFG = {
  default: {
    cpu: 'i7-12700KF', mobo: 'z790-gaming-plus',
    ram: ['d5-16-5600', 'd5-32-5200', 'd5-16-5600', 'd5-32-5200'],
    gpu: ['rtx-3080-20g', 'rtx-4070s'], ssd: ['ti600-1t'],
    psu: 'psu-1250t', cooler: 'aio360', case: 'mft3f',
  },
  air: {
    cpu: 'i7-12700KF', mobo: 'z790-gaming-plus',
    ram: ['d5-16-5600', 'd5-32-5200'], gpu: ['rtx-3080-20g'], ssd: ['ti600-1t'],
    psu: 'psu-850g', cooler: 'ag400', case: 'mft3f',
  },
};
const cfgName = (process.argv.find(s => s.startsWith('--config=')) || '').split('=')[1] || 'default';
const build = CFG[cfgName] || CFG.default;
const st = { model: 'ud_q4', ctx: 262144, conc: 1, think: 'balanced', igpuDisplay: false, helperCache: false };
const an = P.analyze(build, st);

const groups = [];
const push = (name, obj) => { if (obj) { obj.updateMatrixWorld(true); groups.push({ name, obj }); } };
push('case', A.buildCasePart(P.byId(build.case)));
push('mobo', A.buildMotherboard(P.byId(build.mobo), an));
push('cpu', A.buildCPU(P.byId(build.cpu)));
push('cooler', A.buildCooler(P.byId(build.cooler)));
push('psu', A.buildPSU(P.byId(build.psu)));
build.ram.forEach((id, i) => push('ram' + i, A.buildDIMM(P.byId(id), i)));
an.gpuAssign.forEach((g, i) => push('gpu' + i, A.buildGPU(P.byId(g.id), g, i)));
build.ssd.forEach((id, i) => push('ssd' + i, A.buildSSD(P.byId(id), i)));

/* 工作台（跟场景里同一块板子） */
const benchG = new THREE.Group();
{
  const m = new THREE.Mesh(new THREE.BoxGeometry(2800, 64, 2100),
    new THREE.MeshStandardMaterial({ color: 0x9a8768, roughness: 0.72 }));
  m.position.set(105, -3 - 32, 225);
  benchG.add(m); benchG.updateMatrixWorld(true);
}
groups.push({ name: 'bench', obj: benchG });

/* ---------- 4. 收集三角形 ---------- */
const COLORS = { case: 0x262b33, bench: 0x9a8768 };
const tris = [];
for (const g of groups) {
  g.obj.traverse(o => {
    if (!o.isMesh) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!mat) return;
    if (mat.transparent || mat.alphaTest > 0) return;      // 玻璃 / 防尘网直接跳过
    const geo = o.geometry;
    const pos = geo.attributes.position;
    if (!pos) return;
    const idx = geo.index ? geo.index.array : null;
    const base = o.matrixWorld.elements.slice();
    const inst = o.isInstancedMesh ? o.instanceMatrix : null;
    const nInst = o.isInstancedMesh ? o.count : 1;
    for (let inst_i = 0; inst_i < nInst; inst_i++) {
      const mm = new THREE.Matrix4();
      if (inst) { mm.fromArray(inst.array, inst_i * 16); mm.premultiply(o.matrixWorld); }
      else mm.fromArray(base);
      const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      const n = idx ? idx.length : pos.count;
      for (let i = 0; i < n; i += 3) {
        for (let k = 0; k < 3; k++) {
          const vi = idx ? idx[i + k] : (i + k);
          v[k].fromBufferAttribute(pos, vi).applyMatrix4(mm);
        }
        tris.push({
          a: v[0].clone(), b: v[1].clone(), c: v[2].clone(),
          color: new THREE.Color(mat.color ? mat.color.getHex() : 0x888888),
          lum: mat.metalness !== undefined ? (0.35 + 0.65 * (1 - Math.min(1, mat.roughness))) : 0.4,
          group: g.name,
        });
      }
    }
  });
}

/* ---------- 5. 相机 ---------- */
const VIEWS = {
  default: { pos: [760, 560, 980], target: [100, 240, 230] },
  front: { pos: [120, 300, -820], target: [105, 240, 225] },
  rear: { pos: [700, 420, 1400], target: [105, 240, 225] },
  top: { pos: [420, 1250, 700], target: [105, 200, 225] },
  side: { pos: [1250, 380, 250], target: [105, 240, 225] },
};
const viewName = (process.argv.find(s => s.startsWith('--view=')) || '').split('=')[1] || 'default';
const V = VIEWS[viewName] || VIEWS.default;
const argNum = (n, d) => { const m = process.argv.find(s => s.startsWith('--' + n + '=')); return m ? +m.split('=')[1] : d; };
const W = argNum('w', 960), H = argNum('h', 680);   // 1200x630 = OG 社交卡片尺寸
const cam = new THREE.PerspectiveCamera(42, W / H, 1, 6000);
cam.position.set(...V.pos);
cam.lookAt(new THREE.Vector3(...V.target));
cam.updateMatrixWorld(true);
cam.updateProjectionMatrix();
const viewProj = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

/* ---------- 6. 光栅化 ---------- */
const zbuf = new Float32Array(W * H).fill(Infinity);
const img = new Uint8Array(W * H * 3);
const owner = new Int16Array(W * H).fill(-1);
/* 背景：从上到下的冷灰渐变，比纯色更像展台（OG 卡片用得上） */
for (let y = 0; y < H; y++) {
  const t = y / (H - 1);
  const r = Math.round(23 - 12 * t), g2 = Math.round(30 - 15 * t), b = Math.round(40 - 20 * t);
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    img[i] = r; img[i + 1] = g2; img[i + 2] = b;
  }
}

const L = new THREE.Vector3(600, 800, 500).normalize();   // 主光方向（与场景一致）
const V3 = new THREE.Vector3();
const p0 = new THREE.Vector4(), p1 = new THREE.Vector4(), p2 = new THREE.Vector4();
const nrm = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();

function project(v, out) {
  out.set(v.x, v.y, v.z, 1).applyMatrix4(viewProj);
  return out;
}
let drawn = 0;
for (const t of tris) {
  // 面法线（世界空间）与朗伯项
  e1.subVectors(t.b, t.a); e2.subVectors(t.c, t.a);
  nrm.crossVectors(e1, e2).normalize();
  const diff = Math.max(0, nrm.dot(L));
  /* 近似场景光照：半球天光（朝上的面更亮）+ 主光 + 金属环境项。
     真 PBR 的金属没有漫反射、全靠 IBL 反射，这里没有环境贴图，
     如果只做朗伯，深色机箱会塌成纯黑剪影——所以按 mat.metalness/roughness
     推出的 t.lum 补一项“环境反射”，让金属件在预览里仍有明度层次。 */
  const sky = 0.40 + 0.38 * Math.max(0, nrm.y) - 0.06 * Math.min(0, nrm.y);
  const shade = sky + 1.05 * diff + 0.95 * (t.lum || 0);

  project(t.a, p0); project(t.b, p1); project(t.c, p2);
  if (p0.w <= 0 || p1.w <= 0 || p2.w <= 0) continue;                  // 近裁面
  const x0 = (p0.x / p0.w * 0.5 + 0.5) * W, y0 = (-p0.y / p0.w * 0.5 + 0.5) * H, z0 = p0.z / p0.w;
  const x1 = (p1.x / p1.w * 0.5 + 0.5) * W, y1 = (-p1.y / p1.w * 0.5 + 0.5) * H, z1 = p1.z / p1.w;
  const x2 = (p2.x / p2.w * 0.5 + 0.5) * W, y2 = (-p2.y / p2.w * 0.5 + 0.5) * H, z2 = p2.z / p2.w;
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
  if (minX > maxX || minY > maxY) continue;
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(area) < 1e-9) continue;
  const cr = Math.pow(t.color.r, 2.2) * shade, cg = Math.pow(t.color.g, 2.2) * shade, cb = Math.pow(t.color.b, 2.2) * shade;
  for (let py = minY; py <= maxY; py++) {
    const fy = py + 0.5;
    for (let px = minX; px <= maxX; px++) {
      const fx = px + 0.5;
      const w0 = ((x1 - fx) * (y2 - fy) - (x2 - fx) * (y1 - fy)) / area;
      const w1 = ((x2 - fx) * (y0 - fy) - (x0 - fx) * (y2 - fy)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * z0 + w1 * z1 + w2 * z2;
      const pi = py * W + px;
      if (z >= zbuf[pi]) continue;
      zbuf[pi] = z;
      // 简易 ACES 曲线 + gamma
      const tm = c => { const x = c * 1.15; const y = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14); return Math.min(1, Math.max(0, y)); };
      img[pi * 3] = Math.round(Math.pow(tm(cr), 1 / 2.2) * 255);
      img[pi * 3 + 1] = Math.round(Math.pow(tm(cg), 1 / 2.2) * 255);
      img[pi * 3 + 2] = Math.round(Math.pow(tm(cb), 1 / 2.2) * 255);
      owner[pi] = groups.findIndex(g => g.name === t.group);
    }
  }
  drawn++;
}

/* ---------- 7. 统计 ---------- */
console.log('三角形 ' + tris.length + '，绘制 ' + drawn + '，视角 ' + viewName);
const stat = new Map();
for (let i = 0; i < W * H; i++) {
  const oi = owner[i]; if (oi < 0) continue;
  const nm = groups[oi].name;
  const lum = 0.2126 * img[i * 3] + 0.7152 * img[i * 3 + 1] + 0.0722 * img[i * 3 + 2];
  const s = stat.get(nm) || { n: 0, lum: 0 };
  s.n++; s.lum += lum; stat.set(nm, s);
}
const tot = W * H;
console.log('配件            像素占比   平均亮度(0-255)');
for (const [nm, s] of [...stat].sort((a, b) => b[1].n - a[1].n)) {
  console.log('  ' + nm.padEnd(12) + (s.n / tot * 100).toFixed(1).padStart(6) + '%   ' + (s.lum / s.n).toFixed(0).padStart(4));
}

/* ---------- 8. 写 PNG ---------- */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  Buffer.from(img.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
const outPath = path.join(root, 'tmp', 'strata-' + viewName + '.png');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, png);
console.log('→ ' + outPath + '  (' + (png.length / 1024).toFixed(0) + ' KB)');
