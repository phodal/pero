---
name: control-design
description: Design and independently verify a controller for an approved, frozen Control Lab experiment.
---

Read the approved experiment first. Record its identity and specification hash,
plant, scenarios, units, criteria, search bounds, baseline and remaining budget.
Work only on that experiment; do not create a replacement or change its model,
criteria, scenarios or budget. If the target or its authority is unclear, stop
and ask for clarification.

Inspect the baseline and its observations before selecting candidates. Use a
bounded search or propose controller gains within the frozen search space and
remaining candidate budget. Compare tracking against the specified reference,
as well as disturbance, effort, stability and sampling evidence where required;
a response settling around the wrong value is not successful tracking. Read
failed or inconclusive scenario evidence before choosing what to try next.

Choose and lock one candidate based on the search evidence. Run the complete
frozen final verification scenarios, then inspect the independent report and
its saved observations. Report the verdict, failed or missing criteria,
scenario coverage, limitations and remaining budget. If no candidate is
feasible, report that outcome. Do not change thresholds to remove a failure.
Tool completion or your own explanation is not an engineering PASS; use the
verifier's PASS, FAIL or INCONCLUSIVE and distinguish process errors from it.
