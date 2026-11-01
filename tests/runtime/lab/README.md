# Lab verification runners

## Deterministic Host integration

```sh
node --experimental-transform-types tests/runtime/lab/run.mjs \
  /absolute/path/to/pero-host /absolute/path/to/python312-venv
node --test tests/runtime/lab/*.test.mjs
```

Requires Node 24+, Linux, loopback listeners and an isolated CPython 3.12 venv
with the exact dependencies declared by `apps/lab/app.json`, including real
PyLabRobot 0.2.2. Build the Host from the source being checked. The runner does
not install dependencies, call a provider, discover hardware or substitute a
fake Lab backend.

It exercises production Host lifecycle, App routing and installed Lab code with
scripted ACP. Checks cover frozen-goal restrictions, linked simulation trials,
compact trial references, original observation bytes and hashes, independent
verification, denied mutations, export, restart without replay and owned-process
shutdown. Only the package HTML is a headless placeholder. This is not GUI,
natural-model or physical-laboratory acceptance. The separate Desktop journey
is `tests/e2e/lab.mjs`.

If loopback binding is unavailable, report that failure and use an authorized
CI environment; do not replace the real backend or bypass the restriction.

## Opt-in natural-model acceptance

`agent-run.mjs` substitutes a supplied Go ACP binary at the same Host seam.
The model proposes a candidate, inspects its synthetic observation and
independent verification, then proposes one linked revision in a second turn.
The runner supplies no protocol or compensation value.

Optional target, tolerance and objective inputs are frozen before proposals.
The domain supplies the observed-fraction default when no objective is given.
The trial budget stays at two; existing permissions, cancellation and bounded
Lab operations remain in force. No native file, shell or computer tools, new
Skill, or separate execution runtime is added.

Independent checks compare model tool proposals with saved protocols, require
feedback before revision, verify observations and numerical outcomes, and check
restart without replay. A first-trial PASS or unchanged/worse revision is
reported as observed. Mechanical receipt validation, meeting the target and
accurate model interpretation are separate assessments.

Provider-backed checks require explicit authorization and are not ordinary CI.
A passing scripted test cannot establish natural-model success. Headless goal
approval is supplied by a trusted test client, not an authenticated human or a
new UI interaction. See [verification boundaries](../../../docs/fitness/lab.md).
