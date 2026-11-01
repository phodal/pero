# Lab: bounded simulation and independent evidence

`apps/lab` is one existing App panel, with Host-owned installation, CPython 3.12,
private token proxy and shared Chat/ACP. It creates no platform scheduler or
Project/Task/Artifact integration. Domain data is under `PERO_APP_DATA`.

- `domain.py`: immutable experiment, criteria, Protocol IR, well/pipette/tip state,
  proposal budget and legal transitions. No I/O. Quantities are µL / fraction.
- `pylabrobot_adapter.py`: pinned real 0.2.2 Chatterbox, 96 resources, trackers.
  No backend selector, device discovery, arbitrary code or fallback.
- `experiments.py`: local immutable candidates and evidence, one active adapter,
  original assets, atomic JSON replacement. Each trial starts from the same
  frozen initial state; it is an independent virtual experiment, not continuation
  of a physical deck. Persist intent before dispatch; commit domain state only
  after matching actual PLR volumes/tip. Preserve mismatch receipts and unknown
  outcomes. Restart is read-only reconciliation, never action replay.
- `evaluation.py`: frozen target/volume checks independent of Agent prose.
  Synthetic/imported observations are distinct from predictions and backend
  resource state. Missing target measurement is INCONCLUSIVE.
- `http_api.py`: bounded authenticated JSON; declared Agent allowlist omits
  review and policy mutation. UI uses separate domain action paths. Full export
  preserves evidence while Agent summaries omit redundant 96-well snapshots.

The demonstrator uses virtual red dye/diluent and volume-weighted fractions.
A labelled deterministic +0.1 measurement fixture exposes a discrepancy; reducing
red input may compensate in this fixture only. There is no noise model, geometry,
collision checking, calibration, fluid physics or biological inference.

A UI review decision records its interaction channel, not authenticated humanity.
AppUse script clicks are refused; that is not protection from a general desktop
operator. `human_identity_verified:false` is exported. Real hardware and strict
human-identity approval need separate future authority/commissioning work.
