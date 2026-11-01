# Lab verification

[PR #74](https://github.com/phodal/pero/pull/74) merged the bounded,
no-hardware Lab workbench. Verification distinguishes three outcomes:
execution completed, independent criteria satisfied, and a review decision.
None implies physical or biological validity.

## Verified software behavior

- Frozen objectives, criteria, initial state and trial budgets; typed protocols,
  resource validation and real pinned PyLabRobot Chatterbox execution.
- Linked revisions, labelled synthetic observations, original CSV/JSON bytes and
  hashes, independent evaluation, honest no-improvement comparisons, export and
  restart without replay.
- Host-bound App tools and explicit UI review. Agent tools cannot change frozen
  rules or record a review acceptance.
- The merged Desktop journey covered installation, shared Chat, scripted ACP,
  simulation, observations, review, export and restart. See the public
  [full Desktop CI](https://github.com/phodal/pero/actions/runs/41280752769) and
  [Linux CI](https://github.com/phodal/pero/actions/runs/41280858411) records.
  Scripted ACP is transport coverage, not natural-model acceptance. Earlier
  failed checks remain failures; later successful checks do not erase them.

## Real-Agent follow-through

Opt-in real-provider exercises used the actual Go Harness → Host → bounded Lab
route for model-proposed linked trials. Independent saved evidence corroborated
execution and feedback-based revisions. Outcomes included both improvement and
no improvement; successful execution is not proof that the target was reached.
An explicitly frozen synthetic-observation benchmark demonstrated improvement,
not physical composition validation or general model reliability.

The exercises exposed ambiguous observed-versus-simulated target wording,
trial-ID discovery friction and provenance wording, now clarified. Earlier model
reports also misstated resource consumption and fixture behavior. Model prose,
including unsupported physical extrapolations, remains subject to review against
saved state and the independent evaluator; it is not authoritative evidence.

## Remaining boundaries

- Chatterbox is simulation only: no hardware discovery, calibration, collision,
  optical/fluid physics, biological or empirical Google-performance validation.
- UI review records a UI action, not authenticated human identity. Strict
  human-only acceptance is not implemented or claimed.
- The Native shell guard has source review only; its feature-gated runtime tests
  were not compiled or run. Electron success is not Native runtime proof.
- No additional cross-platform GUI, mobile, signed-package or release acceptance
  is claimed by the headless Agent exercises.
- The [original-paper comparison](../design-docs/lab-google-reproduction.md)
  covers constructed resource-state checks and a published scoring formula.
  These are software checks, not physical or biological reproduction.

See [Lab setup and deterministic tests](../../apps/lab/README.md) and
[runner scope](../../tests/runtime/lab/README.md). Ordinary CI runs the Python
suite and `node --test tests/runtime/lab/*.test.mjs` without calling a provider.
