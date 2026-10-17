# 贡献 3D 配件模型（Contributing 3D Assets）

模拟器默认用 **程序化几何**（Three.js 代码实时生成）渲染所有配件，零外部文件、秒开。
你也可以为任意配件添加一份 **GLB 模型**，加载后会自动替换该配件的程序化外形——
加载失败或缺文件时**静默回退**程序化，永不报错。

## 哪些配件适合加 GLB

只推荐给**没有动画依赖**的配件加 GLB：显卡、CPU、电源、SSD。
以下类别**建议保持程序化**，因为它们承载教学动画：

| 类别 | 程序化动画 | 是否建议 GLB |
|------|-----------|-------------|
| 主板 mobo | PCIe 槽按 `pcie_frac` 变色（绿/黄/红） | 否（会丢色条） |
| 内存 ram | RGB 灯条随 prefill/decode 呼吸 | 否 |
| 散热 cooler | 风扇旋转 + 水冷 RGB 环 | 否 |
| 机箱 case | 玻璃侧门开合 + 风扇阵列 | 否 |
| 显卡 gpu | 风扇旋转（GLB 会丢，但外形更真） | 可选 |
| CPU / 电源 / SSD | 无 | 推荐 |

## 添加流程（5 步）

### 1. 准备一张参考图（如果用 AI 生成模型）
- **纯白/浅灰无缝背景**，产品目录风格
- **45° 斜视角**，主体占画面 70–80%
- **不要**文字、logo、水印、人手、桌面杂物
- 背景若含地面/桌面，AI 会把它一起建成一块"平铺板"（常见坑）

### 2. 生成 GLB（可选，用任意工具）
本项目用腾讯 **混元3D 2.0**（图生3D，8GB 显存可跑）生成白模，也可用
Blender、Tripo、Rodin、Meshy 等任意来源，只要导出为 `.glb`。

### 3. 减面压缩（关键，务必执行）
AI 原始网格常 60 万面 / 10MB+，网页扛不住。用 [glTF-Transform](https://gltf-transform.dev/) 压到
**≤12 万面、≤500KB**：

```bash
npx @gltf-transform/cli weld in.glb tmp.glb
npx @gltf-transform/cli simplify --ratio 0.05 --error 1 tmp.glb out.glb
```

> ⚠️ **不要用 Draco 压缩**（`draco` 命令）。本项目的查看器/模拟器用纯 Three.js
> `GLTFLoader` 直读，未挂 `DRACOLoader`，Draco 文件会解析失败。
> `--error 1` 是放宽简化误差阈值，否则默认值太紧会"减不动"。

### 4. 放入仓库并登记
- 把 `out.glb` 放到 `assets/models/`，文件名用小写下划线，如 `gpu_rtx3090.glb`
- 编辑 `assets/manifest.js`，在 `parts` 里加一行：

```js
'rtx-3090': { glb: 'gpu_rtx3090.glb' },   // key = parts.js 里的配件 id
```

- 如果模型朝向不对（AI 生成朝向不定），加 `rot` 标定（仅 ±90° 整数倍）：

```js
'rtx-3090': { glb: 'gpu_rtx3090.glb', rot: [0, Math.PI / 2, 0] },
```

### 5. 本地验证
```bash
npm run serve      # 打开 http://localhost:8000/src/ ，切到 3D 视图
```
装配该配件，确认外形正确、朝向正确、无控制台报错。缺 GLB 文件时应自动显示程序化外形。

## 装配坐标约定

GLB 会被**非等比缩放**进配件的目标包围盒并对齐到装配锚点（见 `src/3d.js` 各
`build*()` 的 `userData.anchor` / `userData.fitBox`）。坐标系：

- **X** = 机箱深度（0 = 主板托盘侧，+ 朝侧透玻璃）
- **Y** = 上
- **Z** = + 朝机箱前面板

显卡已按真实朝向建模（PCB 长度沿 Z 前后、厚度沿 Y 向上、挡板在 Z 尾后窗）。
若你的 GLB 装进去方向歪了，用 `rot` 微调即可，不必改代码。

## 许可

提交的 GLB 请以 **CC0 / CC-BY** 或兼容 MIT 的许可授权，并在 PR 描述里注明来源
（AI 生成请注明模型，如 "Hunyuan3D 2.0" / "Tripo" / "Blender 手工建模"）。
