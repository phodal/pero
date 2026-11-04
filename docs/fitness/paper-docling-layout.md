# Optional Docling layout: bounded offline profile

Status: Linux and hosted macOS 26 arm64 Docling installation/OCR verified;
desktop confirmation and interaction remain unverified (2026-11-04). The
[Mac runtime receipt](paper-docling-macos-runtime.md) records the exact head,
machine, tests and three-page quality failures. This is an
explicit optional layout experiment, not a replacement for PDFium/Tesseract
numeric extraction and not scientific/numeric acceptance. Real results and
visual-review limits belong to [the corpus report](paper-docling-corpus.md).
No Paper-backend installer endpoint, implicit package installation, automatic
model download, or default-path Docling call exists. The Host owns a bounded
optional-component installer with separate trusted desktop confirmations.
Authorization for this development experiment does not authorize installations
for future users.

## What actually runs

- `docling_layout_status()` inspects installed distribution metadata, local
  model files, and the selected OCR engine's language availability. It does not import
  Docling. It reports concrete missing/mismatched requirements and honest setup
  metadata (`requiresSeparateUserApproval=true`, `installerSupported=false` for
  the backend itself). The independent Host endpoint reports installer support.
- `configured_docling_layout(store_root)` first reads trusted local
  `store_root/docling-runtime.json` with absolute `python`, `artifactsPath`, and
  a profile identity checked again by the actual isolated interpreter.
  HTTP/Agent input cannot write this file or select interpreter/model paths.
  `PERO_DOCLING_ARTIFACTS_PATH` remains a direct-CLI fallback.
- `convert_docling_pdf(data, document, page, config)` checks the saved original
  SHA-256, page, render budget and offline profile before optional imports.
  It converts the selected original page with `page_range=(page,page)`.
- Full-page Tesseract CLI OCR, English, scale 3 (216 dpi),
  `OcrMode.FULL_PAGE`; CPU Heron layout model, two Torch threads.
  `ThreadedDoclingParseDocumentBackend` is the pinned PDF backend.
  On the macOS profile, explicit `OcrMacOptions` uses Apple's native Vision,
  accurate recognition, `en-US`, the same full-page mode/scale, and CPU Heron.
  It does not choose AutoOCR, LiveText, MPS, or install Tesseract/Homebrew.
- Table cell-grid reconstruction, VLMs, code/formula enrichment, picture
  classification/description, chart extraction, external plugins and remote
  services are disabled. Raw exported table-region structure may still appear.
- A 120-second **cooperative** Docling timeout is not a hard process deadline.
  Before conversion, a page must fit 6,000 pixels per edge and 12 megapixels at
  scale 3. This bounds page rendering, not total process memory. No hard memory
  cap is claimed. Each call handles one page and constructs
  its own converter; it does not process all 67 pages of a long report.
- Known import failures become 503; known conversion failures become 422.
  They do not produce a successful saved layout. Original mismatch is 409 and
  oversized page rendering is 413.

## Evidence and coordinates

The result keeps the exact original SHA, selected original page, dependency
versions, model revision and file hashes, Tesseract binary/language-data hashes,
raw Docling export, native saved PDFium page text, and mapped layout separately.
Mac provenance instead records ocrmac/PyObjC versions, macOS version/build,
Darwin version, Vision request revision and supported recognition languages.
The OS-provided Vision model is explicitly `managed-by-macos`, not independently
hash-pinned. Its preflight performs the native language query before availability.
Because ocrmac can return empty annotations on a native error, conversion records
`text_observed` or `no_text_observed` and never claims complete Apple recognition.
The UI warns about empty results and possibly partial OCR; both require review.
All converted layout text is `full_page_ocr_docling` / `derived_docling`.
Docling charspans are explicitly `docling-item-text-not-pdfium`; they never become
native text offsets. Native text is not overwritten.

Frozen imported types retain each original box (`l,t,r,b,coord_origin`), page,
rotation, text and explicit picture caption/child references. No caption is
inferred merely because text is nearby. Missing referenced text stays unresolved.
Both `TOPLEFT` and `BOTTOMLEFT` are mapped to normalized, unrotated top-left
`PdfAnchor` regions only when all prerequisites are established. Unknown or
nonzero rotation, an unknown origin, an invalid box or a true page-size mismatch
keeps the source evidence but has no anchor.

Page metadata records both export `width,height` and PDFium
`sourceWidth,sourceHeight`, with `dimensionMatch`. Exact dimensions are preferred.
PDFium's `get_width/get_height` call `FPDF_GetPageWidthF/FPDF_GetPageHeightF`, whose
return type is IEEE float32. Thus an exported decimal dimension is equivalent
only if rounding it to float32 yields **exactly** the stored PDFium dimension,
for both axes. The `float32-equivalent` marker records this limited quantization
case, not a percentage/epsilon resize tolerance. Normalization uses the export's
own dimensions. This handles the observed TM-842 page 67 values
`621.359 × 798.96` versus `621.3590087890625 × 798.9600219726562` without discarding
raw coordinates or pretending they were byte-identical. A genuine resize still
fails. Layout does not produce calibrated values, numeric references,
`numeric_ready`, or an acceptance transition.

## Host-managed optional setup

After a region is classified as image-based or mixed, Paper explains that
layout is optional. It does not infer permission or start a download. Opening
the optional panel reads status. Separate actions request the fixed software
profile and fixed Heron model. Electron uses a main-process native dialog.
The Native/Wry shell uses a Rust-owned GPUI dialog outside the Paper WebView.
Each states the source, versions, approximate disk use, license information and
unchanged normal Paper environment. Cancellation is the default; Native dialog
Enter, Escape and dismissal deny, and only its explicit Install action approves.

The App-facing `POST /host/docling-runtime` accepts only `status`,
`request` with component `software` or `model`, `cancel`, and `revoke`.
It requires the exact Paper origin. Installation tickets are held only by the
trusted shell; App-supplied approval, ticket, command, path or source fields are
rejected. The private Host `prepare`/`install` protocol is not forwarded through
public renderer IPC. Cancelled or closed confirmations cannot dispatch a late
approval. Disabling the optional runtime has its own native confirmation.
The Native shell invalidates pending consent when a Paper page is removed, the
window closes, or the Host disconnects. Merely hiding the embedded WebView to
show the modal does not cancel it. Its private dialog events and Host tickets
are not delivered to the App or agent-facing SDK.

This is deliberately **not** a general package manager. Both profiles require
an existing release CPython 3.12 environment, verified OS/architecture/ABI, and
separate software/model confirmations. Linux x86-64's manifest pins 71 official
PyPI/CPU PyTorch wheel URLs and SHA-256 hashes (326,669,963 download bytes
according to their official Content-Length responses), downloaded and verified before
offline, no-dependency installation in a separate virtual environment. The
model is a second consented download of exactly the three files below. No
model-produced command or arbitrary application package list is executed.
Tesseract and English data must already be installed; their absence is explicit.

The native Apple Silicon profile requires **macOS 14+**, native arm64 CPython
3.12 and a native arm64 Host. Its 77 official PyPI wheels total **194,887,510
bytes**, including CPU-capable Torch 2.10.0, torchvision 0.25.0, ocrmac 1.0.1
and PyObjC 13.0. The actual downloaded wheels, dependency closure, ABI tags and
400 arm64 Mach-O deployment targets were checked. See the
[exact wheel provenance and limitations](paper-docling-macos-wheels.md).
Software is installed into a separate `venv-macos-arm64-cp312`; software readiness
and approval from another profile are not inherited. Intel/Rosetta and older
macOS are explicitly unsupported by this fixed profile, not silently downgraded.
The App and native confirmation distinguish hosted macOS 26 arm64 installation
and OCR verification from unperformed desktop interaction. No Linux result is
presented as Mac execution evidence; macOS 14 is the audited minimum deployment
target, not an OS version exercised by this hosted run.

Status exposes installation, cancellation, interruption and failure. Retry needs
a new native confirmation. Activation occurs only after both components verify,
using `research-v1/docling-runtime.json` in Paper's data directory. Revoke writes
an explicit disabled marker which also blocks the older environment-variable
fallback, retains downloaded files, and leaves papers and evidence unchanged.
Asset readiness and user approval are separate. Restoring requires new software
and model confirmations; existing verified assets can be reused. Hosts without the
native confirmation bridge retain the manual setup below.

Installer processes are supervised: normal Host shutdown cancels and joins the
worker; Linux parent-death termination stops an installer after a Host crash.
A fixed runtime directory lock survives exec on Unix and prevents concurrent
writers. On macOS, a crash may leave the current fixed installation process
running until it finishes; it retains the lock, and a new Host cannot write
concurrently. Immediate crash termination is a Linux-only guarantee, not a Mac
claim. The macOS-specific crash/lease test passed on a hosted native arm64 Mac;
that lifecycle test does not install or run Docling.
Virtual environment
creation disables automatic ensurepip subprocesses; its existing CPython-bundled
pip is bootstrapped in the same supervised process. Reinstall uses the verified
local wheels with `--force-reinstall`, so a stale version record cannot hide
missing package files. Network requests retain TLS verification, use the Host's
existing `SSL_CERT_FILE` bundle when configured, and can take up to their
120-second deadline to observe a pending cancellation. No system trust settings
are changed.

## Reproducible isolated manual setup, only after approval

Default Paper requirements are unchanged. The complete tested optional Linux
CPU runtime is [requirements-docling.txt](../../apps/paper-agent/requirements-docling.txt).
The `docling` 2.146.0 package is a meta-package for `docling-slim[standard]`.
This experiment installs the official `docling-slim` implementation's PDF/local
model dependencies, avoiding unrelated standard OCR engines and GPU packages.
No unofficial package or model was used.

Create a separate virtual environment outside the repository and ordinary Paper
runtime, then run these explicit provisioning commands there:

```sh
python -m venv /chosen/local/docling-venv
/chosen/local/docling-venv/bin/python -m pip install \
  --index-url https://download.pytorch.org/whl/cpu \
  'torch==2.10.0+cpu' 'torchvision==0.25.0+cpu'
/chosen/local/docling-venv/bin/python -m pip install \
  -r apps/paper-agent/requirements-docling.txt
```

Observed environment usage was approximately 1.5 GiB for the venv plus 164 MiB
for the layout model. Provision local Tesseract with English data separately if
absent; this run reused existing Tesseract 5.5.0 and made no system installation.
English data SHA-256 was
`7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2`.
Tesseract executable SHA-256 was
`74b76a5b994adcc18be362bf64ed5118082b2401d5d9a35242e92fc4c62e2b4b`.
These are recorded output provenance, not portable executable requirements.

Manually provision the following official Apache-2.0 model only:
[Heron revision 8f39ad3c0b4c58e9c2d2c84a38465abf757272d8](https://huggingface.co/docling-project/docling-layout-heron/tree/8f39ad3c0b4c58e9c2d2c84a38465abf757272d8).
Place its files in `/chosen/local/models/docling-project--docling-layout-heron/`.
The three required files total 171,662,708 bytes:

| File | SHA-256 |
|---|---|
| config.json | fdea30805ce2f5666b147fca941dcdd27ad468e27d6ed21902207d3da056a97d |
| preprocessor_config.json | cd38cd59999e7a95d68e487fbe5132df3d4e5c32a0836add57e6126ba0c4eaf1 |
| model.safetensors | 00333a43451945aaf89db8ca9c0a17e75d1537c17db60fdb91aa95f4c7929e0c |

The application refuses missing or mismatched assets before converter import.
For the hosted Paper application, manually place this trusted configuration in
its data store root (not its repository root):

```json
{
  "python": "/chosen/local/docling-venv/bin/python",
  "artifactsPath": "/chosen/local/models",
  "profile": "linux-x86_64-cp312"
}
```

The filename is `research-v1/docling-runtime.json` relative to Paper's App data
directory. There is no Paper HTTP configuration writer or installer. The Host
installer writes this trusted file only after its verification and approval
flow. The host clears most inherited environment variables, so relying on
a shell environment variable is not sufficient for the hosted App. Paper's
mandatory default PDFium is 5.0.0 while this optional profile uses 5.14.0; do not
install these requirements over the default environment.

Status and conversion launch the selected interpreter with `shell=False`, an
explicit backend `PYTHONPATH`, and offline environment flags. Private temporary
files carry the original PDF, document record, request and full result JSON.
Raw exports are not encoded in command arguments or emitted to stdout. The
parent process never imports Docling/Torch. Status has a 30-second subprocess
wait deadline, conversion 180 seconds. A timeout terminates the direct child;
this is not a whole-process-tree deadline or memory cap. The Docling pipeline's
own cooperative 120-second deadline also remains.

For a standalone manual/CLI run inside the optional interpreter, a config with
no `python_path` calls the runtime directly; `PERO_DOCLING_ARTIFACTS_PATH` selects
the model directory. Without a trusted runtime file or that explicit CLI
setting, the optional feature remains unavailable even if packages are present.

## Why conversion does not download

Upstream [advanced options](https://docling-project.github.io/docling/usage/advanced_options/)
explicitly document first-use automatic downloads. `enable_remote_services=False`
is **not** a download ban, and import success alone is not conversion evidence.
This adapter's guarantees come from its tested pinned configuration:

1. Metadata version checks, exact local asset SHA checks and Tesseract preflight
   happen before Docling imports or initialization.
2. An explicit, non-null `artifacts_path` selects the complete local Heron folder.
   The pinned [artifact resolver](https://github.com/docling-project/docling/blob/v2.146.0/docling/models/inference_engines/vlm/_utils.py)
   raises on an absent folder rather than downloading. Its no-path download
   branch is unreachable for this adapter.
3. The hashed Heron config has `use_pretrained_backbone=false` and
   `use_timm_backbone=false`; the local safetensors and preprocessor are complete.
   Other downloadable model stages are disabled.
4. `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1` are set before optional imports.
   These reinforce the explicit local model configuration; they are not the
   only preflight safeguard.
5. The opt-in actual conversion test patches `socket.socket.connect` to raise
   on network attempts. The real TN-2825 page converted successfully under that
   guard, with unchanged native text and real picture/caption/child relationships.

The source inspected was the official PyPI `docling-slim==2.146.0` wheel, MIT
licensed. Relevant sources include its
[full-page OCR behavior](https://github.com/docling-project/docling/blob/v2.146.0/docling/models/base_ocr_model.py),
[standard pipeline](https://github.com/docling-project/docling/blob/v2.146.0/docling/pipeline/standard_pdf_pipeline.py),
[layout engine](https://github.com/docling-project/docling/blob/v2.146.0/docling/models/inference_engines/object_detection/transformers_engine.py),
and [picture relationship example](https://github.com/docling-project/docling/blob/v2.146.0/docs/examples/inspect_picture_content.py).

## Verification and remaining limits

```sh
python -m unittest discover -s apps/paper-agent/test -p test_docling_layout.py
PERO_DOCLING_REAL_CORPUS=/path/to/fixed/nasa/pdfs \
PERO_DOCLING_ARTIFACTS_PATH=/chosen/local/models \
/chosen/local/docling-venv/bin/python -m unittest discover \
  -s apps/paper-agent/test -p test_docling_layout.py
cargo test -p pero-runtime --locked
cargo test -p pero-host --locked
node --experimental-transform-types --test desktop/src/main/docling-runtime.test.ts
```

Before the macOS extension, automated checks in this workspace ran Paper 320 tests (four explicit
platform/opt-in skips); all three available opt-in OCR/Docling cases also passed
separately. Rust runtime 98 tests passed (one network installation test ignored
by default), and Host 44 passed. The real installation opt-in ran separately
against a fresh isolated directory: 71 official wheels and all three model files
were downloaded, SHA-256 checked, installed, verified, activated, revoked, and
re-enabled through two fresh component approvals. Its first successful run took
158.39 seconds. This drives the trusted Host protocol, **not a real click through
an Electron dialog**. The native dialog and App boundary have separate tests.
The final repair run also passed (185.46 seconds): it deleted `pypdfium2` code
while retaining its version metadata, observed verification fail, force-reinstalled
the verified wheels, and required both renewed component approvals to reactivate.
Finally, the default Paper Python used the actual Host-written activation file
to convert TN-2825 page 28 through the newly installed interpreter, save/reopen
the layout and original PDF, retain native text unchanged, and keep ML imports
out of the parent. The recorded figure/caption relationship remained unverified
scientific evidence, not numerical admission.

Affected Desktop suites passed. The complete Desktop run had 67 passing tests
and one unrelated connector MCP fixture failure (`MCP_CLIENT_EXIT` instead of
JSON); no connector production code was changed. Paper TypeScript and component
bundling passed. Root TypeScript still needs the generated reader-WASM module;
the full App build needs `PERO_GPUI_KIT_PATH`. Browser/native visual inspection,
actual confirmation clicks, screenshots, native Mac execution and signed
package verification remain unperformed, and are not implied by protocol tests.

Ordinary tests are explicitly synthetic export/preflight contracts. The opt-in
case reads the real corpus's fixed original SHA, converts one selected page,
blocks network connections, and checks native/derived separation and real
relations. A separate real system-Python → isolated-venv smoke passed with the
same original page and unchanged native text; the parent had no Docling/Torch
modules loaded. Synthetic tests also cover trusted config parsing, a missing
interpreter, and the isolated status protocol. The three-paper benchmark uses the independent manual runner and
visual guide in [the corpus report](paper-docling-corpus.md). It is not complete
ground truth and does not establish extraction accuracy.

A scratch comparison with Docling's `PyPdfiumDocumentBackend` fixed the decimal
size discrepancy but worsened a real caption association and did not resolve
TM-842 caption OCR. Therefore the tested default DoclingParse backend remains;
we did not silently substitute the apparently better-looking result. The
full-page Docling/Tesseract path can produce unreadable captions, merged figure
panels or absent references on these historical scans. A successful conversion
status is not a claim that those structures or text are correct.

## macOS extension verification

After the extension, the Paper suite ran **323 tests: 319 passed, four skipped**.
After integrating current master `2b84243e` and preserving its reader/navigation
changes, the full suite ran **326 tests: 322 passed, four skipped**. The affected
Desktop suites passed all 22 tests; real isolated HTTP save/reopen passed five.
The real Linux Docling opt-in ran all 19 layout/profile tests successfully in the
Host-installed environment, including a network-denied real scan conversion.
The independent Linux system-Python-to-isolated-runtime HTTP suite passed all
five tests. Rust runtime passed 104 tests (one network install opt-in ignored),
Host passed 44, and Desktop approval/permission tests passed seven. TypeScript
and diff checks passed. These verify regressions and platform-selection rules,
not native macOS imports or OCR.

The opt-in `test/manual/docling_macos.py` must run on a real Mac with the approved
optional interpreter/assets. It creates a labelled synthetic image, records
the actual Vision `performRequests` result/error and recognized text, then also
exercises the exact ocrmac wrapper. It writes a receipt and fails on missing
language support, native errors or missing expected text. It never installs or
downloads. The three-paper `docling_corpus.py --engines docling` runner also works
with the native profile; RSS is normalized from Darwin bytes to KiB rather than
mislabelled as Linux memory. Both scripts have now run on the hosted Mac; their
exact receipt and original-page failures are recorded separately.

The hosted [macOS Desktop job](https://github.com/phodal/pero/actions/runs/41771418185/job/126381737392)
for PR head `fc0aa5594d73380bdbff9e2b387ce2a71d2f06eb` passed on
`macos-26-arm64`. Runtime tests were 104 passed and one ignored, including the
Mac-specific crash/lease, inherited lock and normal shutdown cases. The default
Desktop build, typecheck and Host tests also passed. This job did **not** enable
the Native/Wry feature, install Docling, run Vision OCR or click a confirmation.
Its result is evidence for that exact head, not untested later changes.

The subsequent Native/Wry confirmation implementation passed all 21 default
`pero-ui` library tests, including three consent-gate tests. A temporary Rust
harness compiled the actual Native App route and consent modules with the real
HTTP, reqwest and contract types; all nine tests passed, including existing
environment/research routes. Its only stub was the unrelated connector owner.
These prove transport and consent behavior, not a WebKit or GUI run. Local
Native compilation stopped at the missing GPUI checkout preflight. The Mac
Desktop workflow now explicitly checks `--features native --bin pero-native`
and tests `--features native --lib`, rather than relying on default `npm test`
to compile feature-gated routes.
The [exact-head Mac job](https://github.com/phodal/pero/actions/runs/41774957035/job/126393054395)
for `46b0e30b` subsequently passed both commands on native arm64 macOS:
the Native binary checked successfully and all 58 native library tests passed.
This closes compilation and library-contract verification, not actual WebView
request admission, confirmation clicks or source-jump interaction.
The subsequent `native-docling-origin.mjs` probe uses a backend-free Paper
manifest with the real, unmodified Paper UI assets inside an actual WKWebView.
It only reads optional-runtime status and submits a deliberately malformed
approval field that must be rejected; it never approves an installation.
The receipt distinguishes the checkout/merge SHA from the PR head and records
OS, executable/UI hashes, status responses and the absence of installation
files. The fixture does not establish a complete Paper journey or a user click.
Its actual Mac execution result must be checked separately from adding the test.

`Paper optional Docling on macOS` is a separate, explicitly opted-in hosted
workflow: relevant-path, same-repository PRs require `ci:full`; a manual run
requires `allow_official_downloads=true`. It checks out the exact PR head on
the native arm64 `macos-26` runner. The ordinary Python remains separate from
the Host-managed optional runtime. The existing ignored Host smoke installs,
revokes and repairs the official pinned software/model in a new temporary
directory, then the workflow runs the known-input Vision probe, the three fixed
NASA originals and the HTTP save/reopen test. That HTTP test copies the Host's
exact activation bytes, checks their hash before and after, and checks both
status and conversion profile against the activation. It installs no Homebrew
or Tesseract and performs no release or user-computer action.

Evidence is uploaded from `test-results/paper-docling-macos/`: exact head,
activation hash, stage failures, elapsed time, file bytes, per-conversion RSS,
native OCR receipt and original conversion outputs. Runtime, model and source
PDF directories are excluded. A failed Vision probe does not suppress later
conversion diagnostics, but any failed stage makes the run fail. Configuring
HF/Transformers offline mode is not an OS network-isolation proof. Merely
adding this workflow is not a successful Mac execution receipt.
After adding these CI and Native-shell checks, the local full Paper suite ran
330 tests: 326 passed and four explicit opt-ins/platform cases skipped. All ten
workflow contracts passed. The new profile-preserving HTTP branch also passed
against the real Linux optional runtime using a labelled synthetic activation
file; this is not evidence that the older Host fixture emitted a profile.

The independent hosted Mac run passed installation/repair, the native probe,
three original pages and Host-activation HTTP persistence; see the
[exact runtime receipt](paper-docling-macos-runtime.md). Required desktop
acceptance remains: verify live Native/Wry requests, confirm/deny/cancel in each
desktop shell and inspect source jumps. The existing Linux corpus results are
not a substitute, and hosted runtime tests do not prove those interactions.
