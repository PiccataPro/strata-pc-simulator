# Strata PC Simulator · Strata 装机模拟器

> A realistic PC-building simulator for **MoE local LLM inference**. Drag real parts into a case, press the power button, and watch decode speed / prefill / time-to-first-token / expert residency / thermals respond to both your hardware and your inference settings — calibrated against real measurements from the [Strata](https://github.com/Niko1221/Strata) MoE inference engine.

A web-based, dependency-free simulator that answers the question every local-LLM builder eventually asks: **"which GPU / motherboard / RAM should I buy next, and what will it actually do to my tokens-per-second?"**

**[🎮 Live Demo (GitHub Pages)](https://piccatapro.github.io/strata-pc-simulator/)** · No install, just open and drag.

---

## Why this exists

Running a 100B+ MoE model (Qwen Flash-Next class) on a home PC is a hardware-balancing puzzle: expert weights stream across three tiers (VRAM → system RAM → NVMe), and the bottleneck is rarely where you expect it. A second GPU plugged into the wrong PCIe slot can run at `pcie_frac 0.18` and silently cap your whole system. Small-VRAM cards lock prompt chunks. Four DIMMs silently downclock on AM5.

This simulator encodes those rules as an explicit compatibility matrix and a time-model calibrated to real benchmarks — so you can try the upgrade on screen before spending money.

## Features

- **Realistic case view** — motherboard tray, PCIe slots colored by *electrical* bandwidth (not just physical size), per-slot DIMM rendering, M.2, PSU bay, spinning fans, cable-plugging boot animation.
- **Real part specs** — P/E core counts, iGPU presence, AVX-512/AVX-VNNI, VRAM bandwidth, SM counts, PCIe bifurcation tables (`x8/x8` vs chipset `x4`), PL2 power limits, slot thickness, case GPU length limits.
- **Compatibility matrix with POST rules** — no POST without CPU + board + RAM + cooler + PSU + storage + display output (a 12700KF without a dGPU won't boot); DDR4/DDR5 keying; AM5 4-DIMM downclock to 3600; M.2 lane-sharing traps; PSU 85% load line; 16-pin connector counts.
- **Strata-aware performance model** — expert pool residency (VRAM/RAM/disk split), hit rate vs context length, decode t/s, prefill t/s, TTFT, KV cache, prompt-chunk caps (issue #448), batch path (issue #776), CPU-side expert kernels (AVX-512 / AVX-VNNI / AVX2).
- **Live dashboard** — CPU/GPU/VRAM/RAM load, per-component thermals, total system power, all reacting to weight quantization, context length, concurrency and thinking-effort settings.
- **36 automated checks** (`npm test`) — anchor regressions against measured machines + matrix edge cases.

## Quick start

```bash
npm run serve       # → http://127.0.0.1:8080/src/index.html
```

`npm run serve` is a zero-dependency static server that **must be rooted at the repository root**, because `src/index.html` loads `../vendor/three.module.js` and `../assets/models/*.glb`. Serving `src/` as the root makes both 404 — the 3D view silently drops to 2D. Opening `src/index.html` from `file://` fails for the same reason: browsers block ES modules on `file://`.

Prefer a double-click? Use the single-file build, which inlines Three.js and works offline:

```bash
npm install        # devDependency: esbuild — only needed to build
npm run build      # → dist/strata-pc-simulator.html  (+ docs/index.html for Pages)
```

No framework, no runtime dependencies. The app itself is vanilla ES5-compatible JS + Three.js.

## Running the tests

```bash
npm test        # node test.js — 36 checks, all must pass
```

The suite includes **anchor regressions** — the model must reproduce measured numbers:

| Anchor | Machine | Measured | Simulated |
|---|---|---|---|
| A1 | i7-12700KF + RTX 3080 20G (x16) + RTX 4070S (chipset x4), UD-Q4, 256K ctx | decode ≈ 31 t/s, prefill ≈ 1181 t/s, TTFT ≈ 206 s | ✅ in band |
| A2 | Dual RTX 3090 @ Z790 x8/x8, UD-Q4 | 64–78 t/s (community bench) | ✅ in band |
| A4 | 2× RTX PRO 4500 32G + Swift IQ3_XXS | experts 100% resident, decode 100+ (community bench) | ✅ in band |
| — | 2× RTX 2080 Ti 22G | slower than A1 (community bench) | ✅ reproduced |

The time model is two calibration constants solved analytically from anchors A1 + A2 (see header of `src/sim.js`), not a curve-fit zoo.

## Project layout

```
src/
  index.html   UI shell + styles
  parts.js     part database + compatibility/POST/PCIe matrix
  sim.js       Strata time & thermal model (calibrated)
  app.js       assembly, drag & drop, case SVG renderer
  app2.js      boot animation + dashboard
  3d.js        Three.js scene (ES module, bundled at build time)
scripts/serve.js   zero-dep dev server, rooted at repo root
scripts/build.js   inlines everything → dist/ single file
test.js            36-check verification suite (node test.js)
docs/calibration.md  where every number comes from
```

## Adding your own parts

Everything lives in `src/parts.js` — plain data objects. To add a GPU:

```js
{ id:'rtx-xxxx', cat:'gpu', name:'RTX XXXX 24G', vram:24, bw:936, sm:82,
  arch:'ampere', gen:4, lanes:16, tdp:350, thick:3, len:313,
  conn:'8pin x2', price:8100, benchNote:'optional measured numbers' },
```

The matrix (`analyze()`) picks it up automatically: slot allocation, bifurcation, thickness conflicts, PSU connectors, and the sim model (bandwidth, SM count, arch factor) all read from these fields.

## Data provenance & disclaimer

- Hardware specs: manufacturer spec sheets.
- PCIe `frac` mapping: Strata's own auto-detection reports (24.3 GB/s → 0.55, 6.6 GB/s → 0.18).
- Benchmarks: Strata official community bench results and one owner's measured machine.
- Prices: second-hand market (Xianyu) snapshot **2026-10**, CNY — the RAM/NAND price spike of late 2026 is included. Prices go stale fast; treat them as relative guidance, not quotes.

This is a **planning toy**, not a benchmark suite. It estimates *relative* outcomes to help you choose parts; absolute numbers carry ±20% and the model has no way to know your silicon lottery.

## Contributing

Issues and PRs welcome — especially:
1. More calibration anchors (post your `strata_agent_bench` output),
2. Region-specific price datasets,
3. More motherboards with verified bifurcation tables.

## License

MIT © 2026 Mingming
