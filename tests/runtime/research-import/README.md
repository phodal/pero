# Research import Harness trajectories

This runner executes the built **Go Agent**, its explicit-root Skill catalog and
digest-validated read, ACP through the actual Rust Host, production
`DesktopAppUse`/`AppWriteRoutes` MCP, and installed Paper/Data Python backends.
Only the external metadata/byte seams use the existing tiny deterministic
research fixture. No GUI, live public metadata, clone or code execution is
claimed. `--fixture` substitutes scripted provider output; it is **not evidence
of natural Skill selection or real model effectiveness**.

Build the Host and `harness/go/cmd/pero-agent-acp`, then run with Node 24+:

```sh
for scene in references download unsafe digest restart; do
  node --experimental-transform-types tests/runtime/research-import/run.mjs \
    --fixture "$scene" "$PWD/target/debug/pero-agent-acp" || exit
done
```

- `references`: actual discovery/read, schema→inspect/status→review→commit;
  persistent references, zero file opens and zero Data assets.
- `download`: a separate confirmation turn selects only the 29-byte fixture
  file; actual Data bytes, checksum, size, revision and license are checked.
- `unsafe`: no bundle/asset. The fixture exercises the public-URL boundary's
  localhost rejection; real inference may reasonably refuse before any tool call.
- `digest`: an incorrect digest fails, then the launch-time digest succeeds.
- `restart`: repeat in one Go session, then restart Host/Go/Python; immutable
  bundle/snapshots are unchanged and metadata is not fetched again.

The evidence parser reads actual Go JSONL `event` records, not provider claims.
Results preserve executable hashes, source commit, Skill digest, tool arguments,
outcomes, HTTP-attempt audit and reported usage (missing usage stays `null`).
All source content is public/synthetic. Evidence lives in private directories
under ignored `test-results/research-import-harness`; no credentials belong there.
Earlier failed checks remain failed instead of being overwritten.
Persistence/safety, Skill coverage and review quality are separate results. An advertised App alias
already carries its schema; `app_describe` is required for the generic write
path, not an extra mandatory call before aliases. `describeBeforeInspect` is
retained as an observation, not a standalone safety requirement.
Automated `passed` covers mechanical checks and the actual Skill read only.
`reviewAssessment` preserves public pre-commit messages for manual comparison
with actual inspected resources. Neither arbitrary text nor keyword matches
prove the requested review happened before saving; assess that separately and
retain the original result when appending a semantic assessment.
For real `unsafe`, automatic checks cover no saved bundle, no Data download or
asset, no byte opens and no native execution tools—not every possible side
effect. Other Paper state and metadata access require manual assessment. Inspect
`unsafeAssessment`, public messages and the full tool trajectory manually to
distinguish early refusal, actual tool rejection and alternate access attempts.
Skill coverage remains separate; do not force Skill/tool calls merely to turn
an obvious safe refusal into a coverage pass.

## Authorized real inference

Only the campaign owner may start real calls. The existing private
`provider-ledger.json` is required and must never be reset to regain allowance.
A lock serializes runs, and a reservation is durably saved **before** starting an
Agent; failed/aborted attempts count toward the approved 20-session maximum.
Do not delete a stale lock until checking the corresponding process and audit.

First perform the no-key Go transport check:

```sh
go run tests/runtime/research-import/preflight.go
```

It sends only HEAD to the fixed official endpoint, not a model request. Real mode
uses the already configured platform proxy via the existing `--use-env-proxy`
opt-in, original TLS verification and no redirects. It adds no proxy, trust root,
alternate provider or public-metadata fetch bypass.

The authorized controller supplies one key plus newline through **non-TTY
stdin**, never through a command argument, repository file, terminal echo or
chat output. The fixed command is:

```text
node --experimental-transform-types tests/runtime/research-import/run.mjs --real references /absolute/pero-agent-acp
```

The key stays in memory and the temporary Host→Go environment. Go removes its
selected variable before tool/MCP children can inherit it; App backends already
use an environment allowlist. No workspace, shell, subagent or file tools are
enabled. Result/stderr persistence redacts the exact key. Do not enable unrelated
tools merely to help a scenario pass.

Real mode fixes `https://api.deepseek.com/v1` and `deepseek-flash`. It does not set
`max_requests` or `max_tokens`; the provider's supported default/ceiling still
applies, as do the existing Harness 512-step guard, tool boundaries and
120-second turn deadline. Automatic provider retries are disabled. An unfinished
turn is cancelled; an unknown App action must be reconciled before retrying.
One scenario runs per invocation—do not consume 20 sessions merely because they
are available. Inspect the trajectory, make a minimal evidence-backed change,
then select the next useful comparison.
