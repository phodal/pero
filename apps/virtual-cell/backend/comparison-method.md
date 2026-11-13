# Frozen perturbation comparison

Method package: `virtual-cell.comparison`, version `1.0.0`.

An App-scoped Agent uses the existing Host App Use tools `import-inputs` and
`comparison-step` (12 calls per mounted connection). `comparison-step` accepts
`read`, `start-model`, `stop-model`, `run`, `check` and `cancel`; input actions use
the returned immutable `inputId`, and run actions use the returned `runId`.
Read before acting and observe the original run after a reply is interrupted.
Do not retry a possibly accepted run or silently load synthetic input.

1. Import condition means and a task spec, or explicitly load the synthetic CPU
   example. Import validates and freezes dataset, parameters and split identities.
   The spec owns seed, split policy, scale, reference and screening threshold.
2. Inspect `virtual-cell.comparison` in Host Environments. Python 3.10 or later
   and its standard library suffice; there are no downloaded model weights.
3. Start the additive endpoint for that immutable input. It retains only the
   training view and held-out query identities. This is the empirical
   μ(A)+μ(B)−μ(control) baseline, not a trained cell model.
4. Run a comparison. The existing ComparisonHistory owns its CPU child process,
   cancellation, logs, exit and artifacts. A ready endpoint on the same input
   adds `additive-endpoint` predictions alongside independently computed references.
5. Run the independent numerical check. Export the run and recompute offline:

   ```sh
   python backend/cli.py compare --bundle export.json --out recomputed.json
   python backend/check_comparison.py --export export.json --out check.json
   ```

6. Rerun creates a new comparison on the original immutable input. Stop unloads
   the model view; it does not cancel a comparison that already owns predictions.
   Host still owns the App HTTP process and stops it on disable/remove/shutdown.

For a separately provisioned endpoint, configure the backend process environment
`PERO_VIRTUAL_CELL_MODEL_URL` (base HTTP(S) URL) and optionally
`PERO_VIRTUAL_CELL_MODEL_TOKEN`. Provision the same frozen input on that endpoint
and explicitly start it there first. Connection checks `/api/model`; prediction
uses `/api/model/predict`. Neither connection nor a failed request starts another
job or falls back to a different model. Credentials are never written into exports.

Numerical consistency is separate from biological validation, blind evaluation,
trained-model performance and researcher acceptance. Synthetic inputs prove the
CPU product path only. Norman preparation and licensed external model assets
remain with their existing Data/environment owners.
