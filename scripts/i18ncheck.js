/* i18n 覆盖率检查（交接点评风险点2）
 * 背景：L('中文','English') 缺英文时静默回落中文，DN() 查不到 NAME_EN/NOTE_EN 也静默留中文，
 *       CI 完全不报错 → 英文界面混着中文没人发现。
 * 本脚本纯静态扫描，三项检查：
 *   1) src/*.js 里 L( 调用只有一个字符串参数（漏英文）
 *   2) src/index.html 里 data-zh 存在但 data-en 缺失的元素
 *   3) parts.js 全部配件 name/note 与 models 名称在 i18n.js 的 NAME_EN/NOTE_EN 表中是否有对应英文
 * 退出码：0=全过；1=有缺失（列明细）。可挂 CI / 提交前跑。
 * 用法：node scripts/i18ncheck.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let missing = 0;
function report(file, line, what) { missing++; console.log('  MISS ' + file + ':' + line + '  ' + what); }

/* ---------- 1) L() 单参数扫描 ---------- */
/* 匹配 L( 后跟一个字符串字面量然后直接 ) 的调用（即漏了第二个参数）。
   字符串里允许转义；两参数调用因存在逗号而不匹配。 */
const L_SINGLE = /L\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*\)/g;
const jsFiles = ['app.js', 'app2.js', 'i18n.js', '3d.js'].filter(f => fs.existsSync(path.join(ROOT, 'src', f)));
for (const f of jsFiles) {
  const src = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
  const lines = src.split('\n');
  lines.forEach((ln, i) => {
    /* 跳过注释行 */
    const t = ln.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    let m;
    L_SINGLE.lastIndex = 0;
    while ((m = L_SINGLE.exec(ln)) !== null) report('src/' + f, i + 1, 'L() 缺英文参数: ' + m[0].slice(0, 70));
  });
}

/* ---------- 2) index.html 的 data-zh / data-en 配对 ---------- */
const html = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
html.split('\n').forEach((ln, i) => {
  const t = ln.trim();
  if (t.startsWith('/*') || t.startsWith('*') || t.startsWith('//')) return;
  /* 逐个标签片段检查：含 data-zh（或 data-zh-title/data-zh-ph）但同标签内无对应 en 属性。
     注意属性值里可能出现 <br> 这类尖括号，正则必须先吃掉引号内的内容再找标签尾。 */
  const tags = ln.match(/<[a-zA-Z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*\/?>/g) || [];
  for (const tag of tags) {
    for (const [zhAttr, enAttr] of [['data-zh=', 'data-en='], ['data-zh-title=', 'data-en-title='], ['data-zh-ph=', 'data-en-ph=']]) {
      if (tag.includes(zhAttr) && !tag.includes(enAttr)) report('src/index.html', i + 1, zhAttr + ' 缺 ' + enAttr + ': ' + tag.slice(0, 80));
    }
  }
});

/* ---------- 3) 配件名/备注 英文表覆盖 ---------- */
const P = require(path.join(ROOT, 'src', 'parts.js'));
const i18nSrc = fs.readFileSync(path.join(ROOT, 'src', 'i18n.js'), 'utf8');
function extractMap(varName) {
  const m = i18nSrc.match(new RegExp('const ' + varName + ' = \\{([\\s\\S]*?)\\n  \\};'));
  if (!m) return new Set();
  return new Set([...m[1].matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)].map(x => x[1].replace(/\\"/g, '"')));
}
const NAME_EN = extractMap('NAME_EN'), NOTE_EN = extractMap('NOTE_EN');
/* 含中文的字符串才需要翻译；纯英文/数字型号名（如 "i7-12700KF"）原样即可 */
const hasCJK = s => /[\u4e00-\u9fff]/.test(s);
const allParts = [].concat(P.cpus, P.mobos, P.dimms, P.gpus, P.ssds, P.psus, P.coolers, P.cases);
for (const p of allParts) {
  if (hasCJK(p.name) && !NAME_EN.has(p.name)) report('src/parts.js', '-', 'NAME_EN 缺: ' + p.name);
  if (p.note && hasCJK(p.note) && !NOTE_EN.has(p.note)) report('src/parts.js', '-', 'NOTE_EN 缺: ' + p.note.slice(0, 50));
}
for (const mo of P.models) {
  if (hasCJK(mo.name) && !NAME_EN.has(mo.name)) report('src/parts.js', '-', 'NAME_EN 缺(model): ' + mo.name);
}

console.log(missing ? '\n===== i18n: ' + missing + ' 处缺英文 =====' : '===== i18n: 覆盖完整 ✓ =====');
process.exit(missing ? 1 : 0);
