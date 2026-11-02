# Reference case: PC-Gym CSTR Table 6

This worked case uses the fixed PC-Gym CLI. Its unresolved scientific verdict and
execution flags apply to this adapter only. Read it when auditing that case.

This implementation combines a **fixed-case CLI execution workflow** with a
persisted Paper `reproduction-step` audit route. The App audit binds the saved v4
Paper, PDF passage and optional annotation; `freeze` additionally requires a
trusted fixed checkout. Computation is disabled by default. The Host now has
opt-in trusted-checkout deployment and private compute-token wiring; configured
Desktop execution still requires its native per-run approval. That implemented
path has not established native Run once/Host-to-worker acceptance. The explicitly
authorized CLI is a separate supported path, not evidence that Desktop passed.
Do not invent `app__paper-agent__run-experiment` or write experimental outcomes
into a reading-only `research-step` report (its `experiments` remains empty).
If the Host does not expose an authorized shell and the selected Python environment,
report the execution boundary as blocked. Do not bypass an App-scoped restriction.

## 1. Read and establish identity

The target is arXiv `2410.22093v4`, Section 6.3, Equation 37 and Table 6. Use the
existing `prepare-research` / `research-step` path for actual PDF observations;
prefer advertised tools and their schemas. Preserve the returned paper, document,
passage and file identities. A case template or previous answer is not observed
paper evidence. HTML reading is optional and must not bypass PDF evidence rules.

A local source checkout must be explicitly supplied/approved and pinned to:
`MaximilianB2/pc-gym@fbfb36bf84b494cd157cff88292e1fd1b864cee5`.
Do not clone, install or download assets as a side effect of this skill. Source
acquisition stays a separate authorized workflow. Do not load upstream pickle or
object-array data. The training curves from another case are not Table 6 data.

## 2. Inspect and freeze a plan, without computation

Use the chosen environment's Python (not an assumed system interpreter). The
bundle copies the backend; it does not install a Python package. Set
`PYTHONPATH=<installed-paper-agent>/backend` to invoke `python -m paper_agent.pcgym`
from that bundle. From a Pero source checkout, set
`PYTHONPATH=apps/paper-agent/backend` instead.

Run `prepare --checkout <approved-absolute-checkout> --output <new-workspace-directory>
--profile table6 --seed <explicit-seed> --timeout-seconds <approved-wall-time>`.

`prepare` reads and checks source bytes, statically audits code, inventories
packages, and saves a Claim, audit, source manifest and immutable Spec. It does
not import the scientific packages or execute the upstream scripts. Respect a
BLOCKED result. Installing dependencies creates a new environment and requires a
new prepared Spec; do not edit a frozen one.

Review the actual saved findings, including:
- episode-level Equation 37 versus sample-level `np.mean(violations)`;
- the reward function's bound ordering;
- shared configuration mutation and the driver's explicit deep-copy adaptation;
- absent original training seeds/checkpoints/trajectory provenance.

Table 6's reported 0.0727 / 0.0003 / 0.0000 are reference values, never fresh results.
The driver's full profile trains both DDPG variants for 25,000 steps and evaluates
50 episodes × 60 samples for each policy, including the MPC oracle. `smoke` uses
128 requested training steps and two episodes and must remain labelled a smoke
test. Check the recorded actual timesteps and gradient_updates: an execution
shorter than the engine's warmup may generate rollouts without learning.

## 3. Get exact execution approval

Present the saved Spec digest, interpreter/environment, source revision, profile,
seed, two training jobs plus oracle evaluations, wall-time limit, output location,
and unresolved findings. Ask in the existing conversation when needed. Existing
permissions are still enforced by the Host. Approval of a paper URL is not
approval to install software or execute a repository.

Only after the user approves that plan and knowingly accepts an **adapted
upstream-code rerun**, invoke:
`run --bundle <prepared-directory> --spec-sha <returned-digest>
--confirm-execution --accept-audit-findings`.

The implementation invokes real PC-Gym / Stable-Baselines3 / CasADi. Missing or
changed dependencies, source, Python or driver/checker bytes must block, not fall
back to analytic curves or fixtures. Do not replace the source's reward to make
a test pass. A different scientific interpretation requires a separately reviewed
implementation/protocol, not an argument that silently changes this case.

## 4. Observe, independently check, and report

The run is foreground and owned by the existing execution tool. Use its supported
cancellation, not another process launcher. `status --bundle <directory>` reads
persisted records; it does not prove a process is still live. An interrupted lock
requires operator reconciliation. Never automatically delete that lock or replay
an unknown attempt. Partial logs remain available and incomplete runs never PASS.

Use `verify --bundle <directory> --attempt <returned-attempt-id>` to recompute from
raw temperatures. Report both metrics and both integer denominators. Check receipt
identity and bytes; a digest is not remote attestation or scientific truth.

Use `export --bundle <directory> --attempt <id> --output <new-zip-path>` for a
self-contained numeric check package. It contains a stdlib checker runnable with
`python verify.py` without an Agent or solver. It omits full third-party PDF/source
files, local execution paths, credentials and large checkpoints. An App-bound
bundle includes `paper-binding.json`, containing the saved page-20 passage text
and annotation binding; it is not a text-free export. The checker verifies that
binding against the frozen Spec digest.

Deliver the artifact paths, execution state, exact experiment scope, numerical
comparisons and limitations. In this implementation the paper-level verdict is
**INCONCLUSIVE**: its metric interpretation and original experiment identity are
unresolved. A valid numeric computation or a close table value cannot override it.
Fixture tests, the real reward-callback probe, a smoke run, a full retraining and a
scientific replication are separate evidence levels.

## Integration limits

The parent `paper-code-audit` skill is discoverable in the headless Go Harness
when its skills root is explicitly configured. The catalog reads only SKILL.md;
this reference requires a separate authorized file reader and is not fetched by
the skill tool. The App route persists audit and reproduction evidence with
explicit saved-PDF binding, but the built-in Desktop picker, automatic attachment
from a UI selection, study-result navigation and Desktop UI acceptance are
**not delivered**. Never announce them as completed.
