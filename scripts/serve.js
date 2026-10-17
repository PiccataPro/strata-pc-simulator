/* 本地开发服务器 · 零依赖（不装任何包也能跑）
 * 用法：node scripts/serve.js [端口] [--no-open]     或   npm run serve
 *
 * 为什么服务根必须是「仓库根目录」而不是 src/：
 *   src/index.html 里 importmap 指向 ../vendor/three.module.js，manifest 的
 *   baseUrl 是 ../assets/models/。把 src/ 当服务根，这两个路径会 404，
 *   结果是 3D 模块加载失败 + GLB 资产全部回退成程序化几何（而且不报错）。
 *   README 早期写的 `npx http-server src` 就是这个坑。
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = '/src/index.html';

const argv = process.argv.slice(2);
const wantOpen = !argv.includes('--no-open');
const portArg = argv.find(a => /^\d+$/.test(a));
const startPort = Number(portArg || process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
};

function openBrowser(u) {
  const cmd = process.platform === 'win32'
    ? { file: 'cmd', args: ['/c', 'start', '', u] }
    : process.platform === 'darwin'
      ? { file: 'open', args: [u] }
      : { file: 'xdg-open', args: [u] };
  try {
    require('child_process')
      .spawn(cmd.file, cmd.args, { detached: true, stdio: 'ignore' })
      .on('error', () => {})            // 无 GUI / 沙箱受限：静默跳过，不影响服务
      .unref();
  } catch (_) { /* 同上 */ }
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  } catch (_) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('400 Bad Request');
  }

  if (pathname === '/' || pathname === '') {
    res.writeHead(302, { Location: ENTRY });
    return res.end();
  }

  const file = path.normalize(path.join(ROOT, pathname));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 Forbidden');
  }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      const isAsset = /[\\/](vendor|assets)[\\/]/.test(pathname);
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(
        '404 Not Found: ' + pathname + '\n' +
        (isAsset
          ? '这是 vendor/assets 资源。请用仓库根目录作为服务根启动（npm run serve），不要把 src/ 当根目录。\n当前根目录：' + ROOT + '\n'
          : '')
      );
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-store',      // 开发期不吃缓存，改完刷新就生效
    });
    fs.createReadStream(file).pipe(res);
  });
});

function listen(port, tries) {
  const onError = e => {
    if (e.code === 'EADDRINUSE' && tries > 0) {
      console.log('  端口 ' + port + ' 被占用，换 ' + (port + 1) + ' …');
      return listen(port + 1, tries - 1);
    }
    console.error('启动失败：' + e.message);
    process.exit(1);
  };
  server.once('error', onError);
  server.listen(port, '127.0.0.1', () => {
    server.removeListener('error', onError);
    server.on('error', e => console.error('server error: ' + e.message));
    const u = 'http://127.0.0.1:' + port + ENTRY;
    console.log('');
    console.log('  Strata 装机模拟器 · 本地开发');
    console.log('  → ' + u);
    console.log('  服务根目录 ' + ROOT);
    console.log('  Ctrl+C 停止');
    console.log('');
    if (wantOpen) openBrowser(u);
  });
}

listen(startPort, 10);
