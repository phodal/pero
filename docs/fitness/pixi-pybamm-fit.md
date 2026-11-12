---
kind: verification_report
date: 2026-11-12
---
# Pixi fit for the frozen PyBaMM ARM64 conflict — #163 P2

Decision: **do not integrate a Pixi preparer for this candidate**. Pixi can lock
the existing Python/PyPI stack on macOS ARM64 and Linux x86_64, but cannot supply
the missing Linux ARM64 solver artifact while preserving #59's versions.
This is a candidate-specific no-go, not a rejection of Pixi for other methods.
The [canonical tracker](../issues/2026-11-11-uv-locked-scientific-profiles.md)
remains open for a demonstrated native-dependency fit before a second preparer.

## Inputs and method

The existing [ARM64 incident](../../scripts/science/pybamm-sweep/linux-arm64.md)
requires Python 3.12.11, PyBaMM 25.10.2, pybammsolvers 0.3.3, CasADi 3.6.7,
NumPy 2.2.6 and SciPy 1.15.3. The complete original requirements file has SHA-256
`8abaa0710ae4bc5281ca1854d3fbc737d21920221d08594ce5a46eeea02d22be`.
No experiment pins, method, tolerances or historical reference were changed.

Used [Pixi 0.84.2](https://github.com/prefix-dev/pixi/releases/tag/v0.84.2),
the revision reviewed in [the earlier study](uv-locked-control.md#pixi-fixed-source-study).
The official `pixi-aarch64-apple-darwin.tar.gz` matched its release checksum:
`039d4b48c7e17bc62a36faa2af1b13d0d187f5dd6e8fea17e0587302438df6e6`.
Extracted executable SHA-256:
`86b4e47c6fbbf3da8aa47a2ad8ea2e1ec3f505ecf6d7d4c4fdaa203071690148`.
The executable was installed only in ignored evidence output.

The [opt-in probe](../../scripts/verification/pixi-pybamm.py) uses an explicit
executable, fresh output and isolated cache, `--no-config`, an explicit
conda-forge channel/PyPI index, `lock --no-install` and `no-build = true`.
It records commands, target versus actual host, timings, manifest/lock digests
and raw diagnostics. Failed resolution returns a nonzero status; transport or
timeout errors must be read as such rather than interpreted as dependency failure.

## Actual resolver matrix

All nine solves ran on macOS ARM64; Linux entries are cross-platform resolution,
not Linux execution. Logs contain dependency failures, not network timeouts.

| Route | osx-arm64 | linux-64 | linux-aarch64 |
| --- | --- | --- | --- |
| Conda Python + exact Conda pybammsolvers 0.3.3 (necessary subset) | No solver candidate | No solver candidate | No solver candidate |
| Conda Python/NumPy/SciPy/CasADi + remaining original PyPI pins | No SciPy 1.15.3 candidate | No SciPy 1.15.3 candidate | No SciPy 1.15.3 candidate |
| Conda Python + complete original PyPI pins, binary-only | Lock generated | Lock generated | Solver 0.3.3 has no usable wheels |

The successful controls show that the experiment can resolve these original PyPI
versions where wheels exist. They do not solve the ARM64 native artifact gap.
The [official solver repository](https://github.com/pybamm-team/pybammsolvers)
documents conda-forge availability from 0.7.0. The live conda-forge package API
also returned no 0.3.3 artifacts. Channel availability observations are dated;
future artifact publication could change the result.

Enabling source builds does not itself repair the existing missing sdist
CMakeLists.txt or C++ ABI mismatch. The upstream
[v0.3.3 build definition](https://github.com/pybamm-team/pybammsolvers/blob/v0.3.3/CMakeLists.txt)
and the retained ARM64 incident describe the source problem. No source-build
experiment was repeated here. Supplying the prior locally patched wheel would
make it an explicit custom-artifact recipe, not demonstrate a Pixi resolver fix.
Upgrading solver/PyBaMM would require a new method/environment identity and fresh
numerical acceptance; it cannot silently replace the frozen #59 experiment.

## Actual macOS installation controls

The successful Conda-Python/PyPI manifest and native lock were copied into two
new physical prefixes. Both `install --locked --no-config` calls passed and
retained the original lock bytes. Lock SHA-256:
`6bddb233f94544f05eda34eb9d083211008f02aff8678aff9adbc12512511152`.
Observed Python is conda-forge 3.12.11, Clang 18.1.8; per-prefix interpreter and
package observations are retained separately from the lock.

| Measurement | Observed on this machine |
| --- | --- |
| First install, fresh installation cache | 8.63 s |
| Same-lock second prefix, shared cache | 1.95 s |
| First prefix, `du -sk` | 513236 KiB |
| Second prefix, `du -sk` | 513280 KiB |
| Shared installation cache, `du -sk` | 494380 KiB |

These are local baseline measurements, not an uv performance comparison.
Filesystem links/clones mean separate directory sizes must not be summed as
unique disk allocation. Solver caches and the tool archive are additional output.
Changing the manifest's CasADi pin while retaining the lock made `install --locked`
refuse with `lock file not up-to-date`; lock bytes stayed unchanged and no
environment prefix was created.

Both prefixes then executed all six frozen DFN experiments through the existing
`run.py`. The existing independent standard-library checker compared each set
against the committed sequential reference: **6/6 consistent per prefix, 12/12
total**, no unexpected results. Terminal voltages matched between the two new
prefixes. The checker retains `scientific_acceptance: not_assessed`; this is a
numerical reproducibility control, not a new research conclusion.

## Reproduce and scope

Acquire and checksum the above official Pixi release first. For each target use a
new output path (the script refuses overwrite):

```sh
python3 scripts/verification/pixi-pybamm.py \
  --pixi /absolute/verified/pixi \
  --platform linux-aarch64 \
  --output /absolute/fresh/evidence
```

Use `osx-arm64` or `linux-64` for the other two targets. A nonzero return is
expected for these matrices because at least one candidate fails. Inspect
`receipt.json` and each `solve.log`; a failed candidate is not a passing install.
For the macOS positive control, copy `conda-python-pypi/pixi.toml` and `pixi.lock`
into a new directory, then explicitly run:

```sh
/absolute/verified/pixi install --locked --no-config --manifest-path /absolute/new/pixi.toml
/absolute/new/.pixi/envs/default/bin/python scripts/science/pybamm-sweep/run.py reference /absolute/new/results.jsonl
python3 scripts/science/pybamm-sweep/check.py scripts/science/pybamm-sweep/reference.jsonl /absolute/new/results.jsonl
```

Raw evidence is retained locally under `test-results/issue-163-pixi/`: `v2-*`
resolver cases, `cold`, `rebuild`, `stale-manifest`, `local-install.json` and tool
download. No generated environment, large lock, binary or result bundle is committed.
No Linux installation/runtime, GPU/HPC, Windows, Native/Desktop, production
Profile/Use integration or scientific acceptance is claimed by this experiment.
