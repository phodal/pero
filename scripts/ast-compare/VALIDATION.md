# Validated reference snapshot

Updated run: 2026-10-31 (ACP source-receipt refresh). Python 3.12.14; pinned requirements; 18 unit tests passed (no skips).

- Official DSH: `f3803c96974ad4a94195fb97e5c637e9c2a3afe3`
- Tested and published Pero source: [`db533bcceb199574a69c1385820a8942a61731e4`](https://github.com/phodal/pero/commit/db533bcceb199574a69c1385820a8942a61731e4). Verified in a detached checkout of this fetched public source ref; `git rev-parse HEAD^{tree}` is `b1a3476c319af1d6ac2f9d7f382272591a48b703`. Every mapped Go file matches both `git show` at this pin and the working source bytes. The mapping uses this fetchable source ref; only the mapping and this validation note change in the receipt-refresh commit.
- Coverage: 17 explicitly selected callable pairs; 11 official files, 10 Go files. This is not whole-module coverage.
- Result: **17 extracted for cross-language review; 0 unavailable**. Exit 0 means extraction only.
- Actual parser: local extension `0.23.2+pero.export-type-star.1`, official CLI 0.25.10, ABI 14, GCC 14.2.0 on Linux. Full original Todo file now parses; its SHA256 is unchanged. No source syntax was stripped.
- Archive SHA256: `0fdf63c35930a75885145d75ee63cb879da2d49db9bfe454bd8e60b08ba778a1`; patched grammar SHA256: `b67967d0c12de9b9a315c657826c428776877ec8a7cd604700d7f6bf4ee6929c`. Original grammar hash is pinned in `build_typescript.py`; per-machine library hash is in generated report metadata.
- Extraction and observed landmarks do not establish semantic equivalence or passing behavioral tests.

## ACP source-receipt refresh

The previous `bac3bbaf6edd66357d6972eea86e71eb65ad8f86` mapping reproduced
**14 extracted / 3 unavailable**, exit 2, against the fixed `db533bc` checkout.
All three unavailable pairs reported `source_hash_mismatch` for
`harness/go/acp/server.go`: `acp-prompt-admission`, `acp-cancel-admission` and
`acp-settlement`. They were not missing symbols or parser failures.

Reviewed the file diff from the previous pin. Commit `9b91b793d4ec5820fa67945d241afc768fff86e2`
adds `ensureAutoReview` calls before activation in `newSession` and
`resumeSession`, outside the selected functions. Both selected declarations
remain byte-for-byte unchanged: `Server.prompt` is now lines 516–560 (1,589 bytes,
SHA256 `f6d2e97bd26d18e20e9f971791f0514ff94c0a686c9acb54c5433a8483debef8`),
and `Server.handleNotification` remains lines 383–406 (626 bytes, SHA256
`eb174f0e12a1cc33ec736acbe2276d8bda78d771fd8fc96d1bf0ba4433859d25`).
The containing-file SHA256 is refreshed in all three selectors; the other nine
mapped Go files and all eleven official files retain their previous hashes.

The official source was independently fetched at the unchanged `f3803c9` pin.
All 21 unique mapped files were compared with their pinned Git objects and
selector hashes. With the unchanged pinned grammar, all 18 unit tests passed
without skips; the refreshed mapping extracted **17 / 0 unavailable**, exit 0.
The before/after JSON and Markdown reports and test log were generated outside
the repository. No pair, landmark, source-hash check, parser check, official pin,
exit contract or `cross_language_review_required` status was changed.

This repairs source admission, not a permission policy. The new helper records
`auto-review` for a new or restored session lacking a preset; an existing preset
is retained. That mode allows approval requests without consulting an answerer,
while `ApprovalNever` still rejects them. This is a distinct permission semantic
change outside the selected callable pairs, not proof of automated safety
review, runtime acceptance or official DSH parity. It requires separate policy
and behavior review; these extraction results do not establish those claims.

## Historical Windows source-receipt refresh

The previous mapping still recorded the `ad001471c794cb5d116729b6631c7f7f4a731260`
source snapshot. With the pinned grammar and current source, the unchanged
mapping reproduced **15 extracted / 2 unavailable**, exit 2. Both unavailable
pairs, `read-physical-window` and `read-continuation`, reported
`source_hash_mismatch` for `harness/go/fstools/workspace.go`; these were not
TypeScript parse failures.

Reviewed the file diff and both official read functions. The Windows changes
alter workspace admission, platform dispatch, link checks and new-file
publication outside `FormatRead`. The mapped `FormatRead` declaration and body
are byte-for-byte unchanged from the previous pin (now lines 413–461). Its
containing file is different, so both selectors retain their full-file hash
checks with the new SHA256 below. The other nine mapped Go files and all eleven
official files retain their existing hashes. No pair, landmark, parser check or
hash check was removed; the official DSH pin remains unchanged.

The refreshed mapping extracted all 17 pairs from the two fixed source
checkouts with exit 0. All 18 parser/extractor unit tests passed without skips.
This repairs source admission only: the intentional 16 KiB versus 50 KiB caps,
Go JSON versus official text envelopes, and cross-language review requirement
remain unchanged. Windows runtime acceptance is a separate CI contract.

## Selected pairs

| Pair | Result |
| --- | --- |
| `core-max-token-dispatch` | cross_language_review_required |
| `core-max-token-sticky` | cross_language_review_required |
| `stream-truncated-tools` | cross_language_review_required |
| `provider-error-classification` | cross_language_review_required |
| `provider-usage-validation` | cross_language_review_required |
| `read-physical-window` | cross_language_review_required |
| `read-continuation` | cross_language_review_required |
| `acp-prompt-admission` | cross_language_review_required |
| `acp-cancel-admission` | cross_language_review_required |
| `acp-settlement` | cross_language_review_required |
| `session-torn-tail` | cross_language_review_required |
| `session-tail-recovery` | cross_language_review_required |
| `storage-migration-marker` | cross_language_review_required |
| `todos-normalization` | cross_language_review_required |
| `todos-composition` | cross_language_review_required |
| `mcp-tool-capability` | cross_language_review_required |
| `mcp-structured-output-gap` | cross_language_review_required |

## Historical before/after evidence (stock grammar)

Compared against initial Pero `d258dacfefe72534f74337f59a7948f0e68e064e`:
- Go declaration mode: 3 added, 35 modified, 3410 unchanged, 16 ambiguous identities; valid parsing, exit 2. Platform alternatives and repeated declarations are not arbitrarily paired.
- Official references: initial 14 extracted / 3 unavailable; final 15 / 2. The added JSONL scanner selector resolves in the final snapshot.
- New structural landmark observations cover output-limit dispatch/sticky state, safe usage counters, read continuation offsets, ACP admission/cancel/settlement, JSONL tail boundaries, storage marker gating and MCP capabilities.
- These are lexical AST observations, not regression-test outcomes. Intentional provider, persistence and capability differences remain annotated in the mapping.

## Reproduction

Install the pinned requirements, build the local TS5 grammar and run tests as shown in README. Without that build the stock grammar retains its two explicit parse failures. With the exact source checkouts:

```sh
python scripts/ast-compare/references.py \
  --mapping scripts/ast-compare/mappings/official-dsh.json \
  --left-root /path/to/dsh-f3803c9 --right-root /path/to/pero-db533bc \
  --json /tmp/official-dsh.json --markdown /tmp/official-dsh.md
```

Full JSON/Markdown are deliberately generated outside the repository. JSON contains exact raw fact text, byte spans, nested callable context, actual hashes and parser diagnostics. Ref labels alone are not Git attestations; selectors enforce the following byte receipts.

## Verified source receipts

Each unique file below was independently compared byte-for-byte with `git show REF:path` in its source checkout and its mapping SHA256. Repeat this check when changing refs. No source content is vendored.

| Side | File | SHA256 |
| --- | --- | --- |
| left | `packages/acp/acp/src/session.ts` | `e4d624d1a4d305d924ae0cff23e0f005becf9a797b02c037e45a1e86c3c17d12` |
| left | `packages/core/agent-loop/src/agent.ts` | `ad9ee0778c0a93dec40363f88b53f442add9b033837b9ff049675a1ada3df61f` |
| left | `packages/fs/tool-fs/src/read-render.ts` | `72bcf4a70fd3e0908d4aa3869e0fbd6ee63b05ad790af65951af0c5db9edba84` |
| left | `packages/llm/llm-deepseek/src/translate.ts` | `254f4b8fe292dadc5c24df3375b01920f5e5b345be09eae4290e91e9e810c1ba` |
| left | `packages/llm/llm-deepseek/src/transport.ts` | `7d1f6ed8fe861ee71ba2d0c6a2a9e8512ddc1b6dc17d43a8795ab520a38746b6` |
| left | `packages/llm/llm/src/assembler.ts` | `a2d065645058a70195a504b101e9eed23df3eaced3def868d602f3a863b03887` |
| left | `packages/mcp/mcp-client/src/tools.ts` | `59203150bda479a990afcdaf60483a35a836887926892e1074e02d0294c01af9` |
| left | `packages/session/session-persistence-jsonl/src/format.ts` | `87d536ead041fb953f866e0191a79b4dbbbc510aee1461706f9cdc2e4c46a038` |
| left | `packages/session/session-persistence-jsonl/src/storage.ts` | `57d5fa1d7efd17789d6a223f6aa5e06b79092665bea13f8a23d3bab644d066c3` |
| left | `packages/storage/storage-json/src/per-record-unit.ts` | `9aa4df293c02c28aaf74515443a7c089c660c33e66c3ece2255ff8c53d47add1` |
| left | `packages/todo/tool-todo/src/index.ts` | `80559ed95b7fc9c1dc083312f187885254bf2c1498d0f7a079dad21427d24def` |
| right | `harness/go/acp/server.go` | `aff1929fafdce8abbf04970466b46bf6a32a44b1feeae69d9c2356ce446dbd5e` |
| right | `harness/go/cmd/pero-agent-acp/coding.go` | `6898a4178c921c7683991e735c369554978162b610de0237b1728b07ab53c583` |
| right | `harness/go/fstools/workspace.go` | `f24afcaace3efc212eac8f765d39e055032d2115b25b37690cb28298ddd6ffd6` |
| right | `harness/go/harness/loop.go` | `95113ee77a8856acf39b64319cb1db92cabc2799e8e1581796885e6daa64d798` |
| right | `harness/go/mcp/tools.go` | `d96b44c95d72f1df01643024312ce3bfc8400159abbccf527a2d9ae3b00a136e` |
| right | `harness/go/providers/openai/provider_errors.go` | `20ce09a75aa29b167c5e680dd14643ebd60593a5866451f22ba12f3b198ba8ab` |
| right | `harness/go/providers/openai/stream.go` | `2cecfaf622dcebbb5400207ddeadd95d2b24ed3c9ece466d82fa8d42288aae8f` |
| right | `harness/go/session/persistence.go` | `99ce800c2ae64af1e927388b9eaa54967f1284e12be5d2458bb0865812fab1cf` |
| right | `harness/go/storage/json_units.go` | `f001054d8cf58146d48c7ed840f96866edbd0da5ea6488e79b2116ec73491f52` |
| right | `harness/go/todos/normalization.go` | `df8da35d86358b0d8e5a9be8226c1b17cef340d3c4a4da34b0337ed84ed26d09` |
