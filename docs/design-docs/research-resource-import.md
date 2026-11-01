# Research resource import

Issue: [#68](https://github.com/phodal/pero/issues/68). Implementation:
[PR #70](https://github.com/phodal/pero/pull/70), one PR against `master`.

## Use

In **Paper → Add papers → Link**, paste a public research URL and choose
**Find resources**. Review the article, paper, code, model, dataset, benchmark
and service rows, their source evidence, revisions and license information.
Choose references and **Save references**. Available observed article/paper text
is saved through the existing Paper snapshot writer. Code and binary assets
remain remote references. The saved bundle list is available in the same Link
tab after reopening the App.

To download model/data files, choose **Export download plan**, then open the
JSON file in **Data → Research downloads → Open download plan**. Data obtains
fresh metadata for the exact pinned Hugging Face commit. Select one file,
review its license and size, confirm, and choose **Download selected file**.
Progress, cancel, failures and local SHA-256 receipts are shown there. A retry
requires a new explicit action; a completed file is reused instead of duplicated.

This is an explicit file handoff, not a hidden cross-App backend request. Plans
contain references, not credentials or authority. Data never trusts a caller's
download URL, checksum, filename or supplied file size. The normal dataset
browser remains unchanged; research download receipts are a separate view.

Public Hugging Face model/dataset files are supported, one file at a time. Gated
or private repositories require provider access and remain blocked in this
adapter. There is no automatic complete-model snapshot, Git checkout, archive
extraction, dependency installation, model loading or experiment execution.
GitHub repositories remain references; separately requested cloning can use an
existing authorized Agent execution tool and an approved workspace.

## Ownership and tools

- Paper owns immutable import drafts, bundle selection revisions, source text
  and resource relationships in its existing `ResearchStore`.
- Data owns admitted file metadata, local assets and the existing `Downloads`
  job. It does not receive Paper's private directory or token.
- Host retains App installation, App binding, tool policy, Agent execution and
  authentication. A field named `confirm` records user intent, not permission.

Paper declares `research-resources` at `/api/resource-imports`:

```json
{"action":"inspect","url":"https://research.example/article"}
{"action":"save","draftId":"<returned draft ID>","resourceIds":["<selected resource ID>"]}
{"action":"get","id":"<draft or bundle ID>"}
{"action":"list"}
```

The backend rejects extra fields for each action. Inspect saves bounded observed
content; it does not publish selected sources to the library. Save performs no
network or binary download. Stable canonical identities deduplicate known aliases;
separate immutable selection records build one bundle view per canonical seed.
Existing snapshots are never rewritten. A failure during save may leave source
snapshots already persisted; reconcile the bundle before retrying.

Data declares `research-assets` at `/api/research-assets`:

```json
{"action":"prepare","resources":[{"kind":"model","repoId":"owner/repo","revision":"<immutable commit>"}]}
{"action":"download","sourceId":"<prepared file ID>","confirm":true}
{"action":"status"}
{"action":"cancel"}
```

An authorized ordinary Agent conversation can pass `bundle.handoff.resources`
into Data's prepare action, ask one consolidated file-selection question, and
submit the explicitly selected files sequentially after checking status. A
Paper-scoped Agent cannot widen its binding to Data. In that case it should leave
references saved and direct the user to the explicit plan handoff above.
The question is ordinary conversation, not an ACP permission-option workaround.

The dedicated skill is
`apps/paper-agent/skills/research-resource-import/SKILL.md`. Go Harness users
must select its root explicitly with `--skills-root`; merely packaging the file
is not registration. Host-managed Agents receive the concise workflow through
the existing bundled App Use instructions and the declared tool descriptions.
No additional runtime or permission queue is introduced.

## Discovery and integrity boundaries

Discovery follows explicit article links and one bounded provider expansion.
GitHub metadata, an immutable default-branch commit and its README can reveal
paper/model/data links. Hugging Face metadata distinguishes models, datasets
and Spaces and may supply paper references. Formal paper reads reuse the
existing literature client. A cited earlier paper retains its own title and
identity; it is not renamed to match a newer model release.

Arbitrary source reads accept HTTPS on port 443 only, check public DNS addresses,
connect to an already checked address with normal hostname/TLS verification,
revalidate redirects, and reject binary/compressed responses. No credentials,
cookies, browser JavaScript or README commands are executed. Each source read
is capped at 2 MiB and three redirects. An import inspects at most 12 web/metadata
reads plus four calls to the already bounded literature reader, 30 resources,
128 source links and 60,000 extracted characters. Truncation is disclosed.
This is not exhaustive search, full semantic HTML extraction or OCR. Unknown
metadata remains unknown. Snapshot integrity is not scientific validity.

Data prepares at most eight repositories per request and 200 files per repository.
Files need a known positive size up to 20 GiB and a supported provider digest.
LFS SHA-256 and Git blob SHA-1 (including the Git object header) are checked;
the local catalog additionally records the observed SHA-256. Only provider-derived
pinned URLs and the existing explicit HF/CDN host set are admitted. Partial bytes
stay `.part`; failure/cancellation does not publish an asset. Prepared-source
records survive restart, but automatic retry or range resume is not added.

## Verification record

Executed during this implementation with synthetic sources, no public downloads:

```sh
python -m unittest discover -s apps/paper-agent/test -p test_resource_import.py -v
# 12 passed: identity/type classification, source safety, refs-only behavior,
# partial results, selection scope, persistence, repeat imports and restart.
python -m unittest discover -s apps/data/test -p test_research_assets.py -v
# 8 passed: real Catalog/Downloads with synthetic streams, confirmation,
# revision/digest admission, SHA-256/Git checksums, corruption, cancel and restart.
```

Python compilation and TypeScript transpilation/syntax checks for the added
modules/components passed. The Paper tests use an immutable file-store seam;
the Data tests exercise the actual catalog and downloader. These are not claims
of full repository typecheck, installed Desktop integration or live Agent quality.

Still required before accepting the issue: full App typechecks/builds and existing
regression suites, an actual Desktop/Host journey and inspected screenshots,
real Agent tool invocation, and a live TimesFM/HF metadata run. The example seed
is `https://www.research.google/blog/timesfm-3-a-zero-shot-foundation-model-for-multivariate-forecasting/`.
No model size, license or resource availability for that seed is hard-coded or
claimed verified by the synthetic fixtures. No screenshot or live large-asset
success was produced in the current implementation environment.
