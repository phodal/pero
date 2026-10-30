---
kind: issue
status: resolved
---

# Retrieval planner rejected a real Agent's surrounding prose

The Meta-Harness journey with a real Codex Agent returned a short explanatory
sentence followed by the requested `{ "query": ... }` object. The planner parser
accepted only bare JSON or a fenced JSON block, so it rejected this usable
structured response before searching. Fixture output had not exposed this.

Accept exactly one complete JSON object within surrounding prose. Continue to
reject ambiguous multiple objects, unknown passage IDs and invented quotations.
The change concerns response framing, not evidence validity or scientific
acceptance. Add the real response shape to the existing retrieval flow check and
rerun the real-paper/real-Agent journey.

## Verification

The live rerun successfully parsed the planned query and both evidence selections.
The regression check accepts prefaced JSON and refuses multiple objects. The next
answer exposed two existing prompt omissions: the eight-reference-per-array
limit was not stated, and matrices were requested only for multi-paper comparison.
The prompt now states the limit and asks for structured matrices whenever the
user requests one. Oversized evidence still fails validation; no quotations,
references or matrix values are silently removed. Live answer acceptance is
recorded separately in `docs/fitness/paper-harness-journey.md`.
