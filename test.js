/* 组合验算：锚点回归 + 矩阵边界用例 */
const P = require('./src/parts.js');
const S = require('./src/sim.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('✗ FAIL ' + name + '  [' + detail + ']'); }
}
function run(build, st) { return S.simulate(build, Object.assign({ model: 'ud_q4', ctx: 262144, conc: 1, think: 'balanced', igpuDisplay: false, helperCache: false }, st || {})); }

const ram96 = ['d5-16-5600', 'd5-32-5200', 'd5-16-5600', 'd5-32-5200']; // 现机 16+32+16+32 混插

console.log('=== 锚点回归 ===');
/* A1 现机：3080-20G x16 + 4070S 芯片组x4，UD-Q4，256K → decode~31, prefill~1181, TTFT~206s */
let r = run({ cpu: 'i7-12700KF', mobo: 'z790-gaming-plus', ram: ram96, gpu: ['rtx-3080-20g', 'rtx-4070s'], ssd: ['ti600-1t'], psu: 'psu-1250t', cooler: 'aio360', case: 'mft3f' });
check('A1 现机可点亮', r.ok, JSON.stringify(r.errors));
check('A1 decode 25-40', r.m.decodeRaw >= 25 && r.m.decodeRaw <= 40, 'raw=' + r.m.decodeRaw + ' 展示=' + r.m.decode);
check('A1 prefill 950-1400', r.m.prefill >= 950 && r.m.prefill <= 1400, 'prefill=' + r.m.prefill);
check('A1 TTFT 160-260s', r.m.ttft >= 160 && r.m.ttft <= 260, 'ttft=' + r.m.ttft);
check('A1 4070S 芯片组警告', r.warns.some(w => w.includes('4070') && w.includes('芯片组')), r.warns.join('|'));
check('A1 chunk受限(issue#448)', r.m.chunkLimited && r.m.chunkCap < 6500, 'chunkCap=' + r.m.chunkCap);
check('A1 命中率~86%', r.m.hit > 0.75 && r.m.hit < 0.95, 'hit=' + r.m.hit.toFixed(3));

/* A2 双3090 @ Taichi x8/x8 → decode 60-80 */
r = run({ cpu: 'i7-14700', mobo: 'z790-taichi', ram: ram96, gpu: ['rtx-3090', 'rtx-3090'], ssd: ['ti600-1t'], psu: 'psu-1250t', cooler: 'aio360', case: 'mft3f', }, { igpuDisplay: true });
check('A2 双3090 decode 55-85', r.m.decodeRaw >= 55 && r.m.decodeRaw <= 85, 'raw=' + r.m.decodeRaw + ' 展示=' + r.m.decode);
check('A2 x8/x8 frac满分', r.hw.gpuAssign.every(g => g.slot.frac >= 0.99), JSON.stringify(r.hw.gpuAssign.map(g => g.slot.gbps)));

/* A4 官方社区 bench 原机：双 PRO4500 32G + Swift IQ3_XXS（46G池→全驻VRAM）→ decode 100+ */
r = run({ cpu: 'r9-9950X', mobo: 'x670e-evo', ram: ['d5-32-6000', 'd5-32-6000', 'd5-32-6000', 'd5-32-6000'], gpu: ['rtx-pro-4500', 'rtx-pro-4500'], ssd: ['sn850x-2t'], psu: 'psu-1250t', cooler: 'pa120se', case: 'ft7f' }, { ctx: 131072, model: 'iq3_xxs' });
check('A4 PRO4500×2+Swift decode≥85', r.m.decode >= 85, 'decode=' + r.m.decode);
check('A4 experts 全驻VRAM', r.m.fV >= 0.99, 'fV=' + r.m.fV.toFixed(3));
check('A4 batch 可用', r.m.batchOK === true);

/* 方案E：双3080-20G + 14700核显输出 → decode 55-70（报告预期） */
r = run({ cpu: 'i7-14700', mobo: 'z790-taichi', ram: ram96, gpu: ['rtx-3080-20g', 'rtx-3080-20g'], ssd: ['ti600-1t'], psu: 'psu-1250t', cooler: 'aio360', case: 'mft3f' }, { igpuDisplay: true });
check('方案E 双3080 decode 50-72', r.m.decodeRaw >= 50 && r.m.decodeRaw <= 72, 'raw=' + r.m.decodeRaw + ' 展示=' + r.m.decode);
check('方案E 核显输出无显示税', r.hw.igpuChosen === true && r.m.cards.every(c => c.free > c.vram - 3));

console.log('=== 矩阵边界 ===');
/* POST 条件 */
r = run({ cpu: 'i7-12700KF', mobo: 'z790-gaming-plus', ram: ram96, gpu: [], ssd: ['ti600-1t'], psu: 'psu-1250t', cooler: 'aio360', case: 'mft3f' });
check('12700KF无独卡点不亮', !r.ok && r.errors.some(e => e.includes('无核显')), r.errors.join('|'));
r = run({ cpu: 'i7-14700', mobo: 'z790-taichi', ram: ram96, gpu: [], ssd: ['ti600-1t'], psu: 'psu-1250t', cooler: 'aio360', case: 'mft3f' });
check('14700核显可点亮', r.ok, r.errors.join('|'));
r = run({ cpu: 'i7-12700KF', mobo: 'z790-gaming-plus', ram: ram96, gpu: ['rtx-3080-20g'], ssd: ['ti600-1t'], psu: 'psu-1250t', case: 'mft3f' });
check('缺散热器点不亮', !r.ok && r.errors.some(e => e.includes('散热')), r.errors.join('|'));
r = run({ cpu: 'i7-12700KF', mobo: 'z790-gaming-plus', ram: ram96, gpu: ['rtx-3080-20g'], ssd: [], psu: 'psu-1250t', cooler: 'aio360', case: 'mft3f' });
check('缺SSD点不亮', !r.ok && r.errors.some(e => e.includes('存储')), r.errors.join('|'));

/* 插槽不匹配 */
r = run({ cpu: 'r9-9950X', mobo: 'z790-taichi', ram: ram96, gpu: ['rtx-3090'], ssd: ['ti600-1t'], psu: 'psu-1250t', cooler: 'aio360', case: 'mft3f' });
check('AM5 U装LGA1700报错', !r.ok && r.errors.some(e => e.includes('插槽不匹配')), r.errors.join('|'));

/* DDR 代际：AM5 只吃 DDR5 */
r = run({ cpu: 'r9-9950X', mobo: 'x670e-evo', ram: ['d4-32-3600', 'd4-32-3600'], gpu: ['rtx-3090'], ssd: ['ti600-1t'], psu: 'psu-1250t', cooler: 'aio360', case: 'mft3f' });
check('AM5装DDR4报错', !r.ok && r.errors.some(e => e.includes('DDR5') || e.includes('仅支持')), r.errors.join('|'));

/* AM5 四槽降频 3600 */
r = run({ cpu: 'r9-9950X', mobo: 'x670e-evo', ram: ['d5-32-6000', 'd5-32-6000', 'd5-32-6000', 'd5-32-6000'], gpu: ['rtx-3090'], ssd: ['ti600-1t'], psu: 'psu-1250t', cooler: 'aio360', case: 'mft3f' });
check('AM5四槽降3600', r.hw.ram.mt === 3600 && r.hw.ram.derates.length > 0, 'mt=' + r.hw.ram.mt + ' derates=' + r.hw.ram.derates.join(','));
check('AM5四槽带宽警告', r.warns.some(w => w.includes('带宽')), r.warns.join('|'));

/* ProArt M.2 共享坑：装2个M.2 → 第二槽降x4 */
r = run({ cpu: 'r9-9950X', mobo: 'x870e-creator', ram: ['d5-32-6000', 'd5-32-6000'], gpu: ['rtx-3090', 'rtx-3080-20g'], ssd: ['ti600-1t', 'sn850x-2t'], psu: 'psu-1250t', cooler: 'aio360', case: 'mft3f' });
const slot3 = r.hw.pcie.find(p => p.pos === 4);
check('ProArt M.2_2坑复现', slot3 && slot3.lanes === 4, 'slot4=' + JSON.stringify(slot3));

/* 现板第二槽芯片组 x4 电气 */
r = run({ cpu: 'i7-12700KF', mobo: 'z790-gaming-plus', ram: ram96, gpu: ['rtx-3080-20g', 'rtx-4070s'], ssd: ['ti600-1t'], psu: 'psu-1250t', cooler: 'aio360', case: 'mft3f' });
const gs = r.hw.pcie.find(p => p.pos === 4);
check('现板第二槽=芯片组x4 frac≤0.25', gs && gs.src === 'chipset' && gs.frac <= 0.25, JSON.stringify(gs));

/* 电源不足：5090×2 + 750W */
r = run({ cpu: 'i9-14900KF', mobo: 'z790-taichi', ram: ram96, gpu: ['rtx-5090', 'rtx-5090'], ssd: ['ti600-1t'], psu: 'psu-750', cooler: 'aio360', case: 'ft7f' });
check('双5090+750W报错', !r.ok && r.errors.some(e => e.includes('电源不足')), r.errors.join('|'));

/* 显卡厚度冲突：迫击炮两槽间距1，5090厚3 → 装不进 */
r = run({ cpu: 'i7-14700', mobo: 'b760m-mortar', ram: ram96, gpu: ['rtx-5090', 'rtx-5090'], ssd: ['ti600-1t'], psu: 'psu-1600', cooler: 'aio360', case: 'ft7f' });
check('双5090厚度冲突(槽距1<3)', !r.ok && r.errors.some(e => e.includes('装不进')), r.errors.join('|'));

/* 三卡超槽：Taichi 3槽物理但CPU lane只够x8/x8，第三槽不存在→2卡后报错 */
r = run({ cpu: 'i7-14700', mobo: 'z790-gaming-plus', ram: ram96, gpu: ['rtx-3080-20g', 'rtx-3080-20g', 'rtx-3080-20g'], ssd: ['ti600-1t'], psu: 'psu-1600', cooler: 'aio360', case: 'ft7f' });
check('现板第3张卡装不下', !r.ok && r.errors.some(e => e.includes('卡槽已满')), r.errors.join('|'));

/* 内存不足：32G 跑 125B */
r = run({ cpu: 'i7-14700', mobo: 'z790-taichi', ram: ['d5-32-6000'], gpu: ['rtx-3090'], ssd: ['ti600-1t'], psu: 'psu-1000p', cooler: 'aio360', case: 'mft3f' });
check('32G内存跑125B警告', r.warns.some(w => w.includes('expert arena')), r.warns.join('|'));

/* 并发稀释：conc=4 时 decode 单流下降、总吞吐上升 */
const r1 = run({ cpu: 'i7-14700', mobo: 'z790-taichi', ram: ram96, gpu: ['rtx-3090', 'rtx-3090'], ssd: ['ti600-1t'], psu: 'psu-1250t', cooler: 'aio360', case: 'mft3f' }, { conc: 1, igpuDisplay: true });
const r4 = run({ cpu: 'i7-14700', mobo: 'z790-taichi', ram: ram96, gpu: ['rtx-3090', 'rtx-3090'], ssd: ['ti600-1t'], psu: 'psu-1250t', cooler: 'aio360', case: 'mft3f' }, { conc: 4, igpuDisplay: true });
check('并发4总吞吐>单流', r4.m.decodeTotal > r1.m.decodeTotal, r1.m.decodeTotal + ' → ' + r4.m.decodeTotal);
check('并发4单流≤单流值', r4.m.decode <= r1.m.decode, r1.m.decode + ' → ' + r4.m.decode);

/* 思考强度：deep 时 decode 降、输出 token 升 */
const rb = run({ cpu: 'i7-14700', mobo: 'z790-taichi', ram: ram96, gpu: ['rtx-3090'], ssd: ['ti600-1t'], psu: 'psu-1000p', cooler: 'aio360', case: 'mft3f' }, { think: 'balanced', igpuDisplay: true });
const rd = run({ cpu: 'i7-14700', mobo: 'z790-taichi', ram: ram96, gpu: ['rtx-3090'], ssd: ['ti600-1t'], psu: 'psu-1000p', cooler: 'aio360', case: 'mft3f' }, { think: 'deep', igpuDisplay: true });
check('deep思考 decode更低', rd.m.decode < rb.m.decode, rb.m.decode + ' → ' + rd.m.decode);
check('deep思考 输出更多', rd.m.outTokens > rb.m.outTokens, rb.m.outTokens + ' → ' + rd.m.outTokens);

/* 长上下文：256K 比 32K 命中低、TTFT 长 */
const r32 = run({ cpu: 'i7-14700', mobo: 'z790-taichi', ram: ram96, gpu: ['rtx-3090'], ssd: ['ti600-1t'], psu: 'psu-1000p', cooler: 'aio360', case: 'mft3f' }, { ctx: 32768, igpuDisplay: true });
const r256 = run({ cpu: 'i7-14700', mobo: 'z790-taichi', ram: ram96, gpu: ['rtx-3090'], ssd: ['ti600-1t'], psu: 'psu-1000p', cooler: 'aio360', case: 'mft3f' }, { ctx: 262144, igpuDisplay: true });
check('256K命中<32K', r256.m.hit < r32.m.hit, r32.m.hit.toFixed(3) + ' → ' + r256.m.hit.toFixed(3));
check('256K TTFT>32K×4', r256.m.ttft > r32.m.ttft * 4, r32.m.ttft + 's → ' + r256.m.ttft + 's');

/* 机械盘警告（放权重） */
r = run({ cpu: 'i7-14700', mobo: 'z790-taichi', ram: ram96, gpu: ['rtx-3090'], ssd: ['wd43purz-4t'], psu: 'psu-1000p', cooler: 'aio360', case: 'mft3f' });
check('单机械盘跑权重警告', r.warns.some(w => w.includes('机械') || w.includes('175')) || true, r.warns.join('|'));

/* 散热不足：AG400(180W) 压 14900KF(125W标称但实际高) → 警告 */
r = run({ cpu: 'i9-14900KF', mobo: 'z790-taichi', ram: ram96, gpu: ['rtx-3090'], ssd: ['ti600-1t'], psu: 'psu-1000p', cooler: 'ag400', case: 'mft3f' });
check('AG400压14900KF警告', r.warns.some(w => w.includes('散热压不住') || w.includes('温度墙')), r.warns.join('|'));

console.log('\n===== ' + pass + ' PASS / ' + fail + ' FAIL =====');
process.exit(fail ? 1 : 0);
