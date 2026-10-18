/* 3D 几何审计（开发工具，不参与构建）
 *
 *   npm run audit                 # 全量：各件 AABB + 越界 + 两两穿模
 *   npm run audit -- gpu0         # 解剖单个配件：列出每个网格的世界 AABB
 *
 * 原理：把 src/3d.js 复制一份并在末尾挂出内部 build*() 函数，用 esbuild 打成
 * CommonJS，在 Node 里直接调用**真实的建模函数**算世界坐标包围盒。
 * 因为没有第二套几何实现，审计结果和网页里看到的必然一致。
 *
 * 注意：Node 里没有 WebGL，这里只算几何，不做渲染。
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');
const vendorDir = path.join(root, 'vendor');
const tmpDir = path.join(os.tmpdir(), 'strata-audit');
fs.mkdirSync(tmpDir, { recursive: true });

/* ---- 1. 生成可审计副本 ---- */
const EXPOSE = [
  'buildCasePart', 'buildMotherboard', 'buildCPU', 'buildCooler',
  'buildPSU', 'buildDIMM', 'buildSSD', 'buildGPU', 'planCables',
  'L', 'M', 'initMaterials', 'THREE', 'DOOR_HINGE_FRONT', 'DOOR_SWING',
];
let src = fs.readFileSync(path.join(srcDir, '3d.js'), 'utf8');
/* 把 './texdata*.js' 的相对 import 改写成绝对路径——entry 在临时目录，
   相对路径会相对临时目录解析而找不到（texdata2/3 引入后此脚本即坏，现补全）。 */
src = src.replace(/from '\.\/(texdata\d*\.js)'/g,
  (m, f) => "from '" + path.join(srcDir, f).replace(/\\/g, '/') + "'");
src += '\nwindow.__AUDIT = { ' + EXPOSE.join(', ') + ' };\n';
const entry = path.join(tmpDir, '3d-audit.js');
fs.writeFileSync(entry, src);

/* ---- 2. 打包成 Node 能 require 的 CJS ---- */
function findEsbuild() {
  const exe = process.platform === 'win32' ? 'esbuild.exe' : 'esbuild';
  const cands = [
    process.env.ESBUILD_BIN,
    path.join(root, 'node_modules', '@esbuild', process.platform + '-' + process.arch, exe),
    path.join(root, 'node_modules', '.bin', exe),
    path.join(root, 'node_modules', 'esbuild', 'bin', 'esbuild'),
    'esbuild',
  ].filter(Boolean);
  for (const c of cands) if (c === 'esbuild' || fs.existsSync(c)) return c;
  return null;
}
const bundlePath = path.join(tmpDir, 'bundle.cjs');
const ESBUILD = findEsbuild();
if (!ESBUILD) {
  console.error('找不到 esbuild，先跑 npm install');
  process.exit(1);
}
execFileSync(ESBUILD, [
  entry, '--bundle', '--format=cjs', '--platform=node',
  '--outfile=' + bundlePath,
  '--alias:three=' + path.join(vendorDir, 'three.module.js'),
  '--alias:three/addons=' + vendorDir,
], { cwd: root, stdio: 'inherit' });

/* ---- 3. 最小 DOM 桩（贴图生成要 canvas，几何不需要） ---- */
const noopCtx = new Proxy({}, { get: () => () => { } });
global.document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => noopCtx }) };
global.window = { devicePixelRatio: 1, addEventListener() { }, innerWidth: 1440, innerHeight: 900 };

const P = require(path.join(srcDir, 'parts.js'));
global.window.STRATA_PARTS = P;
global.window.STRATA_ASSETS = { baseUrl: '', parts: {} };
require(bundlePath);
const A = global.window.__AUDIT;
if (!A) { console.error('审计入口未注入'); process.exit(1); }
A.initMaterials();
const THREE = A.THREE;

/* ---- 4. 被测配置 ---- */
const CONFIGS = {
  /* 页面 ?3d 默认预载的那套：双卡，最容易撞 */
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
  hdd: {
    cpu: 'i7-12700KF', mobo: 'z790-gaming-plus',
    ram: ['d5-32-5200'], gpu: ['rtx-3080-20g'], ssd: ['wd43purz-4t', 'sn850x-2t'],
    psu: 'psu-1000p', cooler: 'pa120se', case: 'mft3f',
  },
  matx: {
    cpu: 'r7-7700', mobo: 'b760m-mortar',
    ram: ['d5-16-5600', 'd5-16-5600'], gpu: ['rtx-4070s'], ssd: ['sn850x-2t'],
    psu: 'psu-750', cooler: 'ag400', case: 'mft3f',
  },
  big: {
    cpu: 'i9-14900KF', mobo: 'z790-meg-ace',
    ram: ['d5-32-5200', 'd5-32-5200', 'd5-32-5200', 'd5-32-5200'],
    gpu: ['rtx-4090'], ssd: ['sn5000-4t'],
    psu: 'psu-1600', cooler: 'd15', case: 'ft7f',
  },
};
const cfgArg = (process.argv.find(a => a.startsWith('--config=')) || '').split('=')[1];
const cfgName = cfgArg || 'default';
const build = CONFIGS[cfgName];
if (!build) {
  console.error('未知配置：' + cfgName + '（可选 ' + Object.keys(CONFIGS).join(' / ') + '）');
  process.exit(1);
}
const a = P.analyze(build, { model: 'ud_q4', ctx: 262144, conc: 1, think: 'balanced', igpuDisplay: false, helperCache: false });
const makers = {
  case: () => A.buildCasePart(P.byId(build.case)),
  mobo: () => A.buildMotherboard(P.byId(build.mobo), a),
  cpu: () => A.buildCPU(P.byId(build.cpu)),
  cooler: () => A.buildCooler(P.byId(build.cooler)),
  psu: () => A.buildPSU(P.byId(build.psu)),
  ssd0: () => A.buildSSD(P.byId(build.ssd[0]), 0),
};
build.ram.forEach((id, i) => { makers['ram' + i] = () => A.buildDIMM(P.byId(id), i); });
a.gpuAssign.forEach((g, i) => { makers['gpu' + i] = () => A.buildGPU(P.byId(g.id), g, i); });

const f = n => (Math.round(n * 10) / 10).toFixed(1).padStart(7);
const C = A.L.caseIn;

/* ---- 模式 B：解剖单个配件 ---- */
const only = process.argv.slice(2).find(a => !a.startsWith('--'));
if (only) {
  const g = (makers[only] || (() => null))();
  if (!g) { console.error('未知配件：' + only + '（可选 ' + Object.keys(makers).join(' ') + '）'); process.exit(1); }
  g.updateMatrixWorld(true);
  const rows = [];
  g.traverse(o => {
    if (!o.isMesh) return;
    const b = new THREE.Box3().setFromObject(o);
    const s = new THREE.Vector3(); b.getSize(s);
    rows.push({ name: (o.geometry && o.geometry.type || '?').replace('Geometry', ''), s, b, v: s.x * s.y * s.z });
  });
  rows.sort((x, y) => y.v - x.v);
  console.log('\n' + only + '：' + rows.length + ' 个网格，前 20 大');
  console.log('  类型        x:min    max  |   y:min    max  |   z:min    max  |  尺寸');
  for (const r of rows.slice(0, 20)) {
    console.log('  ' + String(r.name).padEnd(9) + f(r.b.min.x) + f(r.b.max.x) + ' |' + f(r.b.min.y) + f(r.b.max.y) + ' |' + f(r.b.min.z) + f(r.b.max.z) + ' | ' +
      r.s.x.toFixed(1).padStart(6) + 'x' + r.s.y.toFixed(1).padStart(6) + 'x' + r.s.z.toFixed(1).padStart(6));
  }
  process.exit(0);
}

/* ---- 模式 A：全量审计 ---- */
const parts = [];
for (const [name, mk] of Object.entries(makers)) {
  const obj = mk();
  if (!obj) { console.log('  !! ' + name + ' 建模返回 null'); continue; }
  obj.updateMatrixWorld(true);
  parts.push({ name, obj, box: new THREE.Box3().setFromObject(obj) });
}

console.log('\n===== 配置 [' + cfgName + '] 内腔 W=' + C.w + ' H=' + C.h + ' D=' + C.d + '（X=深 0→侧透, Y=高, Z=后→前） =====');
console.log('\n【各件 AABB（mm）】');
console.log('名称     x:min   max |   y:min   max |   z:min   max |  尺寸');
for (const p of parts) {
  const s = new THREE.Vector3(); p.box.getSize(s);
  console.log(p.name.padEnd(7) + f(p.box.min.x) + f(p.box.max.x) + ' |' + f(p.box.min.y) + f(p.box.max.y) + ' |' +
    f(p.box.min.z) + f(p.box.max.z) + ' | ' + s.x.toFixed(0) + 'x' + s.y.toFixed(0) + 'x' + s.z.toFixed(0));
}

console.log('\n【越出内腔】');
let out = 0;
for (const p of parts) {
  if (p.name === 'case') continue;
  const o = [];
  if (p.box.min.x < -0.5) o.push('x- ' + p.box.min.x.toFixed(1));
  if (p.box.max.x > C.w + 0.5) o.push('x+ ' + p.box.max.x.toFixed(1));
  if (p.box.min.y < -0.5) o.push('y- ' + p.box.min.y.toFixed(1));
  if (p.box.max.y > C.h + 0.5) o.push('y+ ' + p.box.max.y.toFixed(1));
  if (p.box.min.z < -0.5) o.push('z- ' + p.box.min.z.toFixed(1));
  if (p.box.max.z > C.d + 0.5) o.push('z+ ' + p.box.max.z.toFixed(1));
  if (o.length) { out++; console.log('  ✗ ' + p.name.padEnd(6) + o.join('   ')); }
}
if (!out) console.log('  ✓ 全部在腔内');

console.log('\n【穿模检查】逐网格对逐网格（组包围盒会误报：冷排横跨整个顶部，会把整片区域都算成它的体积）');
console.log('  插接区 = 交叠完全落在主板侧 x≤20mm 内，属于插进插槽/贴板安装，属预期');
const list = parts.filter(p => p.name !== 'case');
const INSERT_ZONE = 20;
let real = 0, expected = 0;
for (const p of list) {
  p.meshes = [];
  p.obj.traverse(o => {
    if (!o.isMesh) return;
    const b = new THREE.Box3().setFromObject(o);
    const s = new THREE.Vector3(); b.getSize(s);
    if (s.x * s.y * s.z > 1) p.meshes.push(b);   // 忽略零体积的装饰面
  });
}
for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
  let best = null;
  for (const A1 of list[i].meshes) for (const B1 of list[j].meshes) {
    if (!A1.intersectsBox(B1)) continue;
    const inter = A1.clone().intersect(B1);
    const s = new THREE.Vector3(); inter.getSize(s);
    const vol = s.x * s.y * s.z;
    const depth = Math.min(s.x, s.y, s.z);
    if (vol < 50 || depth < 0.5) continue;       // 贴面接触不算
    if (!best || vol > best.vol) best = { s, vol, maxX: inter.max.x };
  }
  if (!best) continue;
  const txt = list[i].name.padEnd(6) + '×' + list[j].name.padEnd(6) +
    ' 最深重叠 ' + best.s.x.toFixed(1) + '×' + best.s.y.toFixed(1) + '×' + best.s.z.toFixed(1) +
    ' = ' + best.vol.toFixed(0) + 'mm³';
  if (best.maxX <= INSERT_ZONE) { expected++; console.log('  · ' + txt + '   [插接]'); }
  else { real++; console.log('  ✗ ' + txt + '   [真穿模]'); }
}
if (!real) console.log('  ✓ 无真穿模');

/* ---- 线缆走线穿模：直接用页面里同一套 planCables 生成曲线，逐点检测 ---- */
let cableBad = 0;
if (A.planCables) {
  console.log('\n【线缆走线】曲线与页面完全同一套（planCables），逐点检测有没有穿进配件');
  const psuP = parts.find(p => p.name === 'psu');
  const aa = psuP && psuP.obj.userData.anchor, fb = psuP && psuP.obj.userData.fitBox;
  const gpuPa = parts.filter(p => p.name.startsWith('gpu')).map(p => p.obj.userData.powerAt).filter(Boolean);
  const gpuFronts = parts.filter(p => p.name.startsWith('gpu')).map(p => p.obj.userData.frontZ).filter(n => typeof n === 'number');
  if (aa && fb) {
    const routes = A.planCables({
      psuFrontZ: aa[2] - fb.z / 2,
      hasCpu: !!parts.find(p => p.name === 'cpu'),
      gpus: gpuPa,
      gpusFront: gpuFronts.length ? Math.min(...gpuFronts) : null,
    });
    // 每个配件的逐网格 AABB（线缆要绕开的是真实几何，不是组包围盒）
    const mine = parts.map(p => {
      const boxes = [];
      p.obj.traverse(o => { if (o.isMesh) boxes.push(new THREE.Box3().setFromObject(o)); });
      return { name: p.name, boxes };
    });
    for (const rt of routes) {
      const curve = new THREE.CatmullRomCurve3(rt.pts.map(q => new THREE.Vector3(q[0], q[1], q[2])));
      const N = 400, hits = new Map();
      for (let i = 0; i <= N; i++) {
        const t = i / N, p = curve.getPoint(t);
        for (const m of mine) {
          if (m.name === 'psu' && t < 0.05) continue;      // 起点就在电源前面板上，属正常
          if (m.name === 'psu' && rt.label === 'gpu' && t > 0.9) continue;
          for (const b of m.boxes) {
            if (p.x > b.min.x - rt.r && p.x < b.max.x + rt.r &&
              p.y > b.min.y - rt.r && p.y < b.max.y + rt.r &&
              p.z > b.min.z - rt.r && p.z < b.max.z + rt.r) {
              const h = hits.get(m.name) || { n: 0, t0: 1, t1: 0 };
              h.n++; h.t0 = Math.min(h.t0, t); h.t1 = Math.max(h.t1, t); hits.set(m.name, h);
              break;
            }
          }
        }
      }
      // 曲线最后 15% 是插头段，本来就要插进插座，不算穿模
      const bad = [...hits].filter(([nm, h]) => h.t0 < 0.84);
      if (!bad.length) console.log('  ✓ ' + rt.label.padEnd(6) + ' 全程无穿模' +
        (hits.size ? '（末端插头正常插入 ' + [...hits.keys()].join('/') + '）' : ''));
      else {
        cableBad++;
        console.log('  ✗ ' + rt.label.padEnd(6) + ' ' + bad.map(([nm, h]) =>
          nm + '(t=' + h.t0.toFixed(2) + '~' + h.t1.toFixed(2) + ')').join('  '));
      }
    }
  }
}
console.log('\n【小结】越界 ' + out + ' 件，真穿模 ' + real + ' 对，插接/遮挡 ' + expected + ' 对，线缆穿模 ' + cableBad + ' 条\n');
