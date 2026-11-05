---
kind: verification_report
github_issue: 77
github_state: open
github_url: https://github.com/phodal/pero/issues/77
---

# Fixed PC-Gym Desktop reproduction continuation

## 2026-11-05 macOS Electron acceptance

The Workbench imports the original arXiv `2410.22093v4` PDF, selects `0.0727`
in Table 6 on page 20 and saves a region-bound highlight. It freezes an
absolute diagnostic tolerance of `0.001` and receives an actual native
**Run once** decision. The existing Host starts the configured Paper process
and pinned PC-Gym worker. Both Electron launchers forward the explicitly
configured checkout. The Paper UI uses the dedicated Host route for approval
and the App API for its records. The checkout and interpreter are provisioned
before the test. Execution remains off by default.

The `table6` profile ran 25,000 steps and 24,900 gradient updates for each
DDPG policy. Seed 0 produced these counts from the pinned adapted experiment.

| Policy | Episodes with violations | Violating samples |
| --- | ---: | ---: |
| Base | 50 / 50 | 101 / 3000 |
| Shaped | 0 / 50 | 0 / 3000 |
| Oracle | 0 / 50 | 0 / 3000 |

The original highlight displays reported `0.0727`, measured episode fraction
`1.0` and diagnostic difference `+0.9273`, outside the frozen tolerance.
Independent recomputation agrees with the saved execution. The publication
verdict is `INCONCLUSIVE` because the original experiment identity and
metric grain remain unresolved. The tested PDF digest is
`f3aeddb2f1a29992a52088faf019dea66e2c31a30f134dedca8df40dbe7f5ee7`.

The smoke profile also ran with seeds 0 and 1 under one method digest.
Both attempt identities remained available in the same research revision.
With a PDF-capable interpreter missing scientific packages, the approved
request recorded a failed preflight and log, with `worker_started=false`.
The historical attempt and its result remain readable after Desktop restart.

The opt-in exercise saves receipts and screenshots in the gitignored
`test-results/paper-pcgym-live/` directory. The final full run used Spec
`57bd276878dfaa5561758043d4d674ebbb6e4abc6cb99cede482eb979c7f271c` and saved
attempt `a533bbb482cc2c9560aed24c088e90521596f0021b41e4c863b58e12974579a6`.
The worker finished in 130.84 seconds. The downloaded handoff SHA-256 is
`eb8eac510bb8648333fa2199606c62be749bac96d3452ae806224b79815c811d`.
Python 3.14.7 with site packages disabled independently verified this archive
in a new directory. The training interpreter was Python 3.12.11.

Run the exercise with the built Desktop,
Host and Paper App, a prepared Python environment and the original PDF.

```sh
PERO_TEST_HEADED=1 PERO_PCGYM_DESKTOP_LIVE=1 PERO_PCGYM_DESKTOP_PROFILE=table6 \
  PERO_PCGYM_PDF=/absolute/path/to/2410.22093v4.pdf \
  PERO_PCGYM_VENV=/absolute/path/to/scientific-venv \
  PERO_PAPER_PCGYM_CHECKOUT=/absolute/path/to/pinned-pc-gym \
  node tests/e2e/paper-pcgym-live.mjs
```

Choose **Run once** in the native dialog. Set `PERO_PCGYM_DESKTOP_PROFILE=smoke`
and `PERO_PCGYM_DESKTOP_SECOND_SEED=1` for the reuse check. With a PDF-capable
environment lacking the scientific dependencies, set
`PERO_PCGYM_DESKTOP_EXPECT_ENV_FAILURE=1` for the preflight branch. The test uses
a disposable profile. This acceptance covers macOS Electron Workbench.
Native Preview, installed packages and other platforms were outside the run.

## Earlier implementation and fixtures

This increment implements a narrow numerical-job path without an Agent prompt,
ACP session or model call. It does not close #77 or establish a reproduced paper
claim. It stacks on published shared-anchor #88 commit
`644b3514b11319153b6a10e79a962b27d1695b4d` and preserves master #89's scoped
reproduction/audit skills. This integration stacks on structured-reading #90,
including its reader-state preservation and AppDefinition route-cap change.
The reproduction path adds no public compute route.

## Actual owners and authority

1. The PDF reader saves its existing version-bound annotation. Local preparation
   reads only the trusted pinned checkout, reuses source audit/freeze, and creates
   a frozen numeric item. It neither fetches source nor installs dependencies.
2. The App sends only item/spec/request IDs to `/host/reproduction`.
3. `DesktopApps` obtains a private one-time ticket and a frozen summary from the
   existing Host Apps command. Electron Main shows a native Cancel/Run-once
   dialog, defaulting to cancellation. Workbench and standalone Electron Product
   share this function. No fake chat or ACP session is created.
4. Host forwards only to the already-running Paper backend. It never calls
   environment preparation while approving a numerical run. The private route
   requires the ordinary backend token and a separate Host-only capability.
5. The ticket binds item, specification, request, original PDF region/binding and
   local execution configuration. The backend rechecks the actual binding after
   confirmation and consumes the ticket before dispatch. Public `/api` and Agent
   `app_write` cannot submit a decision or start computation with an `approved`
   boolean. Ordinary HTTP `reproduction-step/start` is rejected even when the
   trusted deployment enables execution.
6. Existing `PcgymApp` and its CLI own the sole process lifecycle, cancellation,
   attempts and independent checker. No second scheduler/executor was added.

The per-backend capability is omitted from serialized `BackendAccess` and Debug
output. Per-request tickets stay in Main/backend memory, never in the renderer,
logs, result JSON or exports. Persistent approval records contain identities and
outcomes, not bearer credentials. A lost launch response retains its original
request; an uncertain outcome is not retried. A known prelaunch refusal is
`blocked/not_started`, not a fabricated execution failure. Restarted pending
approvals cannot execute. Cancellation uses the original request/owner even if
its current PDF or local configuration changed; damaged saved evidence does not
prevent signalling the matching live process.

This is software authorization, not proof of a physically present human or an
attested execution. Same-account tampering and separately authorized OS-level
UI automation are not prevented. #87's Go `AlwaysAskApproval`/ACP storage was
not generalized or bypassed; this direct Desktop operation instead uses the
existing trusted-main-process native confirmation mechanism.

## Deployment and scope

Execution remains disabled by default. An operator must explicitly supply
`PERO_PAPER_PCGYM_CHECKOUT` to the trusted Host process, pointing at an existing
canonical checkout; the fixed source pins are subsequently verified. Runtime
passes this setting and its private capability only to Paper. The actual App
Python selected by the existing Host configuration is the execution interpreter.
It must already contain the scientific dependencies. The numerical-run path performs no
checkout, package installation, model download or environment creation.

The initial UI prepares only the disclosed smoke profile: CPU, seed 0, 128 steps,
2 episodes × 60 samples per policy, base/shaped/oracle, 600-second worker limit.
Preflight/checking are separate from that worker limit; no memory/disk sandbox or
hard log-file quota is claimed. Web and non-Electron shells have no direct native
approval entrypoint in this increment. Platform availability of dependencies is
not established by the UI or unit tests.

The report keeps execution outcome, receipt/numerical checking, diagnostic range
and paper conclusion separate. Absolute/relative/bounds policies are immutable
item revisions, not a way to repair metric/version/coverage mismatches. PC-Gym
paper verdict remains `INCONCLUSIVE`. A range selected after an old result is
only a new diagnostic revision, not a retroactive preregistration. Existing
attempts are identified as existing outputs, never a fresh rerun.

## Evidence actually obtained

- Python full Paper suite on this integrated tree: 154 tests passed, one existing
  Windows-only skip.
- Deterministic private-approval tests cover ordinary-token refusal, public-start
  denial despite configured compute, wrong ticket/digest/item, deny/cancel/close,
  restart, changed inputs, ambiguous launch, competing approvals, pending-record
  recovery and exact-request cancellation with damaged evidence.
- One disposable **synthetic test worker**, not PC-Gym, was actually launched
  after approval, cancelled, then rerun as a distinct attempt of the same spec.
  It invokes no model, solver, training or download. The existing cancellation
  suite separately exercises real process termination of non-scientific workers.
- Desktop Node contracts: 15 passed, including eight direct-approval boundaries.
- Rust offline tests use a task-owned reduced workspace with the actual changed
  Host/runtime sources: four handoff tests, two private-config/redaction tests,
  four existing resource-handoff tests. A real built-in Paper manifest parse
  checks registration and confirms that private start is not advertised. The
  combined branch has 17 write routes and reuses #90's 32-route cap, including
  the actual manifest and 32-accepted/33-rejected registration contracts.
- Paper TypeScript checking passed. Full-workspace Rust validation is not claimed:
  offline resolution lacks the cached `gpui-kit` dependency.

## Browser/acceptance boundary

`tests/e2e/paper-reproduction-component.mjs` is a bounded synthetic component
journey for the existing Desktop CI lane. It does not prove a real scientific run
or the entire Electron/Host/PC-Gym chain. Local Chromium could not start: the first
attempt failed with a sandbox `socket() Operation not permitted`; the single
scoped escalation failed before execution with a read-only-filesystem bwrap
error. No denied file was read, no bypass was attempted, and no local screenshot
or GUI pass is claimed. The existing authorized GitHub Desktop CI is the intended
remaining UI validation environment.

Still pending: successful Desktop CI/browser evidence, actual configured-PC-Gym
selection→approved attempt→annotation writeback acceptance, packaged/platform
checks, and resolution of the scientific metric/original-experiment gaps. No new
scientific execution was performed for this implementation.

## Renderer IPC review before Draft publication

Independent review traced both preload surfaces, exact WebContents/frame checks,
`pero:session` / `product:session`, public Apps commands, probe reconstruction,
Host dispatch and private result consumption. Direct `apps/reproduction`
prepare/decide/cancel envelopes are rejected by both session handlers. Their
existing action-OR-method allowlists do admit mixed envelopes; no guard rewrite
is included here. `apps/list_agents` is rejected by the actual Host Apps enum,
and `settings.workbench/reproduction` retains its non-Apps dispatch selector
and cannot deserialize as an Apps request. Apps IPC reconstructs only its public
allowlisted operations. All `apps_result` events, even unmatched IDs, are
consumed in Main rather than forwarded to the renderer.

Regression tests execute the actual session callback bodies with fixture Host
I/O, exercise public Apps IPC rejection and unmatched-result suppression, and
validate the real Rust request enum. These contract tests do not claim that a
real Electron dialog or complete Desktop journey has run. Native confirmation,
full GUI evidence, and scientific paper reproduction remain separately pending.

## Draft CI follow-up

Linux full build/typecheck/Rust contracts and the synthetic reproduction
component journey passed. A later shared-reader fixture failed because its
old disposable-server injection stopped matching after a function-signature
change. The fix keeps the original page-count assertion, verifies a unique
call-prefix/import injection, preserves private capability wiring and fails
closed on missing or duplicate seams. A contract test parses and compiles the
actual transformed production server without executing it. The failed reader
journey is not represented as a successful synthetic test.

The UI also now projects the latest same-request receipt ahead of its cached
launch acknowledgement, so a terminal attempt is not still shown as starting.

A Linux-only fixture invokes the production Electron confirmation function in
the existing isolated Xvfb lane. It waits for native modal readiness (owner
disabled), then tests AbortSignal cancellation and owner closure without
monkeypatching the dialog or running a worker. It has no timing fallback.
Native execution remains pending CI at this commit; this test cannot establish
an actual Run-once click, a configured Host/Python journey, human identity or
scientific reproduction.

The first native lifecycle CI attempt failed in the test invocation adapter:
Electron's injected API argument was mistaken for the requested cancellation
mode. Dispatch now selects the mode outside Electron evaluation, with an offline
invocation-contract regression. The distinct native assertions are unchanged;
that failed attempt did not verify both modes or reach the later shared-reader
journey. Both remain pending a successful rerun.

A subsequent real native attempt ended with the Electron process closing before
both lifecycle modes were established. Forced owner destruction remains
unresolved; it is not treated as a successful denial or a diagnosed upstream
bug. The normal-close safety path now revokes approval on `close`, while the
owner is still alive, and retains `closed` as a fallback. Both listeners are
removed after settlement. Tests cover late allow after close, including when
another close handler keeps the owner alive. The native fixture uses documented
user-equivalent `owner.close()` and records mode/stage and process exit; normal
native closure still requires successful CI evidence. No pinned C++ source or
forced-destroy fix is claimed.
