---
kind: incident
status: resolved
date: 2026-11-05
---

# Paper research integration left two Host contracts behind

PR #130 CI run 41987317846 tests its merge with master `6b75aa6d`. The Data and
Viewer gates pass, but the core gate fails in two contracts introduced by that
newer master revision:

- Host capabilities report `research_watch` alongside `agent`, while TypeSpec
  still permits only `agent` in `supportedMethods`. The actual Host Automation
  contract fails JSON Schema validation before running its lifecycle checks.
- The research-assets transport now admits 64 KiB for frozen research metadata,
  while its authorization test expects a 4,097-byte body to return 413. That
  whitespace-only body is now admitted by size and fails JSON parsing with 503.

Keep the implemented capability and transport boundaries. Update their owning
TypeSpec declaration and existing boundary test, regenerate contracts, and run
the actual Host Automation and research-asset tests before retrying CI.

TypeSpec now lists both implemented methods and the generated JSON Schema and
TypeScript agree. The research-assets boundary test admits valid JSON padded to
64 KiB and refuses 64 KiB + 1; it retains its method and origin checks. The
actual Host Automation lifecycle passed locally with the current development
Host binary and a canonical temporary directory. The 19 research authorization
tests passed with CI's Node 22 runtime; generated-contract checks and core
TypeScript also passed. The combined Data suite still passes 64 Python tests
and all seven browser tests.
