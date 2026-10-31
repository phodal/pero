---
name: active-filter-design
description: Design and independently verify an active low-pass filter for an approved, frozen Control Lab experiment.
---

Read the approved experiment first. Record its identity and specification hash,
circuit model, scenarios, units, criteria, component bounds, baseline and
remaining budget. Work only on that experiment; do not create a replacement or
change its model, criteria, scenarios or budget. If the target or its authority
is unclear, stop and ask for clarification.

Use the `baseline` action on the approved experiment, wait for it to finish,
then read its observations and reports before selecting candidates. Propose
component values within the frozen search space, or use `search-next` for one
incremental step. `search-next` first completes missing search scenarios for an
existing candidate; otherwise it adds one deterministic candidate. Read its
evidence before deciding what to try next. Batch `search` fills the remaining
candidate slots, so use it only when that allocation is intended. These actions
do not change the frozen budget.

Compare the measured response with the frozen frequency and transient
criteria, respecting Hz versus rad/s and component units. Read failed or
inconclusive scenario evidence before trying another candidate.

Choose and lock one candidate based on search evidence. Run all frozen final
verification scenarios, then inspect the independent report and saved
observations. Report its verdict, failed or missing criteria, scenario
coverage, limitations and remaining budget. If no candidate is feasible, report
that outcome. Do not change thresholds to remove a failure. Tool completion or
your own explanation is not an engineering PASS; use the verifier's PASS, FAIL
or INCONCLUSIVE and distinguish process errors from it.

The Sallen–Key model uses an ideal VCVS amplifier. Its results do not establish
actual op-amp bandwidth, saturation, supply behavior, noise, tolerances or
hardware performance.
