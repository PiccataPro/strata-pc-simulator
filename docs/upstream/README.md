# 与官方 Strata 建立联系 · 可行路径

> 结论：**能，而且不必靠"求个链接"。** 官方有一个现成的社区实测通道，走它比任何自我推销都有效。

## 先说清楚官方是什么状态（2026-10-18 查）

| 项 | 数值 | 含义 |
|---|---|---|
| `Niko1221/Strata` | **26,718 star / 2,802 fork** | 项目很火，你不是在跟一个小仓库打交道 |
| 未关闭 issue | **1,193** | 维护者被淹了，任何"看看我的项目"都会被淹掉 |
| Discussions | **未开启** | 没有闲聊区，只有 issue 和 PR |
| 最近提交 | 2026-10-17 | 非常活跃 |
| 许可证 | MIT | 允许衍生、允许引用 |

**他们已经知道 x4 的坑**，而且比我们写得细：

- `docs/MULTI_GPU.md` 第 11 行：`cards on x4 or x1 slots work, and the PCIe share of each card is probed on its own link`，并且有 `--pcie-frac` 参数；
- 第 80 行：x16 + x4 的实测（#2007 / #2418），`114-119 tok/s` vs `130-136 tok/s`。

**所以别去给他们科普 x4。** 我们真正的位置是：**买之前先算一遍的那一层**。他们的文档是"跑完怎么调"，我们的是"跑之前买什么"。

## 三种联系，按成功率排序

### ① 提交一份社区实测报告（最正规，他们明确欢迎）

`docs/COMMUNITY_BENCHMARKS.md` 开头原话：

> Share measurements from your own hardware so other users can judge how Strata might run on a similar machine… **a single model, GPU, or context length is enough to contribute.**

流程固定：`BENCH.bat` / `./bench.sh` 产出报告 → 放进 `bench/results/<日期>-community-<机器>/` → 开 PR。

你的机器（12700KF + 3080-20G x16 + 4070S 芯片组 x4，96G）正好是他们文档里**最缺的那类样本**：x16 + x4 混合链路、显存不对称。贡献一次，你的名字就会出现在他们的社区报告列表里——这是"贡献者"，不是"来推广的"。

→ 模板已备好：`bench-report-template/README.md`

### ② 补一条他们文档里没有的：**预估 vs 实测**

他们的 `docs/MULTI_GPU.md` 有实测，但没有"如果你还没买，怎么估"。

我们可以提 PR 加一节，内容只讲方法、附一张对照表（我们的估算 vs 他们公开的实测），并在脚注指向模拟器。**技术含量足够，推销成分接近零。**

### ③ issue 里问一句（最轻，也最容易石沉大海）

在 `How fast is it?` 段落里，他们说：

> A card with more VRAM is faster… **Long chats and other cards:** [speed of each model](docs/MODELS.md#how-fast-is-each-size), [community results](docs/COMMUNITY_BENCHMARKS.md).

这里天然缺一个"没测过的卡怎么办"。可以提 issue 问：**能不能在这里加一句估算器链接。**

但 1,193 个未关 issue 的现实是：**先有 ① 或 ② 打底，③ 才有回音。** 顺序不能反。

## 我们和官方概念的对应（证明读过他们的东西）

| Strata | 模拟器 | 备注 |
|---|---|---|
| `--pcie-frac`（每卡链路探测） | `frac`（由槽位电气带宽推：x16 Gen4 31.5GB/s→1.00，芯片组 x4 7.9→0.25） | 同一个量纲 |
| 专家三级驻留（VRAM/RAM/disk） | `fV / fR / fD` | |
| link-miss scaling（#2007，4× 差距） | `K2 / pcieEff` 项 | |
| prompt chunk 上限（#448） | `chunkCap` | 已在 `src/sim.js` 注释引用 |
| batch 路径（#776） | `batchOK` | 同上 |
| `--split-overlap` 流水重叠 | `dual` 分支的 1.15 增益 | A3 锚点 1244→1776 |

## 不要做的事

- ❌ 不要在别人的 issue 下面贴"我做了个模拟器"。1193 个 issue 的仓库里，这等于自绝后路。
- ❌ 不要一次 PR 同时改文档 + 加链接 + 改 README。维护者只会有空看第一个文件。
- ❌ 不要在标题里带 "unofficial" 之外的品牌联想。我们已经在 README 里写明 **not affiliated**，这条要一直保持。

## 执行顺序

```
今天   README 标注 unofficial + 链接官方        ✅ 已完成
本周   在你自己机器上跑 BENCH.bat，把结果给我   ← 需要你
然后   我按官方格式整理 → 你开 PR               ← 你点一下
之后   补 MULTI_GPU 的「预估 vs 实测」小节      ← 我写，你提
最后   才考虑 issue 里那条链接
```
