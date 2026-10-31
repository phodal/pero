---
kind: incident
status: open
date: 2026-10-31
---

# Adaptive ngspice output exceeded the observation budget

The frozen plan and per-operation admission estimated each trial using the
requested `samples`, while ngspice retains adaptive transient time points and
can return more. A temporary real ngspice 46 Store experiment reproduced the
resource-limit defect: an active-filter experiment with candidate budget 30
and `samples=1212` admitted its search as 36,360 points but persisted 40,407
observation points across 30 completed search trials. This demonstrates a
resource-cap failure, not a numerical false PASS.

The implementation under review defines a per-trial reservation of
`max(1000, 2×samples)` for ngspice and `samples` for python-control. Frozen
plan admission and later operation admission use that same bound. The ngspice
table reader rejects rows beyond the bound and retains the generated failure
artifacts; the Store also rejects any solver result whose series exceeds its
reserved bound. It does not truncate an observation or convert an over-limit
attempt into PASS. The bound is a resource policy, not a guarantee that every
valid circuit will fit within it.

The 40,000-point accounting adds the longest observation curve for each
completed trial with an observation. Every non-completed trial, including one
with a partial observation, is charged the greater of its recorded point count
and a full per-trial reservation; a completed trial without observation is
also charged a full reservation. This constrains accepted observations and
retry admission. An oversized raw failure table is retained as diagnostic
evidence and its actual raw rows are **not** covered by that point-count cap;
the separate 15 MiB limit applies to portable export bytes, not to a raw file
at generation time.

Existing Spec hashes and stored records remain unchanged and readable. An older
record, including one already beyond the revised budget, is not rewritten;
new operations on it must pass current admission and can be refused. Working-
tree regressions cover oversized solver output, legacy records, scenarios and
retries. Full strict solver and exact-head CI verification are pending.
