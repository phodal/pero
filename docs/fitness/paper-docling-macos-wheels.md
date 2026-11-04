# Optional Docling macOS wheel provenance

Verification date: 2026-11-04. This records cross-platform artifact inspection,
not native macOS installation, OCR, conversion, UI or signed-package acceptance.
The subsequent actual hosted installation, Vision and original-scan results are
recorded separately in the [Mac runtime receipt](paper-docling-macos-runtime.md).

## Fixed Apple Silicon profile

`macos-arm64-cp312` requires native arm64 CPython 3.12 and macOS 14.0 or newer.
The exact package list is
[requirements-docling-macos-arm64.txt](../../apps/paper-agent/requirements-docling-macos-arm64.txt).
The corresponding
[wheel manifest](../../crates/pero-runtime/src/apps/docling-wheels-macos-arm64.json)
contains 77 official PyPI wheel URLs, filenames, SHA-256 hashes and byte lengths.
No source distributions, community Torch builds, Homebrew installation or
unlocked dependency resolution are involved.

The existing Linux profile's package versions are retained except for the
platform-specific Torch local version suffix: macOS uses `torch==2.10.0` and
`torchvision==0.25.0`, not `+cpu` packages from the Linux CPU index. This pairing
matches [PyTorch's published version instructions](https://pytorch.org/get-started/previous-versions/).
The selected official Torch file is
`torch-2.10.0-2-cp312-none-macosx_11_0_arm64.whl`; its build tag `2` is part of
the locked filename, not a change to the distribution version.

Apple Vision OCR adds `ocrmac==1.0.1`, `pyobjc-core==13.0`, and the Cocoa,
CoreML, Quartz and Vision PyObjC framework distributions at `13.0`.
[ocrmac's official wheel](https://pypi.org/project/ocrmac/1.0.1/) requires
Click, Pillow and pyobjc-framework-Vision. Matplotlib is an optional guarded
import, not an installation requirement. The
[Vision framework package](https://pypi.org/project/pyobjc-framework-Vision/13.0/)
declares the remaining PyObjC dependencies; all five have CPython 3.12
universal2 wheels. The six added distributions declare the MIT license in
their wheel metadata. The selected OCR branch is Apple's Vision framework,
not ocrmac's separate LiveText branch. No additional OCR model is downloaded.
This does not pin the operating system's built-in Vision implementation.

## Artifact checks performed

All 77 actual wheel files were downloaded from their manifest URLs, checked
against PyPI's exact release records, and matched their expected SHA-256 and
size. The combined download is **194,887,510 bytes**. The sum of uncompressed
ZIP entries is **733,750,344 bytes**, excluding the Python environment, package
installer, bytecode, retained wheel cache and separately approved Heron model.
These values are not a measurement of a completed macOS installation.

The verifier checked filename and embedded WHEEL compatibility tags, package
name/version, Requires-Python, and the actual METADATA dependency closure under
Darwin/arm64/CPython 3.12 markers. The requested Docling extras were
`convert-core`, `format-pdf`, `models-local`, and `feat-ocr-mac`; transitive
extras were followed. No missing or conflicting pinned dependency was found.

Deployment-target load commands were inspected in **400 arm64 Mach-O shared
libraries/extensions**, including the arm64 slices of universal2 files. The
highest minimum OS is 14.0. In particular:

- `docling-parse==7.24.2`: wheel tag and native binary require macOS 14.0.
- Selected NumPy 2.5.4 and SciPy 1.18.1 wheels: require macOS 14.0.
- Torch 2.10.0: the filename advertises macOS 11.0, but bundled native
  libraries declare macOS 14.0. The installer must not rely on that filename
  alone to allow older systems.
- torchvision 0.25.0: bundled native libraries reach macOS 12.1.
- pypdfium2 5.14.0: bundled PDFium requires macOS 13.0.
- PyObjC 13.0 universal2 arm64 slices: minimum macOS 11.0.

The same 400 binaries contain 470 dynamic-library load references, including
weak/re-export/upward load commands. Every reference is relative
(`@rpath`, `@loader_path`, or `@executable_path`) or names an Apple system
library under `/usr/lib/` or `/System/Library/`. There are no direct
`/opt/homebrew`, `/usr/local`, or other non-system absolute library dependencies.
All loader-relative targets exist inside their wheel; the six distinct
`@rpath` library names are supplied in the pinned Torch wheel's `torch/lib/`.
This is static file presence, not proof of successful dyld resolution on a Mac.

`LC_RPATH` search paths are recorded separately from load dependencies. Six
entries retain upstream build-machine paths: SciPy `_fblas` has three paths
under `/opt/homebrew/Cellar/gcc@13/13.4.0/lib/gcc/13`; Pillow's bundled libjpeg
has `/Users/runner/work/Pillow/Pillow/build/deps/darwin/lib`; torchvision's two
extensions share `/Users/ec2-user/runner/_work/_temp/conda_environment_21142521573/lib`.
The inspected SciPy and Pillow binaries load only Apple system libraries;
torchvision references its bundled libraries and the pinned Torch libraries.
These leftover search paths are not a demonstrated Homebrew dependency, but
they prevent claiming that the binaries contain no Homebrew/build-host paths.
The audit output preserves every such entry. No binary was modified.

## Why there is no Intel profile

The fixed `docling-parse==7.24.2` release has no macOS x86_64 CPython 3.12
wheel. Its [official release files](https://pypi.org/project/docling-parse/7.24.2/#files)
provide the required macOS wheel only for arm64.

The fixed Torch 2.10.0/torchvision 0.25.0 releases likewise have no Intel Mac
wheels. PyTorch's
[official deprecation announcement](https://dev-discuss.pytorch.org/t/pytorch-macos-x86-builds-deprecation-starting-january-2024/1690)
ended macOS x86_64 binaries after the 2.2 series. The official
[Torch 2.2.2 CPython 3.12 Intel wheel](https://pypi.org/project/torch/2.2.2/#files)
does exist, but substituting it does not satisfy the fixed Transformers
5.22.1 Torch implementation's minimum version 2.6. No dependency downgrade,
different PDF backend, source build, Rosetta workaround or provider/model
substitution is claimed or included.

## Reproduce the audit

Use a verifier Python with `packaging` available. This is a manually invoked
audit tool, never called by the App or its installer. It never installs or
imports the downloaded package code. Network activity requires explicit flags:

```sh
python apps/paper-agent/tools/verify_docling_macos_wheels.py \
  --wheel-dir /chosen/scratch/macos-wheels --download --check-pypi
```

For an offline recheck of previously downloaded files, omit `--download` and
`--check-pypi`. The script uses only the committed exact manifest; it does not
select newer releases or regenerate pins. Both offline and online metadata
audits must remain separate from a real Mac smoke test with Apple Vision and
the fixed local Heron model.
