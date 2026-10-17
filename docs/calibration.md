# Calibration & Data Provenance

Every number in the simulator traces to one of four sources: manufacturer spec sheets, the
[Strata engine's](https://github.com/Niko1221/Strata) own reported measurements, official
community benchmark reports, or the author's measured machine. This document is the audit trail.

## 1. PCIe `pcie_frac` mapping

Strata auto-detects the GPU link at startup and reports a `pcie_frac` quality factor.
Two engine-reported anchors (from `docs/DETAILS.md` and live logs):

| Measured link bandwidth | Engine-reported frac |
|---|---|
| 24.3 GB/s (x16 Gen4, degraded) | 0.55 |
| 6.6 GB/s (chipset x4 Gen4) | 0.18 |
| 31.5 GB/s (x8 Gen5 / x16 Gen4 nominal) | 1.0 ("full score") |

`parts.js` maps theoretical lane bandwidth (`lanes × GBPS_PER_LANE[gen]`) linearly onto frac,
capped at 1.0 — consistent with all three points.

## 2. Expert slot capacity

Anchor: an RTX 4070 SUPER 12G reports **1037 expert slots** and Strata issue #448 caps the
prompt chunk at **5632 tokens** on that card. Linear fit gives
`slots ≈ (VRAM_GiB − 2.5) × 109` (the 2.5 GiB offset covers attention/KV/output-head
residency). The chunk cap uses 5632/1037 ≈ 5.43 tokens per free slot.

## 3. Decode time model

`src/sim.js` uses a reciprocal-throughput model: each expert-share (VRAM-resident,
RAM-streamed, disk) contributes `share / rate`, summed into a time-per-token, then
`decode = mtp_factor / t`. Two calibration constants (K1, K2) were solved **analytically**
from two anchors:

| Anchor | Config | Measured decode |
|---|---|---|
| A1 (author's machine, 2026-10-16) | 3080 20G x16 + 4070S chipset-x4, UD-Q4_K_XL, 256K ctx | 31 t/s (prefill 1181 t/s, TTFT 206 s, hit 86.7%) |
| A2 (community bench `2026-09-29-rtx3090-epyc-milan`) | 2× RTX 3090 x8/x8, EPYC AVX2, UD-Q4 | 64–78 t/s |

A full-residency compute floor (≈150 t/s) reproduces the community report of
2× RTX PRO 4500 32G + Swift IQ3_XXS at "100+" (issue #776 batch path, +29%).

## 4. CPU-side kernels

- AVX-512 (Ryzen 7000/9000): official wording is "a bit faster" (`DETAILS.md`).
- AVX-VNNI (Alder Lake+): official measurement +4–25% vs plain AVX2 cores (`DETAILS.md`).
- Counter-anchor: EPYC 7453 (AVX2 only) still hits 64–78 t/s on dual 3090 — CPU SIMD is
  not the bottleneck once VRAM residency is high. The model reflects this by applying the
  SIMD factor only to the RAM-resident expert share.

## 5. Memory rules

- AM5 official memory model: 2 DIMMs run 6000+, **4 DIMMs derate to 3600**.
- Z790 4-DIMM: ~4400 symmetric / ~4000 mixed; asymmetric capacity → flexible (1.5) channel,
  modeled as −15% bandwidth.
- CPU-side expert compute is bandwidth-sensitive; the sim warns below 70 GB/s.

## 6. Prices

Xianyu (Chinese second-hand market) snapshot **2026-10-16/17**, CNY:
GPUs cross-checked with vramglass daily tracking + actual local transaction prices;
CPUs with market trackers; RAM/SSD reflect the late-2026 DRAM/NAND supercycle
(DRAM contract prices +93–98% QoQ per TrendForce coverage; second-hand DDR5 32G
outrading second-hand GPUs). Expect prices to age quickly.

## 7. Known limitations

- Thermal model is a steady-state power→temperature approximation (no airflow simulation).
- Concurrency >1 scales KV and derates hit rate linearly; real scheduler behavior varies.
- Only quantization tiers used by the author's workflow are preset; add your own in `parts.js`.
