---
kind: verification_report
date: 2026-10-29
status: verified_local
---

# Paper discovery from a saved source

Local source checks and Electron acceptance on macOS arm64. Observed HEAD
`2f9a394862aa156f46d22ddc836f9bd48b575293` plus this working tree. Shared Chat/App Use, manifests and other
parallel changes remain present; they are not attributed to this feature.
No commit, deployment, release package or real model research was performed.

## Behavior

- Reader explicitly opens discovery from its current immutable paper snapshot.
  Related papers, references and citing papers remain separate relationships.
- OpenAlex work IDs and DOI URLs resolve directly. Unresolved identifiers fall
  back to up to five title candidates; the user checks title/authors/year before
  choosing. A failed provider request stays an error with retry, not a fabricated
  recommendation list.
- Each stored result fixes seed, matched OpenAlex work, relation, page, provider
  and retrieval time. Reopening history reads the stored batch without new search.
  Returning to the current seed keeps its Reader view. Reading another candidate
  does not automatically replace the exploration seed.
- Favorites are unique by OpenAlex work and preserve their first discovery source.
  Saving requires no abstract and does not change selected papers or frozen input.
- Add to matrix research saves readable abstract text and explicitly selects seed
  plus candidate. It prepares a new comparison instruction, respecting the existing
  five-source limit. The existing Host Agent generates a new report when started;
  no cells are appended to previously frozen reports.
- Both discovered results and saved candidates can enter comparison. Missing
  abstract records remain saveable but require original text import for comparison.

Interaction references: [ResearchRabbit](https://www.researchrabbit.ai/articles/guide-to-using-researchrabbit),
[Litmaps](https://docs.litmaps.com/en/articles/9092911-search-for-articles-with-litmaps).
OpenAlex query shapes were checked against its
[official API recipes](https://help.openalex.org/how-to/api-recipes/).
No code from the two product interfaces was copied.

## L0 and L1 evidence

- App typecheck and production build pass.
- All 13 Python tests pass. New behavior tables check relationship direction,
  pagination/order, seed matching, invalid requests, stored identities, favorite
  deduplication, provenance, missing abstracts and unchanged frozen research.
  The existing loopback HTTP workflow now covers discovery, history, bookmark and
  materialization routes through the authenticated transport.
- `npm run test:paper` passes all 12 workflow checks. The real Electron,
  Host and Python backend run with synthetic ACP output. Only the external HTTP
  seam is replaced in the disposable installed App copy; production server.py and
  network configuration are not changed. The suite makes no external network or
  real model requests.
- UI assertions cover explicit seed confirmation, all three relations, rate-limit
  error/retry, empty results, pagination, save without changing comparison, metadata
  bookmarks, add-to-matrix, the resulting two-paper matrix, return to seed,
  saved-source reopening after relation changes, direct comparison from favorites,
  and restart recovery without extra Agent execution.
- Light screenshots and dark Chinese narrow screenshots were visually inspected.
  Document overflow, source/citation behavior, exports, cancellation and prior
  scientific content rendering continue to pass.

Payloads: JS `0da17a5af3814c1ad76213fdd9bcca89c814db1c6ef52651dc58581de7babb5c`;
CSS `4dae84ad6fc07648a514e27f99986884cb8b8fc2f9fc4a789b18e1c32b057bf5`. No unexpected browser errors.
Evidence: `test-results/paper-agent/result.json`, `discovery.png`,
`discovery-dark-narrow.png` (generated and ignored).

## Bounded live retrieval

A read-only Python adapter probe resolved DOI `10.7717/peerj.4375` to OpenAlex
`W2741809807`, *The state of OA: a large-scale analysis of the prevalence and
impact of Open Access articles*. On 2026-10-29 it returned 6 related papers,
12 first-page references and 12 first-page citing papers; references and citing
queries reported further pages. Evidence: `test-results/paper-discovery/live.json`.
This verifies those public transport paths, not recommendation quality, full
provider coverage, live Desktop acceptance or scientific conclusions.

## Remaining scope

One relationship provider (OpenAlex), twelve items per page, maximum 100 pages;
existing 200-document-per-kind store limit remains. Related lists can be empty or
unavailable. Abstracts stay explicitly marked as abstracts. This feature does not
add PDF extraction, cell editing, multi-seed recommendation training, a graph
canvas, a new model runtime or execution scheduler. Real provider-generated matrix
quality and scientific acceptance remain unverified.
