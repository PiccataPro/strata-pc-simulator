/* 构建单文件版：把 src/ 的 JS 内联进 index.html → dist/strata-pc-simulator.html
 * 用法：node scripts/build.js  （或 npm run build）
 * 3D 模块（3d.js + vendor/three + vendor addons）经 esbuild 打成 iife 一并内联；
 * 找不到 esbuild 时回退保留 importmap 外链（仅 src/ 目录 serve 时可用）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');
const vendorDir = path.join(root, 'vendor');
const distDir = path.join(root, 'dist');
const out = path.join(distDir, 'strata-pc-simulator.html');

let html = fs.readFileSync(path.join(srcDir, 'index.html'), 'utf8');
/* 内联 src/ 与 ../assets/ 下的 <script src>。
 * srcDir 为基准解析相对路径：src/app.js → src/app.js；../assets/manifest.js → assets/manifest.js */
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, file) => {
  const js = fs.readFileSync(path.resolve(srcDir, file), 'utf8');
  return '<script>\n' + js + '\n</script>';
});

/* 语法自检：内联前先确认这段 JS 能被解析。
 * 用 new Function 只做编译不执行，所以不会碰到 document/THREE。 */
function assertParses(js, what) {
  try {
    new Function(js);
  } catch (e) {
    console.error('build 失败：' + what + ' 不是合法 JS —— ' + e.message);
    process.exit(1);
  }
}

/* 3D 模块：esbuild 打包 three + addons + 3d.js → iife 内联（单文件版离线可用） */
function findEsbuild() {
  const exe = process.platform === 'win32' ? 'esbuild.exe' : 'esbuild';
  const cands = [
    process.env.ESBUILD_BIN,
    path.join(root, 'node_modules', '@esbuild', process.platform + '-' + process.arch, exe),
    path.join(root, 'node_modules', '.bin', exe),
    path.join(root, 'node_modules', 'esbuild', 'bin', 'esbuild'),
    'esbuild', // PATH 兜底，交给 execFileSync 解析
  ].filter(Boolean);
  for (const c of cands) {
    if (c === 'esbuild') return c;
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const ESBUILD_HINT = [
  '',
  'build 失败：找不到 esbuild，无法把 src/3d.js 打包进单文件版。',
  '',
  '  旧版本这里是「静默降级」——保留 importmap 外链、退出码 0，产出一个没有 3D 的',
  '  dist/strata-pc-simulator.html。线上 3D 就是这样丢的，所以现在改为直接失败。',
  '',
  '  任选其一：',
  '    1) npm install                         （推荐，esbuild 已在 devDependencies）',
  '    2) ESBUILD_BIN=<path>/esbuild          指向已有的可执行文件',
  '    3) STRATA3D_BUNDLE=<path>/bundle.js    使用预打包好的 iife 产物',
  '',
].join('\n');

const moduleTag = /<script type="importmap">[\s\S]*?<\/script>\s*<script type="module" src="3d\.js"><\/script>/;
if (moduleTag.test(html)) {
  let js;
  if (process.env.STRATA3D_BUNDLE) {
    /* 预打包通道：限制不能 spawn 子进程的环境，或 CI 里复用缓存产物。
       生成方式：esbuild src/3d.js --bundle --format=iife --minify \
                 --alias:three=vendor/three.module.js --alias:three/addons=vendor */
    js = fs.readFileSync(process.env.STRATA3D_BUNDLE, 'utf8');
    console.log('OK → 3D 模块取自预打包 bundle（' + (js.length / 1024).toFixed(0) + ' KB）');
  } else {
    const ESBUILD = findEsbuild();
    if (!ESBUILD) {
      console.error(ESBUILD_HINT);
      process.exit(1);
    }
    const tmp = path.join(os.tmpdir(), 'strata3d.bundle.' + process.pid + '.js');
    try {
      execFileSync(ESBUILD, [
        path.join(srcDir, '3d.js'),
        '--bundle', '--format=iife', '--minify',
        '--alias:three=' + path.join(vendorDir, 'three.module.js'),
        '--alias:three/addons=' + vendorDir,
        '--outfile=' + tmp,
      ], { cwd: root, stdio: 'inherit' });
    } catch (e) {
      console.error('build 失败：esbuild 执行出错（' + ESBUILD + '）');
      console.error(String(e.message || e));
      process.exit(1);
    }
    js = fs.readFileSync(tmp, 'utf8');
    fs.unlinkSync(tmp);
    console.log('OK → 3D 模块已 esbuild 内联（' + (js.length / 1024).toFixed(0) + ' KB）');
  }
  /* 必须用**函数替换**，不能直接传字符串：
     String.replace 会把替换串里的 `$&` / `$'` / `` $` `` / `$1` 当成特殊模式。
     esbuild 压缩后的变量名可能以 `$` 结尾（如 `Se=$&&!!T.clearcoatRoughnessMap`），
     其中 `$&` 一旦命中，就会把「整个 importmap + module 标签」原样嵌进 JS 中间，
     产物看着有 1MB，实际语法全废——GitHub Pages 上点 3D 报的就是这个。 */
  assertParses(js, '3D bundle');
  html = html.replace(moduleTag, () => '<script>\n' + js + '\n</script>');
  if (/<script type="importmap">/.test(html)) {
    console.error('build 失败：产物里仍残留 importmap，说明 3D 模块没有被内联');
    process.exit(1);
  }
}

if (/<script src=/.test(html)) {
  console.error('build: 仍有未内联的 <script src>，检查 index.html');
  process.exit(1);
}
fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(out, html, 'utf8');
console.log('OK →', path.relative(root, out), (fs.statSync(out).size / 1024).toFixed(1) + ' KB');

/* 同时输出 GitHub Pages 入口：docs/index.html（Pages 源=main 分支 /docs 文件夹） */
const pagesEntry = path.join(root, 'docs', 'index.html');
fs.writeFileSync(pagesEntry, html, 'utf8');
console.log('OK →', path.relative(root, pagesEntry), '（GitHub Pages 入口）');

/* Pages 把 docs/ 当站点根，外部资源不会跟着单文件走，必须一起搬过去。
 * 漏掉 bg/store.png 的表现就是线上"背景和桌子都不见了"（台面已解耦，但照片会缺）。 */
const docsDir = path.join(root, 'docs');
const copies = [['assets/bg/store.png', 'assets/bg/store.png']];
const manifestTxt = fs.readFileSync(path.join(root, 'assets', 'manifest.js'), 'utf8');
/* 只搬 manifest 里真正登记过的 GLB（noGlb 的条目不会引用文件，不用占用 Pages 体积）。
 * 同一文件可能被多个配件 id 引用（cpu_lga1700.glb 就被两颗 U 共用），用 Set 去重。 */
const glbSet = new Set();
for (const m of manifestTxt.matchAll(/glb:\s*'([^']+)'/g)) glbSet.add(m[1]);
for (const g of glbSet) copies.push(['assets/models/' + g, 'assets/models/' + g]);
let copiedKB = 0;
for (const [from, to] of copies) {
  const src2 = path.join(root, from);
  if (!fs.existsSync(src2)) { console.warn('WARN: 缺少资源', from); continue; }
  const dst = path.join(docsDir, to);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src2, dst);
  copiedKB += fs.statSync(dst).size / 1024;
}
console.log('OK → docs 外部资源 ' + copies.length + ' 个，共 ' + (copiedKB / 1024).toFixed(1) + ' MB（背景图 + 已登记 GLB）');
