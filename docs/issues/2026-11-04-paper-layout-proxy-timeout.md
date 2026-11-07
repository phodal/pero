---
kind: issue
status: open
date: 2026-11-04
github_issue: 124
github_state: closed
github_url: https://github.com/phodal/pero/issues/124
---

# Native Paper layout request ends before conversion

The Native App proxy uses a 30-second HTTP deadline. Paper's isolated Docling
converter permits 180 seconds (including imports and model initialization),
with a 120-second cooperative document conversion limit. A conversion lasting
more than 30 seconds therefore returns a proxy 503 while the Python backend
may still complete and save the layout. Retrying the POST can repeat expensive
conversion instead of retrieving that saved result.

The Native proxy now allows 210 seconds only for `paper-agent`'s
`POST /api/numeric/layout`. This bounds the transport above the existing
converter deadline without changing other App routes, origins, permissions,
setup confirmation or scientific acceptance. The UI should reread saved
records after an uncertain request instead of automatically replaying it.

A loopback regression test holds the backend response across a shortened
proxy deadline. The selected layout POST must still return its 201 result;
GET, another Paper API and another App retain the ordinary timeout.

Cloud source review and `git diff --check` passed. This workspace has no
Rust compiler or Cargo, so the new Native test has not been executed here.
The reported real Mac 503 has not been reproduced with instrumented timings;
the proven deadline mismatch is consistent with it, not proof that every 503
has this cause. Keep this record open until Native CI and a slow-conversion
runtime check establish the repaired behavior.

GitHub #124 closed completed on 2026-11-04. That ticket is the scanned-PDF
numeric source check, so its closure does not accept this proxy deadline.
