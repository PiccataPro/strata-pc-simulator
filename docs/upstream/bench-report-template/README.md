# Community benchmark: 2× NVIDIA (RTX 3080 20G x16 + RTX 4070S chipset x4), i7-12700KF

> **状态：模板，待填。** 需要在本机跑一遍 `BENCH.bat`（Windows）或 `./bench.sh`（Linux），
> 把 `bench/results/` 里生成的 JSON 与日志放进本目录，再补下面标了 `TODO` 的数字。
> 提交时删掉这段说明。

Measured on 2026-MM-DD by [@PiccataPro](https://github.com/PiccataPro), on a Windows
machine. This tests Strata `<engine version>` with `<model pack>`, **two GPUs on
mixed links (x16 + chipset x4)**, and a `<context>`-token context limit.

Median decode throughput was **TODO tok/s at 4,096 prompt tokens, TODO at 32,768,
and TODO at 128,000**. These are the standard bench prompts with greedy decoding.
They do not establish general answer quality.

## Why this configuration is interesting

Most two-GPU reports use x8/x8 on CPU lanes. This one deliberately uses the
configuration people actually end up with on a mainstream board: the second card
sits in a **chipset slot wired x4** (7.9 GB/s Gen4, `frac ≈ 0.25` against 31.5 GB/s
on the x16 link), and the two cards have **different VRAM sizes** (20 GB + 12 GB).

It is a data point for the link-miss scaling discussed in #2007 / #2418: how much
does the weaker link cost when the split is otherwise balanced?

## Hardware and software

- GPU 0: NVIDIA GeForce RTX 3080 (20 GB modded), PCIe Gen4 **x16**, `<driver>`,
  power limit `<W>`.
- GPU 1: NVIDIA GeForce RTX 4070 SUPER (12 GB), PCIe Gen4 **x4 (chipset)**,
  `<driver>`, power limit `<W>`.
- CPU: Intel Core i7-12700KF (8P + 4E); `<n>` logical CPUs; AVX-512 / AVX-VNNI
  present (`<confirm from startup log>`); expert-pool workers `<n>`.
- RAM: 96 GB installed; `<x>` GiB usable.
- OS: Windows `<build>`; NVIDIA driver `<version>`.
- Source commit `<sha>`; engine `<version>`. See `BUILD.json`.
- Model: `<repo>@<revision>`, files `<list>`; SHA-256 verified: `<yes/no>`.

## Model and configuration

- Context `<n>`; KV `<int8/fp16>`; `<n>` KV cells per attention layer.
- Expert cache `auto`: `<slots>` slots, `<GiB>` VRAM, prefilled with `<profile>`.
- `--pcie-frac` `<auto / explicit values>`; `STRATA_SPLIT_UNIFORM` `<set/unset>`.
- `--split-overlap` `<set/unset>`; `--pipeline-windows` `<default>`.

## Results

| Prompt tokens | Decode (tok/s) | Prompt (tok/s) | Notes |
| ---: | ---: | ---: | --- |
| 4,096 | TODO | TODO | |
| 32,768 | TODO | TODO | |
| 128,000 | TODO | TODO | |

Median of three runs each. Raw per-run JSON: `results/*.json`.

## Comparison with the simulator's estimate

The open-source [Strata PC Simulator](https://piccatapro.github.io/strata-pc-simulator/)
models this exact build (it was calibrated against this machine). Its estimate was
`<x>` tok/s at 32K before the measurement — `<within ±20% / off by N%>`.

That estimate is a relative planning tool, not a benchmark; the purpose of this
report is to keep it honest.

## Files

- `BUILD.json` — engine build metadata (from the bench run)
- `results/*.json` — per-run reports
- `python-packages.txt` — optional
