/* 构建单文件版：把 src/ 的 4 个 JS 内联进 index.html → dist/strata-pc-simulator.html
 * 用法：node scripts/build.js  （或 npm run build） */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');
const distDir = path.join(root, 'dist');
const out = path.join(distDir, 'strata-pc-simulator.html');

let html = fs.readFileSync(path.join(srcDir, 'index.html'), 'utf8');
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, file) => {
  const js = fs.readFileSync(path.join(srcDir, file), 'utf8');
  return '<script>\n' + js + '\n</script>';
});
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
