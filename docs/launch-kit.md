# 发布工具包 · Launch Kit

> 直接复制粘贴即可。**发布前请先自己打开一遍 Demo**，确认能玩。
> 原则：先讲"我遇到的问题"，再讲"我做了什么"。没人点开一个自我介绍，大家点开的是自己的问题。

---

## 0. 一句话定位（所有平台通用）

- 中文：**给本地大模型装机的模拟器**——拖配件、按开机，看解码速度、首字延迟、显存驻留怎么变。
- English：**A 3D PC builder that predicts your local LLM tokens/sec.**

---

## 1. Hacker News · Show HN

**发布时机**：北京时间 21:00–23:00（美东上午 9–11 点），周二到周四最好。

**Title**（选一个，≤80 字符）：

```
Show HN: A 3D PC builder that predicts your local LLM tokens/sec
```

**正文**（第一段必须说清"为什么做"）：

```
I kept getting asked "which GPU should I buy to run a 125B MoE locally", and I kept giving
answers I wasn't sure about. PCIe bifurcation, expert offload tiers, prompt chunk limits —
the interactions are not something you can reason about in your head.

So I built a simulator: drag real parts into a 3D case, press power, and decode/prefill/TTFT/
VRAM residency/thermals respond to both the hardware and the inference settings.

It's calibrated against two measured machines plus community benchmarks, and the two timing
constants are solved analytically from those anchors rather than curve-fitted. `npm test` runs
36 checks including anchor regressions, so the model can't silently drift.

The most useful thing it told me: a second GPU in a chipset x4 slot can make the whole machine
slower than a single card. Numbers and reasoning here:
https://github.com/PiccataPro/strata-pc-simulator/blob/main/docs/blog/2026-10-why-dual-gpu-slower.en.md

Vanilla JS + Three.js, no runtime dependencies, single-file build works offline.
Live demo: https://piccatapro.github.io/strata-pc-simulator/
```

**自己先回一条评论**（补充技术细节，也把讨论引到正确的地方）：

```
Some implementation notes people usually ask about:

- The 3D scene is fully procedural (boxes + cylinders), ~14k triangles, no GLB assets required.
  I wrote a separate CPU rasterizer (scripts/render3d.js) that renders the same geometry without
  WebGL, plus scripts/audit3d.js which reports per-mesh AABBs, out-of-bounds parts, real
  intersections and cable routing. That's how the geometry got fixed without me eyeballing it.
- The build is a single HTML file with Three.js inlined, so it works from file:// offline.
- Prices are a 2026-10 second-hand market snapshot in CNY and go stale fast; treat them as
  relative guidance only.
```

---

## 2. Reddit · r/LocalLLaMA

**Title**：

```
I built a 3D PC-building simulator that predicts local LLM tokens/sec (calibrated against real machines)
```

**正文**：

```
Context: I run a 125B MoE locally and kept making bad hardware decisions. The one that finally
annoyed me: I added a second GPU on a chipset x4 slot and my decode got *worse*.

So I wrote a simulator. Drag parts into a case (real specs: VRAM bandwidth, SM count, PL2, slot
thickness, PCIe bifurcation tables), press power, and watch decode / prefill / TTFT / expert
residency / thermals react — to the hardware *and* to inference settings (quantisation, context,
concurrency, thinking effort).

Calibration: two measured machines + community bench results. The model has two timing constants
solved analytically from those anchors; `npm test` fails if the simulated numbers drift out of the
measured bands.

What it's good for: comparing choices ("x8/x8 vs chipset x4", "4 DIMMs vs 2", "24G vs 2×16G").
What it's not: a benchmark. ±20% on absolutes.

Demo (no install): https://piccatapro.github.io/strata-pc-simulator/
Repo: https://github.com/PiccataPro/strata-pc-simulator
Write-up on the x4 thing: docs/blog/2026-10-why-dual-gpu-slower.en.md

Happy to add anchors — if you have a bench result with a known hardware config, post it and I'll
calibrate against it.
```

> 结尾那句是钩子：**邀请对方贡献数据**，比"求 star"有效 10 倍。

---

## 3. V2EX · 分享创造

**标题**：

```
[分享创造] 做了个装机模拟器：装一台跑本地大模型的机器，先看清楚能跑多快
```

**正文**：

```
起因是自己升级机器时踩了坑：第二张卡插在芯片组 x4 槽，整机反而更慢了。

于是把 MoE 推理的时间模型写成可交互的：拖配件 → 开机 → 看 decode / prefill / 首字延迟 /
专家驻留 / 温度功耗怎么变。硬件和推理参数都能调（量化档位、上下文长度、并发、思考强度）。

模型不是拍脑袋：常数是从两台真机实测 + 官方社区 bench 反解出来的，npm test 里有 36 项
校验，其中包含锚点回归，数字漂了会红。

技术上：原生 JS + Three.js，零运行时依赖，可以内联成单个 HTML 离线跑。
另外写了两个工具脚本：一个 CPU 软光栅（不开 WebGL 也能出图），一个几何审计
（逐网格 AABB / 越界 / 真穿模 / 走线穿模）——模型的几何就是靠它一个个修出来的。

在线试：https://piccatapro.github.io/strata-pc-simulator/
仓库：https://github.com/PiccataPro/strata-pc-simulator

欢迎拍砖，尤其是标定数据。如果你有实测的 decode 数字 + 硬件配置，我可以加进锚点。
```

---

## 4. B 站 / 小红书 / 抖音（60 秒竖屏脚本）

| 时间 | 画面 | 字幕 |
|---|---|---|
| 0–3s | 3D 机箱转一圈，玻璃反光 | 装一台能跑本地大模型的机器，先看清楚它能跑多快 |
| 3–12s | 从右侧拖一张 4090 进机箱，卡落位 | 拖进去就是装上，参数全是真的 |
| 12–22s | 按「启动」，风扇转，仪表盘数字跳 | 开机：解码速度、首字延迟、显存驻留全在动 |
| 22–35s | 把卡从绿色槽拖到红色槽（芯片组） | 同样两张卡，插错槽 → 整机慢 30% |
| 35–48s | 跑分浮层出分 | 一键跑分，同配置横向比 |
| 48–60s | 回到全貌，二维码/网址 | 开源免费，浏览器直接开 |

> 竖屏录制：浏览器窗口压到 900×1600 左右再录，或直接用手机拍屏幕。

---

## 5. 发布节奏（不要一次全发）

| 时间 | 动作 |
|---|---|
| D0 上午 | 发 Reddit r/LocalLLaMA（最容易起量的地方），盯 2 小时回评论 |
| D0 晚 21:30 | 发 Hacker News（Show HN） |
| D1 | 发 V2EX + 知乎（同一篇技术文，改标题） |
| D2 | B 站/小红书短视频 |
| D3+ | 回复所有评论；把有价值的质疑整理进 README 的 FAQ |

**Reddit 和 HN 不要在 24 小时内同时发**，两边受众重叠，第二次会被当成 spam。

---

## 6. 预期质疑 & 回复话术

**Q: 这模型凭什么准？**
> 不准。它是相对比较工具，绝对值 ±20%。两个时间常数是从两台真机的实测 decode/prefill 反解
> 的，`npm test` 里有锚点回归保证不漂。你要绝对数字，去跑 llama.cpp。

**Q: 为什么不直接用 llama.cpp 的 bench？**
> 因为我想在**买之前**知道。bench 要机器已经在手上。

**Q: 配件数据哪来的？**
> 厂商规格页 + 二手市场价格快照（2026-10，CNY）。价格会过期，当相对参考。

**Q: 为什么不用 React / 为什么这么土？**
> 单文件离线可用是硬需求。零依赖意味着十年后双击还能开。

**Q: 有手机版吗？**
> 能开，但拖拽体验是桌面优先的。手机上主要是看。

---

## 7. 不要做的事

- ❌ 群发"求 star"。冷启动阶段，一条真诚的技术回复比一百个 star 有用。
- ❌ 在 HN 标题里写 "revolutionary" / "AI-powered"。会被直接略过。
- ❌ 用真实品牌 logo 做素材（商标风险）。项目里是自造的 "Strata" 品牌，保持这样。
- ❌ 贴 AI 生成的"效果图"当截图。真实录屏才是可信度。
