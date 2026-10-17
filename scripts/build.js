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

/* 3D 模块：esbuild 打包 three + addons + 3d.js → iife 内联（单文件版离线可用） */
function findEsbuild() {
  const cands = [
    process.env.ESBUILD_BIN,
    path.join(os.homedir(), '.workbuddy/binaries/node/workspace/node_modules/@esbuild/win32-x64/esbuild.exe'),
    path.join(os.homedir(), '.workbuddy/binaries/node/workspace/node_modules/.bin/esbuild'),
    'esbuild',
  ].filter(Boolean);
  for (const c of cands) {
    if (c === 'esbuild') return c; // PATH 兜底，交给 execFileSync 解析
    if (fs.existsSync(c)) return c;
  }
  return null;
}
const moduleTag = /<script type="importmap">[\s\S]*?<\/script>\s*<script type="module" src="3d\.js"><\/script>/;
if (moduleTag.test(html)) {
  const ESBUILD = findEsbuild();
  if (ESBUILD) {
    const tmp = path.join(os.tmpdir(), 'strata3d.bundle.' + process.pid + '.js');
    execFileSync(ESBUILD, [
      path.join(srcDir, '3d.js'),
      '--bundle', '--format=iife', '--minify',
      '--alias:three=' + path.join(vendorDir, 'three.module.js'),
      '--alias:three/addons=' + vendorDir,
      '--outfile=' + tmp,
    ], { cwd: root, stdio: 'inherit' });
    const js = fs.readFileSync(tmp, 'utf8');
    fs.unlinkSync(tmp);
    html = html.replace(moduleTag, '<script>\n' + js + '\n</script>');
    console.log('OK → 3D 模块已 esbuild 内联（' + (js.length / 1024).toFixed(0) + ' KB）');
  } else {
    console.warn('WARN: 未找到 esbuild，3D 模块保留 importmap 外链（单文件版在无 vendor 目录下 3D 不可用）');
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
