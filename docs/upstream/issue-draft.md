# Issue 草稿（英文，可直接粘贴）

> 用途：在 `Niko1221/Strata` 提 **一个问题**，不是宣传。
> 建议时机：**在 ① 社区实测报告 PR 合并之后**再发；没打过交道的账号第一次就贴链接，容易被当推广。
> 提之前请自己读一遍，改掉任何不像你的口吻。

---

**Title**

```
Question about docs: where should "which hardware should I buy" live?
```

**Body**

```md
Not a bug — a docs question.

`How fast is it?` already covers two measured machines and links to
`MODELS.md#how-fast-is-each-size` and `COMMUNITY_BENCHMARKS.md`. What it doesn't
cover is the question I see asked constantly on r/LocalLLaMA and in issues here:
*"my card isn't in the table — will it be faster or slower, and does the second
card's slot matter?"*

I ended up building a small open-source calculator for exactly that
(3D PC builder + timing model, calibrated against the anchors in DETAILS.md and
the community reports):

- demo: https://piccatapro.github.io/strata-pc-simulator/
- source: https://github.com/PiccataPro/strata-pc-simulator
- it models per-card PCIe `frac` the same way `--pcie-frac` describes it, and
  reproduces the x16+x4 trend from #2007 / #2418 at the level of "second card on
  a chipset slot costs you X% decode"

Two questions:

1. Would a single link in `How fast is it?` next to "other cards" be welcome, or
   do you prefer to keep external tools out of the README?
2. Would it be more useful as a docs page (`docs/ESTIMATING.md`) with a worked
   example and a table comparing estimates against the published measurements —
   i.e. something that lives in this repo rather than pointing outward?

If neither fits, that's a completely fine answer — close this and I'll keep it as
a standalone community tool. I'd rather ask than add noise to a 1000-issue queue.

Context on what it was calibrated against: two measured machines plus the
`bench/results/` reports; the two timing constants are solved analytically from
those anchors, not curve-fitted, and `npm test` fails if the simulated numbers
leave the measured bands.
```

---

## 如果要直接提 PR（② 路线），改这个

**文件**：`docs/MULTI_GPU.md`，插在 `## Measured` 之前。

**新增小节**（英文原文，保持他们文档的语气：克制、只讲事实）：

```md
## Estimating before you buy

The measurements above need the cards in hand. For the "should I put the second
card in the chipset slot" question, the useful quantity is the per-card `frac`
your setup will negotiate — `--pcie-frac` reports it, and the startup probe
prints it:

| Link | Gen4 bandwidth | frac vs x16 |
| --- | ---: | ---: |
| CPU x16 | 31.5 GB/s | 1.00 |
| CPU x8 / x8 split | ~25 GB/s | ~0.9 |
| chipset x4 | 7.9 GB/s | ~0.25 |

On x16 + x4 rigs the weak link shows up as the link-miss scaling in #2007: the
balanced placement stops being optimal and decode lands roughly 10-15% below an
x8/x8 pair of the same cards (#2418). If you are choosing a board, prefer
CPU-attached slots even at x8/x8.

A community timing model that takes this table as input (and was calibrated
against the reports in [COMMUNITY_BENCHMARKS.md](COMMUNITY_BENCHMARKS.md)) is at
<https://piccatapro.github.io/strata-pc-simulator/>; treat its output as a
relative estimate, not a measurement.
```

> 注意：数字（~0.9、10-15%）要按我们模型和他们的 #2418 复核后再写死，别拍脑袋。
> 如果他们 #2418 里的实测差距不是 10-15%，就改成本文引用他们的原话。

---

## 提交前的自查清单

- [ ] 账号有头像、有公开仓库（空账号提 PR 信任度低）
- [ ] PR 只改一个文件
- [ ] commit message 用他们的风格（`docs: ...`）
- [ ] 不删不改任何现有内容，只做插入
- [ ] 结尾不加 "please star"
