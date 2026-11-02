# Harness trial adapter

This independent Python standard-library tool runs trials through an explicit
`pero-agent-acp` executable. It is an ACP client, not another model loop. Remove
this directory and its optional package launcher migration to remove the
adapter; no Go composition or provider implementation depends on it.

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
and loopback HTTP fixtures are accepted. Each trial uses a fresh workspace and
private records directory. Ordered `sessions` entries can replace `prompt`;
each has name, prompt, success_artifact or success_patterns, and an optional
max_continuations. Sessions share the trial workspace but each owns a separate
ACP process and persistent session directory. `session_timeout` is a wall-clock
limit including startup; `idle_timeout` measures silence during a prompt.
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
An unavailable total stays null. No token count is inferred from text and
cost_usd is always null. Trials also expose duration_ms, success, journal_path,
events, continuations, interactions and tool_summary at the top level for
existing analysis tools. Multi-session journals include source_session and
elapsed times projected into pipeline order; the original per-session journals
remain available.
The private journal records tool names/inputs and text previews, not hidden
reasoning. Keep trial records under the operator's own data policy.

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
