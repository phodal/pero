# Harness trial adapter

This independent Python standard-library tool runs trials through an explicit
`pero-agent-acp` executable. It is an ACP client, not another model loop. Remove
this directory and its optional package launcher migration to remove the
adapter; no Go composition or provider implementation depends on it.

## Original coder review acceptance

`verify_coder.py --plugin /absolute/coder` prepares a fresh isolated Git project
without model requests. It copies the selected package, creates a small batch
label utility change and six real Python tests, then runs the package's original
task provenance, scope-check, cr-prepare and review-selector scripts. The selector's
complete workflow input is retained; dimensions are not substituted for easier ones.
Original package files are not modified by this verifier.

To execute a model acceptance explicitly:

```sh
python3 verify_coder.py --plugin /absolute/coder --execute \
  --agent-binary /absolute/pero-agent-acp \
  --endpoint https://api.deepseek.com/v1 --model deepseek-flash \
  --api-key-env DEEPSEEK_API_KEY --disable-thinking --max-requests 80
```

The credential must already exist in the named environment variable. Git,
Node, Python and the ACP executable must be available. `--execute` authorizes
the existing trial client's approved Bash/file operations in this disposable
fixture; it does not add an OS sandbox. It uses the same specified model for
the plugin's opus/sonnet aliases, rather than claiming those are Claude models.
The existing CLI thinking option is passed through an exec launcher when
requested. There are no automatic HTTP retries or prompt continuations.

Acceptance requires a normal session and clean shutdown, one actual Workflow
call with the exact selector input, an approved source-journal result matching
the saved result, all selected report parser results and required headings,
unchanged tracked source/commit/plugin contents, and passing post-review tests.
`acceptance.json` records actual requests and provider-reported usage; unknown
cost is not estimated. A needs_rework or incomplete result is reported as failure
for this positive fixture, without automatically repairing or replaying it.
This covers the original review subflow, not the entire development/worktree/
human decision/merge orchestration. Apply any explicit source repair before
selection; the [quoted-output hook migration](../../go/plugins/migrations/README.md#selected-review-hook-repair)
is separate from the verifier.

Pass JSON on stdin and receive one JSON receipt on stdout:

```json
{
  "runtime": "harness",
  "plugin_path": "/absolute/plugin",
  "agent_binary": "/absolute/pero-agent-acp",
  "endpoint": "https://provider.example/v1",
  "model": "explicit-model-id",
  "plugin_models": {"senior": "explicit-review-model-id"},
  "api_key_env": "TRIAL_PROVIDER_KEY",
  "workspace": "/absolute/trials",
  "prompt": "/sample:report describe a requirement",
  "success_patterns": ["reports/requirements.md", "reports/checklist.md"],
  "session_timeout": 3600,
  "idle_timeout": 600,
  "max_continuations": 3,
  "max_requests": 64,
  "max_tokens": 4096,
  "budget": 0,
  "max_retries": 0,
  "unattended_questions": "first-option"
}
```

Run `python3 run_trial.py < config.json`. The credential must already be set in
the named environment variable; its value is not a JSON field. HTTPS endpoints
and loopback HTTP fixtures are accepted by default. An explicitly supplied
plaintext provider endpoint additionally requires `allow_http: true`, which
passes `--allow-http` to the native agent and is recorded in the receipt.
This setting does not change TLS verification or other service endpoints.
Each trial uses a fresh workspace and
private records directory. Ordered `sessions` entries can replace `prompt`;
each has name, prompt, success_artifact or success_patterns, and an optional
max_continuations. Sessions share the trial workspace but each owns a separate
ACP process and persistent session directory. `session_timeout` is a wall-clock
limit including startup; `idle_timeout` measures silence during a prompt.
Only received ACP frames reset idle time. Child model/file activity without
parent ACP updates does not reset it; choose a sufficient idle timeout for long
delegated reviews. An idle timeout cancels the turn and remains incomplete.
With ordered sessions, top-level success_patterns adds final pipeline
requirements. It does not replace each session's own patterns.

All success patterns must match regular files inside the workspace. A normal
end_turn is required; cancellation, fatal errors and timeout remain failures
even if an artifact was already written. A pipeline succeeds only after every
requested session succeeds. Final matching checks every session and top-level
requirement again, so removing an earlier artifact fails the pipeline.
Continuations reuse the same session. Submitted
prompts and provider requests have no automatic retries. A positive USD budget
is rejected because this runtime has no authoritative pricing; use max_requests,
which caps HTTP attempts per session process, including child model requests.

Questions are cancelled by default, cancelling the active trial turn. Explicit
`unattended_questions: "first-option"` selects the first option of each question
(one selection for a multi-select) and records this machine policy. This is not
a human approval. Native writes are granted only through the existing scoped
workspace tools; other permission requests fail closed. Shell is disabled by
default. To allow it, set enable_shell true and shell_policy allow-unsandboxed
explicitly. The runtime then uses full-access permission mode and grants Bash
requests; no OS sandbox is implied. Plugins remain trusted code: hooks and
declared dynamic skill commands have their own existing execution paths.

`permission_mode` explicitly selects an existing ACP mode: read-only,
workspace-write, full-access or auto-review. The default remains full-access
with shell enabled, otherwise workspace-write. The chosen mode is recorded in
the receipt. Harness auto-review allows ordinary scoped tool operations without
a client permission question; it is not Claude's automatic risk classifier.
Shell still requires the explicit enable_shell/shell_policy settings above.

Injected skill commands cannot display a permission question while rendering.
In manual modes a command without a matching preapproval aborts rendering,
even when later Bash requests could be approved by the client. A caller can
explicitly choose auto-review for trusted fixture execution. The CLI regression
checks that the same dynamic skill fails before any model request in full-access
and runs in explicitly selected auto-review. No runtime permission bypass is
added. See the [official injected-command permission contract](https://code.claude.com/docs/en/skills#permission-checks-on-injected-commands).
The invoking agent must also have Bash in its actual tool view. Neither
allowed-tools nor auto-review supplies a missing or restricted tool; rendering
aborts before a model request when shell is disabled.

An explicit context_source, or the base workspace's .context directory, can be
copied into the isolated workspace. Symlinks and special files are refused.
Timeout and closure cancel the ACP session, join its process and reclaim the
owned Unix process group. The adapter currently requires macOS or Linux.
Close RPC errors, forced cleanup and nonzero agent exit codes fail the receipt
even after a normal model response and successful artifact writes. Session
receipts include agent_exit_code and cleanup_failures; private agent.stderr
remains available for diagnosis. Nonempty stderr alone is not treated as fatal.

Receipts retain trial_id, workspace, model, total_duration_ms,
pipeline_complete, artifacts, pattern_artifacts and sessions. They add runtime
identity, actual HTTP attempt counts, artifact matches and provider-reported
usage from committed session records, including child sessions. Missing usage
reports are counted; failed or uncommitted requests may have unknown usage.
JSONL records are framed by byte newlines, preserving legal Unicode separators
inside string values. Malformed physical records still fail usage validation.
An unavailable total stays null. No token count is inferred from text and
cost_usd is always null. Trials also expose duration_ms, success, journal_path,
events, continuations, interactions and tool_summary at the top level for
existing analysis tools. Multi-session journals include source_session and
elapsed times projected into pipeline order; the original per-session journals
remain available.
The private journal records tool names/inputs and text previews, not hidden
reasoning. Keep trial records under the operator's own data policy.

After pipeline cleanup, the runner also generates an offline
[Session report](../session_report/README.md) in `<records>/trace-summary` and
returns its status and location as `trace_summary`. It includes recorded token
usage, failed tool/process calls, interrupted tasks and heuristic zero-exit
validation signals. Report diagnostics remain separate from the trial's artifact
acceptance. The report can optionally be rendered by Better Harness Inspector.

## Optional package migration

`migrate_plugin.py --root /absolute/plugin --check` preflights the anonymous
snapshot recorded in [MIGRATION.json](MIGRATION.json). Remove --check to apply.
It preserves the original SDK runner as scripts/run_trial_claude.py and installs
a small scripts/run_trial.py selector. Claude remains the default; selecting
runtime harness also requires an explicit absolute harness_runner path to this
directory's run_trial.py. Skill instructions describe the same selection and
limits. Existing unrelated package files and connection settings are untouched.
The source repository is not modified. Replaying the same migration reports
already-applied; changed source or backup digests are refused.

## Verification

Run `python3 -m unittest test_core.py test_migration.py test_runtime.py -v` here. Runtime tests
build the real ACP executable and use temporary plugins and a loopback SSE
provider. They require Go and a Unix host, with no paid provider or external
service. They verify actual plugin instructions, first-option questions,
approved writes, same-session continuation, reported usage, timeout after an
effect without retry, process cleanup and incomplete pipelines.

The adapter and launcher are new ACP integration code. The original SDK runner
stays in its local package with that package's license; its source is not copied
into this directory.
