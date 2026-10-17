# Why your second GPU can make inference slower

> **In MoE local inference, *which slot* the second card goes into matters more than the card itself.**
> A 4070S in a chipset `x4` slot can leave the whole machine 30% slower than a single 3080.

## A counter-intuitive measurement

I calibrated a timing model against real Strata measurements, then ran four builds
(UD-Q4 weights, 256K context, single stream):

| Build | Negotiated PCIe | Expert hit rate | Decode (physical) |
|---|---|---|---|
| 1× RTX 3080 20G | x16 / 31.5 GB/s | 79.7% | **48.0 t/s** |
| 3080 20G + 4070S | x16 **+ chipset x4 / 7.9 GB/s** | 84.2% | **33.6 t/s** |
| 2× RTX 3090 | x8 / x8, 31.5 GB/s each | 92.1% | **73.0 t/s** |
| 2× RTX 3080 20G | x8 / x8, 31.5 GB/s each | 88.1% | **61.8 t/s** |

Row two is the interesting one: **12 GB more VRAM, a higher hit rate, and 30% less throughput.**

## Why

MoE experts live in three tiers — VRAM → system RAM → NVMe — and every token pulls the routed
experts up to the compute units. When the model is layer-split across two cards:

1. each card only holds the experts for its own layers,
2. activations and KV must cross between cards,
3. that path runs at the **negotiated PCIe rate**, not at HBM bandwidth.

The gap between "CPU-attached x16" and "chipset x4" is large:

```
CPU x16 Gen4  = 31.5 GB/s  → frac 1.00
chipset x4 Gen4 = 7.9 GB/s → frac 0.25
```

`pcie_frac` doesn't change VRAM or SM count. It does exactly one thing in the time model:
**makes every expert access on that link 4× slower**.

```
t = f_V / (K1 · hw)        ← VRAM-resident: compute-bound
  + f_R / (K2 · pcieEff)   ← RAM-resident: PCIe-bound
  + f_D / (K2 · 0.01)      ← disk-resident: disaster
decode = think / max(t, T_FLOOR) × 1.5
```

`pcieEff` is the mean `frac` across cards. One card at 1.00 plus one at 0.25 averages 0.625 —
so a two-GPU machine behaves like **0.625 of a GPU** on the streaming path.

## Why dual 3090s work

Because x8/x8 keeps ~31.5 GB/s per card. The link stops being the bottleneck, and the extra VRAM
and SMs become pure upside:

```
single 48.0 → dual 73.0   (+52%)
```

Same number of cards. The difference is the **slot**, not the silicon.

## Three takeaways

1. **Read the motherboard bifurcation table.** Physical slot length lies: a x16-length slot can be
   wired x4, and hang off the chipset.
2. **Put the second card on CPU lanes**, even if that means x8/x8. x8/x8 ≈ 25 GB/s beats chipset
   x4 at 7.9 GB/s by a wide margin.
3. **Don't add a card just to add VRAM.** Going from 80% to 85% hit rate can be fully eaten by a
   slower link.

## Verify it yourself

- Live: <https://piccatapro.github.io/strata-pc-simulator/>
- Local: `npm run serve` → `http://127.0.0.1:8080/src/index.html`

Drag the second card from a chipset slot to a CPU-attached slot and watch decode change. The PCIe
slots are colour-coded by *electrical* bandwidth: green = full speed, amber = half, red = chipset.

---

**Caveat.** These are relative estimates from a model calibrated against two measured machines plus
community benchmarks, ±20% on absolute numbers. It answers "which choice is better", not "how fast
is my box".
