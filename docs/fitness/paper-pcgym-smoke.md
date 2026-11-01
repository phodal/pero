# PC-Gym real smoke: reference → execution → independent check

Executed 2026-11-01 on macOS arm64 / Python 3.12.11. Machine-readable identities,
dependency versions, integer counts and receipts are in
[paper-pcgym-smoke.json](paper-pcgym-smoke.json). This is real PC-Gym, SB3, CasADi
and do-mpc computation with the original pinned reward, not synthetic trajectories.

## Reference and execution path

The current Codex Agent read `paper-code-audit/SKILL.md`, followed its PC-Gym link,
and read `references/pcgym-table6.md` and `references/audit-contract.md` through
its authorized filesystem tool. Their digests are recorded. This demonstrates
the generic skill's reference-directed local workflow. It does not demonstrate
automatic reference loading by the headless catalog, a second model run,
Desktop picker, observed PDF annotation binding or App/Host UI integration.

An isolated scientific environment was prepared explicitly for this request.
All 39 installed dependencies passed `uv pip check`; exact versions are retained
in the receipt, including torch 2.15.0, SB3 2.9.2, CasADi 3.8.2, do-mpc 5.1.2 and
NumPy 2.5.4. No shared Pero environment was modified. Source remains
`fbfb36bf84b494cd157cff88292e1fd1b864cee5`; all four pinned blobs were checked.

The existing foreground CLI executed with seed 0 and a 600-second budget. The
corrected smoke requested 128 timesteps per DDPG variant and 2 episodes × 60
initial-state-inclusive samples for each of base, shaped and MPC oracle. The
worker used `device='cpu'`. Complete output was produced in **16.44 seconds**;
dependency preparation and independent checking are outside that interval.

- Spec: `289a0929caa46a24eb8a91eb17933d566c6017c1a24e530ebc49c7bc94f654e7`
- Attempt: `15e0b3cbf3386654b86aa7664efd12cb5e57843b1377b08245517d7e1afc191c`
- Pipeline digest: `236c352878e72a26159fab1f6a6ad1d75bbfb584835ee50370e88bde4890aeb6`

The tested source was `c252cf48` plus the scoped smoke-budget/training-receipt
changes in this PR. The pipeline digest binds the exact four implementation files.
Both checkpoints and runtime records confirm **128 actual timesteps and 28
gradient updates**, with learning_starts=100.

## Initial smoke exposed a real gap

The first run requested 64 steps and completed in 41.25 seconds, including first
imports/font-cache setup. Its checkpoints showed 64 timesteps and **zero updates**
because the engine warmup was 100. Its rollouts/checker/export were real, but it
did not validate optimization. The completed attempt and original self-contained
export were retained. A new Spec/attempt was prepared after raising the smoke
budget to 128 and recording actual training counts. See
[the finding](../issues/2026-11-01-pcgym-smoke-no-updates.md).

## Actual independent results

| Policy | Violating samples / all samples | Episodes with any violation / all episodes |
| --- | --- | --- |
| base | 118/120 ≈ 98.33% | 2/2 = 100% |
| shaped | 116/120 ≈ 96.67% | 2/2 = 100% |
| oracle | 0/120 = 0% | 0/2 = 0% |

These are short smoke results, not the reported Table 6 experiment. The poor
short-trained policies do not establish a paper error or a reproduced benchmark.
All 360 registered temperature samples were preserved. Raw NPZ files were read
with `allow_pickle=False`; each policy's 2×60 temperature array matched the
Checker's JSON input element for element. Values were finite and nonconstant.

1. The worker's checker ran in a separate process after execution.
2. A second CLI `verify` ran with standard-library-only Python, without scientific
   dependencies: `execution_evidence=CONSISTENT`, `numeric_recomputation=PASS`.
3. `export` produced a 25,106-byte ZIP containing numeric artifacts, original
   Spec/receipt, source manifest and a standalone checker, excluding checkpoints,
   local configuration and execution logs.
4. The ZIP was extracted to a fresh directory; `python3.12 verify.py` recomputed
   identical metrics and verification judgments without an Agent or solver.

ZIP SHA-256: `c203acbfc704fe952f1efdd096edb3d5bd4748fa6712a0ccb3df94832b4f2ea9`.
Raw observations SHA-256: `1f120505d6219151d825addee94e481840144ce59b232d98b94c478613b986a2`.
The numerical export and full local attempts are delivered as local artifacts;
large/binary runtime files are not committed to the repository.

## Reproduce the supported workflow

Use the supplied dependency freeze in an isolated Python 3.12.11 environment,
the pinned source checkout and this PR's implementation. With the Paper backend
on PYTHONPATH:

```sh
python -m paper_agent.pcgym prepare --checkout /approved/pc-gym --output /new/smoke --profile smoke --seed 0 --timeout-seconds 600
python -m paper_agent.pcgym run --bundle /new/smoke --spec-sha <returned-spec-id> --confirm-execution --accept-audit-findings
python -m paper_agent.pcgym verify --bundle /new/smoke --attempt <returned-attempt-id>
python -m paper_agent.pcgym export --bundle /new/smoke --attempt <returned-attempt-id> --output /new/evidence.zip
```

This checks local scientific execution and portable recomputation. It does not
guarantee bitwise reruns across versions/hardware, original author environment,
protected/attested checking or independent scientific acceptance. The original
metric-granularity and experiment-identity questions remain unresolved:
`paper_verdict=INCONCLUSIVE`, `acceptance=unreviewed`. Full 25,000-step Table 6
training, 50-episode evaluation, Host cancellation acceptance and Desktop/packaged
acceptance remain unperformed. The full Paper test suite after the scoped change
reported **76 tests, OK (one Windows-specific skip)**.
