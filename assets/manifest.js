/* Strata 装机模拟器 · 3D 资产清单（社区贡献入口）
 * ------------------------------------------------------------------
 * 每个条目 = 一个可选的 GLB 模型，覆盖对应 parts.js 配件 id 的程序化几何。
 * 缺文件 / 加载失败 → 自动回退程序化建模，永不报错。
 * 添加新模型请同步在 docs/CONTRIBUTING-ASSETS.md 登记流程。
 *
 * 字段：
 *   glb    相对 baseUrl 的文件名（.glb，建议 ≤500KB、≤120k 三角面、无 Draco）
 *   rot    可选预旋转标定 [x,y,z] 弧度（AI 生成模型朝向不定，用于对齐装配位；
 *          仅允许 0 或 ±Math.PI/2 的整数倍，非等比缩放前生效）
 *   noGlb  true = 强制程序化（机箱等含动画交互的类别）
 */
window.STRATA_ASSETS = {
  baseUrl: '../assets/models/',

  /* parts.js 配件 id → 模型文件。
   * 只覆盖"无动画依赖"的类别（显卡/CPU/电源）：主板 PCIe 槽 frac 色条、
   * 内存 RGB 呼吸、散热风扇旋转是模拟器教学动画核心，保留程序化建模。 */
  parts: {
    /* 显卡白模朝向重标定（2026-10-18，glb_out/calib_gpu.mjs 实测）：
       白模原始轴 = X 卡长 / Y 厚度 / Z 卡高，绕 Y 转 90°（rot=[0,π/2,0]）后
       最长边→Z(卡长)、次长→X(卡高)、最短→Y(厚度)，与 fitBox(HGT×th×len) 对齐，
       三轴缩放比接近真实卡比例（4070S 长/高=2.0 vs 真卡 2.31），不会拉歪。
       注意：白模无贴图，启用后替换程序化显卡（含导风罩贴图+旋转风扇），
       是否更真实以 scripts/shot.js 截图实测为准。 */
    /* 显卡 A/B 终局（铭铭 2026-10-18 两轮实测）：程序化版补齐写实贴图（背板/导风罩/扇毂/型号丝印/RGB）后，
       贴图与几何严丝合缝；GLB 白模形状不规整（斜放/起伏撑大包围盒），浮贴对不齐且纯色无贴图 → 全部回退程序化。
       白模备份在 ../glb_out/simp05/（gpu_rtx3080_20g / gpu_rtx4070s），混元3D 适合圆润大件不适合精密装配件。 */
    'rtx-3080-20g': { noGlb: true },
    'rtx-3080-10g': { noGlb: true },
    'rtx-4070s':    { noGlb: true },
    /* ---- CPU 白模（圆润大件，混元3D 适用；2026-10-19 扩至全平台）----
     * LGA1700（Intel 12/13/14 代，正方形 45×45 单顶盖）共用 cpu_lga1700.glb，默认朝向。
     * AM5（AMD 7/9 代，正方形 40×40 + 顶边双三角防呆缺口）用专属 cpu_am5.glb：
     *   白模原始轴 = X/Z 平面（45×45 方片）、Y 厚度（混元按 45° 斜俯视参考图生成，
     *   平面落在 XZ）。fitBox 是 {x:6 厚, y:45, z:45}（平面在 YZ、厚度在 X），
     *   故绕 Z 转 -90°（rot=[0,0,-π/2]）：原 Y 厚度→新 X、原 X 平面→新 Y、原 Z 不变，
     *   三轴对齐；-90°（而非 +90°）让 IHS 顶面法线落 +X（侧透可见面，与蚀刻贴图同侧）。
     * AM4（长方形带两侧耳）/TRX4/SP3（HEDT 大顶盖）形状与消费级白模差异大，保持程序化。
     * IHS 蚀刻型号贴图由 buildCPU 的 postGlbDecal 在白模加载后浮挂 +X 面（叠加细节）。 */
    'i3-12100':     { glb: 'cpu_lga1700.glb' }, 'i3-12100F':    { glb: 'cpu_lga1700.glb' },
    'i5-12400':     { glb: 'cpu_lga1700.glb' }, 'i5-13400F':    { glb: 'cpu_lga1700.glb' },
    'i5-13600KF':   { glb: 'cpu_lga1700.glb' }, 'i5-14400F':    { glb: 'cpu_lga1700.glb' },
    'i5-14600KF':   { glb: 'cpu_lga1700.glb' }, 'i7-12700KF':   { glb: 'cpu_lga1700.glb' },
    'i7-13700KF':   { glb: 'cpu_lga1700.glb' }, 'i7-14700K':    { glb: 'cpu_lga1700.glb' },
    'i7-14700':     { glb: 'cpu_lga1700.glb' }, 'i9-12900KS':   { glb: 'cpu_lga1700.glb' },
    'i9-13900KF':   { glb: 'cpu_lga1700.glb' }, 'i9-14900K':    { glb: 'cpu_lga1700.glb' },
    'i9-14900KF':   { glb: 'cpu_lga1700.glb' },
    'r5-7600X':     { glb: 'cpu_am5.glb', rot: [0, 0, -Math.PI / 2] },
    'r5-9600X':     { glb: 'cpu_am5.glb', rot: [0, 0, -Math.PI / 2] },
    'r7-7700':      { glb: 'cpu_am5.glb', rot: [0, 0, -Math.PI / 2] },
    'r7-7800X3D':   { glb: 'cpu_am5.glb', rot: [0, 0, -Math.PI / 2] },
    'r7-9700X':     { glb: 'cpu_am5.glb', rot: [0, 0, -Math.PI / 2] },
    'r7-9800X3D':   { glb: 'cpu_am5.glb', rot: [0, 0, -Math.PI / 2] },
    'r9-7900X':     { glb: 'cpu_am5.glb', rot: [0, 0, -Math.PI / 2] },
    'r9-7950X':     { glb: 'cpu_am5.glb', rot: [0, 0, -Math.PI / 2] },
    'r9-9900X':     { glb: 'cpu_am5.glb', rot: [0, 0, -Math.PI / 2] },
    'r9-9900X3D':   { glb: 'cpu_am5.glb', rot: [0, 0, -Math.PI / 2] },
    'r9-9950X':     { glb: 'cpu_am5.glb', rot: [0, 0, -Math.PI / 2] },
    'r9-9950X3D':   { glb: 'cpu_am5.glb', rot: [0, 0, -Math.PI / 2] },
    /* ---- 电源白模（标准 ATX 盒体 150×85×len，圆润大件通用；len 随功率 fitBox 自适应）----
     * psu_atx.glb 按 AX1200i 参考图生成，海盗船系挂 AX1200i 铭牌（postGlbDecal 品牌分流），
     * 非海盗船电源挂白模素面（程序化标签灯被隐藏，比张冠李戴印错标更稳）。 */
    'psu-550':        { glb: 'psu_atx.glb' }, 'psu-650bm':      { glb: 'psu_atx.glb' },
    'psu-750':        { glb: 'psu_atx.glb' }, 'psu-750atx31':   { glb: 'psu_atx.glb' },
    'psu-850g':       { glb: 'psu_atx.glb' }, 'psu-850atx31':   { glb: 'psu_atx.glb' },
    'psu-1000p':      { glb: 'psu_atx.glb' }, 'psu-1000atx31':  { glb: 'psu_atx.glb' },
    'psu-1200g':      { glb: 'psu_atx.glb' }, 'psu-1250t':      { glb: 'psu_atx.glb' },
    'psu-1600':       { glb: 'psu_atx.glb' },
    // 强制程序化（动画/教学要素密集）：
    // 散热塔实测：混元3D 双塔 GLB 会把薄鳍片糊成金属团、且一体件替换掉旋转风扇（见 scripts/probe_cooler_glb.cjs A/B），
    // 程序化版鳍片清晰+风扇转，观感更好 → 全部散热保持程序化（GLB 备份在 ../glb_out/simp05/cooler_tower.glb）。
    ft7f: { noGlb: true }, mft3f: { noGlb: true }, trx40: { noGlb: true }, iq2_xs: { noGlb: true },
    aio360: { noGlb: true }, ag400: { noGlb: true }, d15: { noGlb: true }, pa120se: { noGlb: true },
  },

  /* 装配目标盒（mm）参考——实际锚点/盒尺寸由 3d.js 各 build*() 的
   * userData.anchor / userData.fitBox 提供，此处仅为文档说明：
   *   gpu: 厚×20 宽 × 112 高 × len 长，锚点=卡几何中心
   *   cpu: 6 × 45 × 45，锚点=IHS 中心
   *   psu: 150 × 85 × (140+w/200*12)，锚点=盒中心 */

  /* 材质映射：AI 白模无贴图，按类别套用场景 PBR 材质（3d.js 内实现） */
  material: {
    gpu: 'aluDark', mobo: 'pcbMobo', cpu: 'nickel',
    ram: 'aluDark', cooler: 'alu', psu: 'steelDark',
  },
};
