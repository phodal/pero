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
  a completed-clone state. The original #72 tests stop at the composer; the controlled-clone follow-up below records its own verification.

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

## Controlled clone follow-up (#68; merged #87)

The built-in Unix Pero Agent now advertises `clone_repository` independently of
its generic shell tool. The CLI composition requires the explicit
`--enable-research-clone --workspace <directory>` flags. Custom Agents and Windows
are not asserted to have this capability. The Paper button still prepares an
**unsent** request; it never grants permission or records a completed clone.

GitHub source inspection resolves the API-reported default branch to a full commit,
checking repository and commit identity and recording the metadata URL. Failure
keeps revision unknown. The controlled tool requires that exact SHA, a new single
workspace directory, saved bundle/resource identifiers, and reviewed license/size
(unknown is explicit). Each call reuses existing ACP approval, execution timeout,
process cancellation and session tool history. No Paper endpoint accepts a caller's
success receipt. Actual Git exit status, exact HEAD and origin produce the typed
receipt; incomplete/error/unknown execution never produces `completed`.

The operation initializes an empty repository and fetches the exact commit without
checkout. It disables inherited Git configuration, hooks/templates, credential
helpers, unapproved protocols and HTTP redirects; it does not recurse submodules,
materialize LFS, install dependencies or execute repository code. The existing
executor caps time at 120 seconds and output; a 128 MiB per-file limit also applies.
This is not an aggregate download quota or OS network sandbox. An existing target
is refused, including after interrupted work; inspect it before a separate retry.

The real receipt remains visible in the expandable `clone_repository` tool result
in the shared Host conversation and its saved history, rather than in model prose
or a fabricated Paper asset. Bundle/resource IDs are source references, not proof
that their metadata is semantically correct. No same-machine adversarial isolation
or public-network clone success is claimed.

Local follow-up evidence (Linux; source changes independently reviewed):

- Paper backend: 127 tests run, OK, one existing Windows-only skip. Focused
  research-import tests: 13 run, OK, one Windows-only skip. Data research-download:
  13 passed. Paper TypeScript typecheck passed.
- Go native-tools, ACP and ACP command packages passed with offline module caches.
  Real Git fixtures cover exact commit/origin, no checkout, no implicit source
  execution, invalid input/no effects, existing target refusal, failed fetch,
  cancellation, and actual tool-produced receipt after approval.
- Trusted `AlwaysAskApproval` registration goes through the existing permission
  broker; auto-review cannot silently allow the clone. Broker tests preserve
  read-only/never denial. ACP wire fixtures exercise real request_permission under
  auto-review with allow and reject; rejected tool bodies never run. Native clone
  opt-in does not enable the generic shell tool.
- Initial runs exhausted the environment's `/tmp` tmpfs during Go linking and a
  Paper HTTP case. Complete reruns with a task-owned workspace temporary directory
  passed; the failed runs are not counted as passes.
- At this local-verification stage, no fresh Desktop screenshot was available.
  The hosted clone-specific UX check subsequently passed as recorded below. No
  public GitHub clone, Windows clone, paid-model or release-package acceptance
  is claimed by this follow-up.

The existing `paper-research-import` Desktop suite now includes a clone-specific
Linux journey: real permission UI Reject/Allow, actual Go tool/Git observation,
expanded tool result and history after restart. Its provider is scripted and its
strict test-only shell wrapper maps only the fixed fixture fetch to an owned
local repository; production URL policy is unchanged. The wrapper's real Git
smoke and scripted provider loopback checks passed locally. Required local Desktop
dependencies were unavailable, so this GUI journey was not run locally. The later hosted acceptance below establishes the Desktop
journey, not public HTTPS acquisition.

## Final hosted clone acceptance (2026-11-01)

Merged [#87](https://github.com/phodal/pero/pull/87) has final head `6587d6bf`,
which passed [ordinary CI 41324991989](https://github.com/phodal/pero/actions/runs/41324991989).
Earlier feature head `50f798f` passed
[full CI 41322228212](https://github.com/phodal/pero/actions/runs/41322228212)
and [ordinary CI 41322457941](https://github.com/phodal/pero/actions/runs/41322457941).
The full run tested merge revision `668e843`; its tree `cf44426f` matches the
final `6587d6bf` tree. This is identical-tree evidence, not a full run at the final
head SHA.
The actual Linux Desktop journey verified rejection without effects, approval
with a real Go/Git typed receipt, and reopening the original conversation after
restart with the identical full receipt and no provider replay.
[Artifact 13090037767](https://github.com/phodal/pero/actions/runs/41322228212/artifacts/13090037767)
was inspected, including the expanded history screenshot. This is L1 scripted
provider/local-transport evidence, not a live public HTTPS clone or real model.

Together with [#72's final hosted acceptance](https://github.com/phodal/pero/pull/72),
this closes the controlled-clone acceptance gap in #68. The original Paper/Host/Data
contracts already cover explicitly approved eligible pinned HF files, actual tiny
verified bytes, scoped receipts, cancellation, dedup and restart; the #72 Desktop
journey itself did not download binaries. Its separate live application metadata
checks observed TimesFM and the HF candidate with zero downloads/model calls; no
concrete dataset was identified. These evidence layers remain distinct. Unsupported
sources/platforms, arbitrary datasets and scientific validity are not implied.
