---
kind: incident
status: resolved
---

# MCP header helpers require the existing Bash executor contract

The first Linux run of PR #132 failed TestMCPHeadersHelperConnections: neither
credential reached the actual loopback HTTP server. Optional MCP activation did
not fail agent creation, so the observed server headers exposed the failure.
macOS local race and Bazel passed the same test.

The helper supplied /bin/sh to LocalExecutor, which deliberately starts Unix
shells with Bash's --noprofile/--norc flags. Ubuntu resolves /bin/sh to dash,
which rejects those flags before executing the helper. macOS /bin/sh accepts
them, masking the wrong executable selection. Select /bin/bash, matching the
existing native and dynamic skill execution contract, without changing the
shared executor or exposing helper stderr/credentials.

The existing real HTTP regression checks two fresh credentials on two actual
connections and malformed/failed helper redaction. Local runtime race/vet and
the affected Bazel targets pass after correction; Linux confirmation is tracked
by the PR checks. The same CI run separately rejected hand-edited BUILD ordering
and platform dependencies; regenerate with Gazelle and run its mode=diff gate.
