# Paper #77: read-only diagnosis and remaining execution gate

2026-11-02; base `78881615`. Two read-only native diagnostic runs completed; native approval and scientific
execution remain unverified. Neither diagnostic submitted an input action.

Two retained #97 attempts (`41363881233`, `41365460393`) verified exact
Electron PID exclusion and captured the authored dialog, but returned empty,
truncated AT-SPI observations. The second image visibly includes Cancel and Run
once. Neither attempt submitted input. This does not prove GTK is absent: the
production adapter suppresses PID/getter errors and maps failed binding to an
empty incomplete observation. Do not repeat the positive probe unchanged.

## Read-only instrument

`tests/fixtures/paper-atspi-diagnostic.py` is a separate Linux/Gio collector, not a
production driver patch. It enumerates at most 32 registry entries and traverses
exact-owned-PID descendants breadth-first, at most depth 4 and 64 queued nodes.
Immediate frames remain in `frames`; all inspected nodes carry their depth.
Each new bus must resolve to the exact Electron PID before any child metadata is
read; renderer/foreign processes are skipped and counted, unresolved owners are
reported. It reads only child references, role/state/interfaces/screen extents:
no Name/text/value or Action-interface calls (including Action names).
Getter error classes are retained without arbitrary remote error payloads.
The existing four-coordinate ±2 rule is reported unchanged, never relaxed.
There are still 128-call/8-second collection and 10-second process alarm bounds;
individual RPCs have 500 ms timeouts. Node/depth/RPC/time limits explicitly mark
`truncated` with `budgetReasons`; errors or any budget failure force an incomplete
classification. This may stop before 64 nodes: node allowance never expands the
RPC/time ceiling. Matching geometry, even with a dialog role, is not a complete
semantic tree or a grant to input. Multiple matches remain ambiguous. Because
this increment deliberately omits Action getters, it does not rule out later
production Action.GetName failures or otherwise establish complete root facts.

### First live read-only result (immediate frames only)

Run [41411170232](https://github.com/phodal/pero/actions/runs/41411170232), job
`125164312388`, artifact `13126105353`, tested PR head
`fa340d6a4b7693da5fcc2b3c03ab201b1551b15c` through merge
`b7bd028748c6451caf894e43ad51fba158bd04ca` onto `78881615`.
The 4.016-second diagnostic completed without input; green means evidence
collection succeeded, not native approval. The one-shot opt-in label was removed.

- Electron 45.1.0 / Chromium 156.0.8078.49 / Node 24.22.1;
  `ACCESSIBILITY_ENABLED=1`, observed `NO_AT_BRIDGE=null`.
- Exact driver PID exclusion and X11 ownership verified PID **6677**.
- X11 dialog `0x400007`: **(0, 0, 549, 129)**.
- One exact-PID AT-SPI app, two immediate frames:
  **(240, 212, 800, 600)** and **(400, 352, 480, 320)**.
- `matchingFrames=0`, `errors=[]`, collector `truncated=false`;
  native driver still `elements=[]`, `truncated=true`.
- ZIP SHA-256 verified against GitHub artifact digest:
  `3e31fe6859a4efa01da00ede94e3099e4630f49e8f475d90639109f56f78d570`.
- Owned screenshot SHA-256 verified against its receipt:
  `80bfcc1d046e00edd5c33c335630ec15c9d683ca7e83511936d5ca997a1f7da8`.

This excludes missing exact-PID registration and observed getter failure for
that snapshot. It does not establish absence in deeper descendants. The bounded
descendant increment distinguishes a nested geometry candidate from no matching
node within the inspected owned subtree, without changing the production binder.
An incomplete walk cannot establish absence. Old #97 positive attempts stay
stopped; no input/worker/science acceptance follows from this diagnostic.

### Second live read-only result (bounded descendants)

Run [41413322861](https://github.com/phodal/pero/actions/runs/41413322861), job
`125171140091`, artifact `13126109311`, head
`9b466282c3c2bab9fe66ed3bf141eafca0f47877`, tested merge
`552ea71e50d82c6d970f803a86087d8bee990bff` onto `78881615`.
GitHub commit parents confirm the screenshot's merge revision matches this head.
The runner completed in 5.274 seconds; opt-in label was removed afterward.

- Runtime versions/accessibility environment unchanged from the first run.
- Exact Electron PID **6960**, X11 `0x400007`, dialog **(0, 0, 596, 129)**.
- One owned registry app; the same two nonmatching frame rectangles as before.
- Exactly **2 nodes, both depth 1**, whose `GetChildren` returned no descendants.
  **15 RPCs**, `errors=[]`, `truncated=false`, `budgetReasons=[]`,
  `skippedForeignPid=0`, `unresolvedPid=0`.
- `matchingFrames=0`, `matchingNodes=0`, `matchingNestedNodes=0`,
  `matchingDialogCandidates=0`;
  `classification=no-exact-geometry-node-in-owned-subtree`.
- ZIP SHA-256 matches GitHub:
  `a3a79d4fe3a07ed5484ee34de40d762eb9c7793af43edd9a8b557651c22d2704`.
- Screenshot SHA-256 matches its receipt:
  `361b0d73670dd0bb238992408e7f34988e7b72cf7ed699725c9318ae348df330`.
  Pixels show the authored no-compute warning and Cancel/Run once buttons.
- Production observation remains empty/truncated. No action/approval/worker
  receipt is established by either green diagnostic job.

The complete available traversal establishes **no matching geometry node in this
exact-PID exported subtree at this snapshot**; it did not run out of depth, nodes,
RPCs or time. Thus a deeper-node omission in the production binder is not the
observed cause. This is not proof of absence at every instant or on every runtime.
The evidence supports an Electron GTK/Chromium accessibility exposure issue:
[pinned Electron creates a GTK message dialog](https://github.com/electron/electron/blob/v45.1.0/shell/browser/ui/message_box_gtk.cc),
while [pinned Chromium replaces the ATK root with its application tree](https://github.com/chromium/chromium/blob/156.0.8078.49/ui/accessibility/platform/atk_util_auralinux.cc).
This is a source-supported hypothesis, not a tested upstream root-cause fix.

**Stop here rather than repeat the same probe.** No production driver change is
justified by these results; do not widen geometry, match a BrowserWindow instead,
traverse another PID, or use keyboard/pixels. Preserve #97's stopped state.
Minimal next engineering choices need a separately reviewed scope: either fix
upstream/native bridge exposure, or implement an explicitly authorized accessible
Host-owned approval UI while retaining exact per-run binding/private-token,
cancel/destroy and no-replay semantics. An alternative UI is not evidence that
the original GTK dialog works. Read-only source investigation needs no new input
permission; a new live test, positive semantic approval test, real worker launch,
scientific environment/dependency setup and actual computation are separate
stages and must each remain within their explicit authorization. Neither of these
diagnostic runs grants those stages.

Implemented separate entry point: `tests/e2e/paper-native-diagnostic.mjs`. It is
not registered in the normal positive suite. The first immediate-frame version
and descendant versions ran as recorded here.
`.github/workflows/computer-use.yml` now wires it only for Linux PRs explicitly
labelled `ci:paper-native-diagnostic` or manual dispatch with boolean
`paper_native_diagnostic=true` (default false). Ordinary push/PR/scheduled runs
do not execute it, and `ci:full` does not enable it. Remove the diagnostic label
after the intended one-shot run: retaining it would opt later synchronize events
into another diagnostic run. The job reuses the existing
native driver build, installs locked root npm dependencies and official distro
prerequisites, and retains only this diagnostic directory plus its exact runner
receipt for seven days. The step has a three-minute outer timeout. Static wiring
tests do not establish live accessibility. The one-shot CI command (with `x11-utils`, `python3-gi`, AT-SPI and GTK installed) is:

```sh
PERO_TEST_HEADED=1 PERO_TEST_SOFTWARE_GL=1 node scripts/ci/run-acceptance.mjs --name paper-native-diagnostic --timeout-seconds 90 -- xvfb-run -a node tests/e2e/paper-native-diagnostic.mjs
```

It retains evidence under `test-results/paper-native-diagnostic`. Its private
driver wrapper accepts only status/targets/observe. Review these invariants
before the one-shot run:

1. Keep the disposable D-Bus/Xvfb session and authored no-compute fixture. Do not
   use a user's desktop, scientific worker or model.
2. Preserve existing native-driver exact PID exclusion and single target gates.
   Obtain the verified target's actual X11 screen bounds; screenshot width/height
   alone do not supply x/y. Do not infer geometry from pixels.
3. Invoke `/usr/bin/python3 tests/fixtures/paper-atspi-diagnostic.py --pid <owned>
   --bounds <x> <y> <w> <h>` on that same disposable bus, with an outer subprocess
   timeout of 12 seconds. Save stdout, exit code and timeout/startup status.
4. Save one existing driver observation and its owned-window screenshot/hash.
   **Return/abort immediately after collection; never reach approvalAction/act.**
   A separate diagnostic-only entry point must enforce this, rather than running
   the existing positive script and hoping its gates fail.
5. Classify missing exact-PID application, unmatched/ambiguous frame or getter
   failure. A matching frame is not a complete tree or permission to click.
   Preserve native semantic/nonce/complete-tree gates for any separately reviewed
   future positive attempt. No keyboard/pixel fallback or OS security changes.

The descendant collector completed one live read-only run as recorded below;
that is not native approval acceptance.
Its deterministic fake-transport tests are not accessibility evidence. This
instrument does not alone resolve Host→worker or forced-destroy acceptance.

## Smallest selected-result exercise (proposal; not approved or executed)

Current code has opt-in Host deployment wiring (`apps/process.rs`), private
compute-token handling and backend `PERO_PAPER_PCGYM_CHECKOUT` configuration.
Older prose claiming no composition exists is stale; default/unconfigured
execution remains unavailable. Do not inject a token to bypass Host approval.

Select the actual saved arXiv `2410.22093v4` page-20 Table 6 **oracle 0.0000**
annotation. Retain paper/document/passage/annotation identities. Freeze a numeric
item with `policy=oracle`, `comparison={mode:absolute,tolerance:0}` *before*
execution: a deliberately exact zero-violation diagnostic, not an accepted
scientific reproduction tolerance. This avoids undefined relative error at zero.
The oracle row is useful only as a controller/constraint-evaluation baseline: it
exercises CasADi/do-mpc integration and denominator/bound semantics independently
of short-trained DDPG quality. Selecting the easiest zero row cannot establish
that either learned policy or the paper was reproduced. Both base (0.0727) and
shaped (0.0003) reported results, all registered policies and original full
training/evaluation conditions must remain in the full comparison.

No original raw Table 6 trajectories/checkpoints are supplied; generate fresh
trajectories from pinned upstream `fbfb36bf84b494cd157cff88292e1fd1b864cee5`,
validated source blobs, seed 0, original reward and documented deep-copy adaptation.

Paper method correspondence: the fixed adapter targets Section 6.3 CSTR,
Equation 37 episode-level constraint violation and Table 6. The source has an
unresolved sample-level versus episode-level metric mismatch; the driver must
retain both, the original reward/bound ordering, initial-state-inclusive 60
samples and all configured operating conditions. Original author seeds,
checkpoints, environment and raw trajectory identities are unavailable; a new
seed-0 run is an adapted rerun, not recovered original experimental data.

Smallest actual engine path is `smoke`: two DDPG jobs × 128 steps, then all three
policies × 2 episodes × 60 samples, CPU, 600-second budget. A smoke tests the
workflow only. A full Table 6 adapted rerun instead uses 25,000 steps per job and
50 episodes per policy; no CLI exists to run only the selected oracle policy.
Use a separately approved Python environment and pin the full dependency freeze;
the historical smoke used Python 3.12.11, torch 2.15.0, SB3 2.9.2, CasADi 3.8.2,
do-mpc 5.1.2 and NumPy 2.5.4. Environment identity must be measured afresh and
frozen; do not assume the historical Mac environment exists here.

With `PYTHONPATH=apps/paper-agent/backend`, the **CLI-only** equivalent is:

```sh
<approved-python> -m paper_agent.pcgym prepare --checkout <approved-pinned-checkout> --output <new-bundle> --profile smoke --seed 0 --timeout-seconds 600
# Review returned immutable Spec, environment, source and audit; obtain exact approval.
<approved-python> -m paper_agent.pcgym run --bundle <new-bundle> --spec-sha <frozen-sha> --confirm-execution --accept-audit-findings
<approved-python> -m paper_agent.pcgym verify --bundle <new-bundle> --attempt <new-attempt>
<approved-python> -m paper_agent.pcgym export --bundle <new-bundle> --attempt <new-attempt> --output <new-zip>
```

For #77 end-to-end evidence, use the existing App audit/freeze/create-item,
trusted Host approval/start, attempt/status/logs and compare-item paths instead:
CLI success is not Desktop acceptance. Require actual native Run once, one owned
worker, truthful failure/cancel/restart/no-replay behavior, comparison back to the
same selected item, and exported stdlib-only recomputation. Record both integer
sample/episode denominators and actual gradient updates. A new full run cannot
turn unresolved metric/experiment identity into scientific PASS:
`paper_verdict=INCONCLUSIVE` remains mandatory. Approving this proposal, acquiring
source/dependencies, configuring trusted execution and running it are still
pending; none were performed here.
