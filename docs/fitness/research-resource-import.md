# Research URL import (#68)

Independent implementation from merged `master` 5d9bbd40. No other implementation
branch or PR was used. This is one Paper/Data/Host feature, not an Agent runtime,
crawler platform, graph database or download manager.

## Owners and limits

- Paper owns typed resources, a persisted inspection draft, immutable bundle
  revisions and references to existing immutable `PaperSnapshot` records. Article
  excerpts retain `resourceKind=web_article`. Aliases merge before snapshot saving;
  requested arXiv versions remain distinct observations of the same bundle.
- Inspection starts/reads/cancels through short authenticated requests, compatible
  with App Use's 15-second deadline and 1,000,000-byte response limit. One spawned
  metadata process has a 55-second lifetime; a separate watcher exits on parent
  loss. Cancellation terminates and joins it, including blocked DNS/headers.
  Restart marks unfinished drafts interrupted, never successful.
- The metadata resolver permits only public HTTPS, pins resolved public addresses
  while verifying the original TLS hostname, rechecks redirects, uses no cookies,
  authorization headers or environment proxy, and reads at most 1 MiB per response.
  It allows at most 18 requests, 32 references and 12 follow-up resolutions; it
  never reads model/data bytes. Credential-bearing or signed input URLs are refused
  without echoing secrets. Text/links remain untrusted data.
- Explicit links and GitHub/HF metadata are used; papers reuse `literature.py`.
  HF model/dataset/space identities stay distinct. Benchmark links are not offered
  as datasets. Version-specific GitHub/HF paths currently remain visibly unresolved
  references rather than silently resolving the latest revision. Ready drafts are
  reused; `refresh=true` explicitly requests a new observation.
- Host owns the fixed Paper→Data action. It requires enabled Paper with the declared
  `research-assets` grant and enabled Data, resolves both private backends itself,
  and retrieves an approved descriptor from the saved Paper bundle. UI and declared
  Agent writes use that same authority. An interrupted dispatched call has an
  uncertain outcome: query status before retrying, and cancel explicitly.
- Data owns binary storage, its existing single download worker and verified atomic
  publication. Only offered pinned HF files are eligible. Approval IDs bind file,
  revision, size, checksum and license. A later review starts only its newly selected
  IDs, not old approvals. Temporary signed CDN redirects remain transport-only
  within Data's existing allowlist; their URLs are not saved or returned.
- The skill is embedded in the Host context picker and tested for actual loading.
  The Go catalog remains explicit-root/read-only; opting into Paper's `skills`
  directory is documented. Skill text never grants permissions.
- **Clone with Agent** freezes a saved GitHub reference into the existing Host
  composer. It is an unsent request, not clone authorization, execution, or a local
  asset receipt. Any later clone must use existing authorized execution tools after
  confirmation of destination, revision, license and size, without checkout,
  submodules, LFS materialization or running repository code. Only an actual Host
  execution can provide a resolved commit/path/tool receipt. Paper does not write
  a completed-clone state. This implementation's tests stop at the composer.

## Verification (2026-11-01)

Local source/contract evidence, not release acceptance:

- Paper hermetic suite: 47 tests, 46 passed and the Windows-only force-kill test
  skipped on Linux. It covers classification, alias and version identity, source safety,
  malformed/partial metadata, immutable persistence, explicit download selection,
  restart, short authenticated HTTP, worker timeout/cancel/parent loss.
- Data hermetic suite: 25 passed. It covers pinned admission, byte/checksum verification, partial-file
  cleanup, receipt scoping, dedup, explicit retry, missing files and restart.
- Real installed Paper backend → Rust Host → Data backend fixture:
  `node tests/contracts/research-import.mjs`. Only metadata and byte-stream provider
  seams are synthetic; tiny bytes, no external network/model calls.
- Agent/desktop adapter tests use the existing App Write grants and interruption
  semantics; native transport has a focused module harness. This is not a full
  native GPUI build or a real model-provider session.
- `node tests/e2e/paper-research-import-all.mjs` runs broad UI state fixtures and a
  real Electron→Host→Paper journey: inspect, persist an uncommitted draft, restart,
  save references, read the excerpt, repeat, restart and reopen the bundle. It
  records screenshots and loaded asset hashes. Hosted full-tier CI owns this run;
  local browser execution was blocked by environment socket restrictions. No local
  GUI pass is claimed. Windows parent-loss handle verification is also hosted-only.

The opt-in `test/manual/research_metadata.py --allow-public-metadata` records actual
TimesFM article and HF candidate metadata observations separately. Full-tier
`paper-research-import` runs it in a separate three-minute step even after a GUI
failure, but not after cancellation. `test-results/research-import/live-metadata.json`
reports `METADATA_OBSERVED` or `INCONCLUSIVE` per independent seed and preserves
unresolved reasons; observing the HF candidate does not imply an article link or
scientific result. The initial local application run was blocked by
DNS (`gaierror`) and correctly returned an unresolved article with zero assets.
A separate web read saw the public Google article and HF model card (non-commercial
license; foundational arXiv 2310.10688 citation); that is **not** an application
live-network pass. Hosted evidence must distinguish successful parsing from network
unavailability. No real LLM calls, model/dataset downloads, clones or experiments
were performed during implementation.

Existing aggregate `tests/contracts/apps.mjs` fails locally at its Python
environment-recovery case (second enable at line 231). An exact `5d9bbd40`
Host-only build (119 crate files checked against Git blobs) and the current Host
both reproduce its binding mismatch with the unchanged fixture: initial recovery
selects a managed venv, while the fixture subsequently repairs a different original
venv. This controlled comparison denied package installation before any network
and did not set `UV_OFFLINE`; it establishes that the mismatch predates #68, not
an unrestricted baseline-suite result or the complete cause of the original local
failure. Baseline CI does not invoke this standalone fixture. It remains unchanged;
the focused research-import contract passes independently.
Full `npm run check` locally requires the absent generated reader-Wasm declarations;
focused Paper typecheck and generated contract checks do not certify a full build.
Screenshots/receipts are CI artifacts, not committed binaries. A draft PR, passing
source tests or a successful import does not establish scientific reproducibility,
license suitability, signed-package readiness or cross-platform GUI acceptance.
