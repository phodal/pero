# Optional Docling: hosted Mac runtime receipt

On 2026-11-04, the explicitly opted-in [Mac workflow](https://github.com/phodal/pero/actions/runs/41774957023)
passed for source head `46b0e30b481e7509a0f033f0bb767a2a2884c7ea`.
The [execution job](https://github.com/phodal/pero/actions/runs/41774957023/job/126393053204)
used macOS 26.6.2 (build 25G83), arm64 and CPython 3.12.10. This establishes
that particular hosted runtime, not every supported macOS version or a signed
desktop package. Native confirmation clicks and source-jump interactions were
not exercised.
The separate [Native/Wry Mac job](https://github.com/phodal/pero/actions/runs/41774957035/job/126393054395)
also passed the explicit native binary check and all 58 native library tests
at this same head. Those are compilation/contracts, not GUI interaction.

Artifact `13296907128`, named
`paper-docling-macos-46b0e30b481e7509a0f033f0bb767a2a2884c7ea-1`, has ZIP SHA-256
`28e22b94f61f960be744712e1db5bc9d56517305a82b33b858ea8f4faa897bad`.
The original receipt retains the pre-run `macos-runtime-not-tested` label;
that historical string was not rewritten inside the evidence.

## What actually passed

| Stage | Wall seconds | Observed result |
|---|---:|---|
| Host install and repair | 272.250 | Existing Rust smoke: 1 passed, 0 ignored |
| Known-input Vision | 3.125 | Native Vision and ocrmac both recognized `PERO 124` |
| Three original scans | 82.495 | All three selected pages returned raw exports |
| HTTP save/reopen | 63.753 | Real isolated-runtime test: 1 passed |

The Host downloaded and hash-checked the fixed official wheels and model files,
required separate component approvals through its trusted test protocol,
activated only after both verified, detected deliberately removed pypdfium2
code, revoked access and repaired the installation from verified wheels.
It did not automate a click in either desktop shell's confirmation dialog.

The known-input native OCR call returned success without an NSError and used
Vision request revision 3. The wrapper returned the expected text and valid
normalized geometry. This proves that synthetic input, not complete recognition
of the historical charts.

The HTTP test copied the Host's actual activation bytes unchanged into its
temporary store. Its SHA-256 was
`ee186281644318769fd4a76b226f0fa0ea640b315c860c4635e48dd0a21558f2`.
Status and conversion both matched `macos-arm64-cp312`; the activation hash
remained unchanged before and after save/reopen. The ordinary Paper interpreter
loaded neither Docling nor Torch. No numerical assessments or references were
created by layout conversion.

Total verification wall time was 423.036 seconds. The temporary tree contained
1,121,435,744 logical regular-file bytes (about 1.044 GiB), including the runtime,
retained wheels, model and original PDFs, excluding symlinks. This is not the
installed-package size or physical disk allocation. HF/Transformers offline
configuration is not an OS network-isolation proof.

## Original-page results

The original SHA-256 values and approximate visual guides are the same as the
[Linux corpus](paper-docling-corpus.md). The pipeline used fixed Docling 2.146.0,
CPU Heron with two threads and full-page Apple Vision accurate English OCR at
scale 3. It installed no Homebrew or Tesseract.

| Original page | Conversion seconds | Process total seconds | Peak RSS MiB | Pictures | Explicit captions |
|---|---:|---:|---:|---:|---:|
| TN-2825 p28 | 14.522 | 26.464 | 1185.078 | 1 | 1 |
| TM-768 p17 | 13.606 | 26.658 | 1253.875 | 1 | 0 |
| TM-842 p67 | 12.987 | 23.971 | 1300.156 | 3 | 2 |

Process totals include imports, whole-PDF page inspection, selected-page
conversion and result preparation. RSS is the isolated process high-water mark,
not simultaneous process-tree or GPU memory. No hard memory cap is claimed.

- **TN-2825:** the Figure 10 picture/caption relationship is present, with 21
  child references and approximate guide IoU 0.916. Most y-axis ticks are missing;
  the visible negative decimal `-.6` becomes `- 6,`. The value is not reliable.
- **TM-768:** all twelve panels remain merged into one picture with 179 child
  references. Two children have a caption label, but neither is an explicit
  caption relationship. Figure-5a guide IoU is 0.064; independent-panel
  localization still fails.
- **TM-842:** all three pictures anchor to the original page, in spatial order
  10, 12, 11. Caption counts are 0/1/1, and child counts are 11/25/14. Figure 10
  lacks a caption link. Figure 12's linked caption contains a line from the
  neighbouring Figure 10 caption. Figure 11 prose is more readable but still
  has transcription errors; decimal ticks remain unreliable.

The earlier Linux pipeline produced the same picture counts and caption counts
1/0/3, versus Mac 1/0/2. Some Mac text is more readable, but fewer child/text
items do not establish greater accuracy. These are different OCR pipelines on
different machines. There is no Mac Tesseract baseline, equal-configuration
performance comparison or measured accuracy score.

All outputs retain `scientificAcceptance=unverified` and
`completeRecognitionVerified=false`. OS-managed OCR, panel localization and
caption association still require review; a successful installation or
conversion does not admit a scientific numerical reference.
