---
kind: issue
status: resolved
---

# Online Paper import and PDF reading

Searching `harness` used source order by default. The shared library header's
88px minimum also consumed unnecessary space in Paper's import screen.

Adding Harness² (`2610.14224`) failed because its 124,773-character extracted
full text exceeded the snapshot's 120,000-character limit. Harness Learning
(`2609.35738`) supplied readable text but the native shell did not prepare the
PDFium/Pillow environment that Electron prepares, so PDF reading failed.

## Repair

- Default search to newest and ask sources with server-side date ordering where
  supported. Preserve explicit relevance/citation sorting and separate metrics.
- Keep the SDK header and controls, with a compact Paper header and date display.
- Accept bounded full snapshots up to 1,000,000 characters without truncating
  long online papers or changing their digest. Existing snapshots keep IDs.
- Prepare the shared isolated Python environment in the native composition root,
  preserving explicit Python selections and other settings. Host still owns
  interpreter selection and App processes, and installs no packages.
- Keep retrieved text readable while downloading/parsing PDF; expose retry and
  the original PDF link on failure.

## Verification

2026-10-31, macOS arm64 development workspace based on `1ffda9a0` plus
the scoped changes described here (L1 Desktop fixtures; L2 live literature/PDF reads):

- Python: 30 tests pass, including long online text round trips.
- App TypeScript, App build, root checks and native compile check pass.
- Live source reads: Harness² 124,773 characters / 8,101,889 PDF bytes / 37 pages;
  Harness Learning 108,615 characters / 1,464,869 PDF bytes / 36 pages.
- Executed the actual native preparation function against a disposable home:
  created an isolated venv, installed pinned PDF dependencies and saved settings.

- Actual Electron suite: all 16 groups pass, no unexpected browser errors.
  Covers light/dark, Chinese, narrow/large text, import/search, PDF annotations,
  source-linked answers, exact quotation highlights and restart recovery.
  Agent answers and ordinary source responses in that suite are fixtures.
  Screenshots and receipts: `test-results/paper-agent/`.
- Updated PDF journey selectors for the existing SDK ListRow's title + metadata
  accessible name; replaced a fixed sidebar-width assertion with bounded narrow
  viewport and overflow checks.

The native preparation function was executed independently and the native app
was compile-checked; a new installed/signed native application was not accepted.
Real-provider answer quality and scientific validity are outside these checks.

## Follow-up: demand-driven line reading

The user's follow-up asks for JSON text and reading by line. Added original-line
JSON persistence for new paper/PDF records, backward reads of old string
records, bounded online-text line reads, and line ranges in the existing study
read command. The page catalog now exposes line counts. Each observation keeps
line range, next position and exact character offsets; evidence validation and
PDF highlighting use the existing observed passages.

Live Desktop source import and PDF rendering passed for both Harness papers,
with no page errors. Receipts and screenshots: `test-results/paper-live/`.
The line-reading follow-up passes 32 Python tests, including exact CRLF/Unicode
ranges, bounds/size recovery, line JSON reload, scoped study observations,
report evidence and authenticated HTTP reads.

After the line-reading change, all 16 Desktop journey groups passed again with
zero unexpected browser errors. Both cached real Harness PDFs also passed a
line read through the persisted study ledger, reload, and PDFium quotation
location yielding selectable highlight rectangles. Receipt:
`test-results/paper-live/line-reads.json`. Real model output was not requested.

## Real user-flow polish

Live questions exposed repeated reading on follow-up, ambiguous quote errors,
and an Agent continuing to call tools after a finalized report while the input
remained locked. Version-bound `StudyCarryover`, precise quote recovery messages
and cancellation of the remaining Host turn address these observed problems.
Selection contexts now retain a return-to-source action; narrow navigation
reveals the document, and source buttons expose page numbers. Import waiting,
errors and retry stay beside the result being added.

Real runs, timings, original failures and remaining limits are recorded in
`docs/fitness/paper-research-agent.md`. Screenshots were inspected. The bounded
short follow-up delivered and unlocked in about 12.6 seconds; deep max-reasoning
questions still take minutes. No production or signed/native package claim is
made.
