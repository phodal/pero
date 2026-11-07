---
kind: issue
status: open
date: 2026-11-07
github_issue: 162
github_state: open
github_url: https://github.com/phodal/pero/issues/162
---

# Optional Engram memory stays beside Insights

Engram can be an optional external MCP process for ordinary work sessions.
Insights continues to own session reading and brief generation. The two do not
share a store, and a brief session does not receive Engram's tools.

This narrows [#9](https://github.com/phodal/pero/issues/9) after the
[#161](https://github.com/phodal/pero/issues/161) comparison. Engram `v1.20.0`
(`ba9e46ced152c37a7cb9e576153c41995873e2fc`) remains the baseline. Hindsight is
not part of this work.

## What Insights already does

Insights is a deterministic reading of the Host journal, plus one App that asks
an Agent to write a brief from that reading.

- `HostCommand::Insights` calls `Manager::insights_value`. The shell in
  `crates/pero-host/src/insights.rs` maps one thread of `sessions.jsonl` into a
  transcript and folds it with `crates/session-analysis`. The fold receives no
  clock, files, git, or network. A checkpoint sits next to the journal at
  `insights/<session-id>.checkpoint.json`.
- The result keeps turn status, short request and response excerpts, tool names
  and errors, model, branch, and repository. It drops tool arguments, tool
  output, and thinking. `docs/design-docs/session-analysis.md` also leaves
  cross-session memory out of this crate.
- `apps/insights` declares `insights`, `agent`, and `automation`. Its page asks
  the Host for the catalog, drops sessions bound to the Insights app, and keeps
  the latest 20 work conversations. `briefResultPrompt` tells the Agent not to
  call tools and to return one JSON object. `memoryContext.items` is hardcoded
  to an empty list.
- `PulseWorkRecap` can render a `MemoryContext`, but that shape is the old
  Point/Codex record. `apps/insights/ui-src/index.tsx` never passes it. The
  visible "related memory" block is not a live memory service.
- A brief is a normal App session. `Manager::app_request` creates it with an
  `AppSessionBinding` and `AppChatScope { app: "insights" }`, then sends the
  frozen prompt. The raw session remains in the journal. The App parses the
  reply into cards. Cards do not become verified research results.

## What the Engram trial changed in the design

The same nine synthetic records were saved through Engram MCP and, separately,
through Hindsight 1.2.0 in chunks mode. No model was shared, so this is not an
extraction score.

- Engram search found a saved rule and the `source_ref` written into its text.
  A second save with the same `topic_key` erased the old text. Separate saves
  kept both versions and only marked a conflict pending. Engram does not apply
  supersede by itself.
- `ENGRAM_PROJECT=beta` did not see an alpha secret. `all_projects=true` on the
  same database did. A second data directory did not.
- `mem_session_start` with this trial's directory named the project
  `pero-mem-poc` and overrode `ENGRAM_PROJECT`.
- `capture_prompt: false`, with no registered prompt, left the prompt count at
  0. The tool's own default for `capture_prompt` is still true.
- Search previews truncate at 300 characters. The structured search result does
  not include the body. Full text requires `mem_get_observation`.
- Hindsight preserved caller metadata and isolated banks, but its default
  recall returned all nine records for a question the corpus did not contain,
  including the secret. Reflect failed without an LLM. That service stays out.

## Integration

Engram remains an external `engram mcp` process. Pero does not import its Go
packages, create a notes database, or install the binary at runtime.

### Session admission

`Manager::create_session_with_resume` already loads saved MCP settings and
passes them through `AgentConfig::with_managed_mcp` into `session/new`. That
saved connector record has command and args only. It has no environment.
Engram's data directory is selected only by `ENGRAM_DATA_DIR`; otherwise it
uses `~/.engram`.

Do not add Engram as a user-typed connector. When the operator enables it,
Host appends one stdio server while creating a session:

- `command` is the configured absolute binary path.
- `args` are `mcp`, `--project`, the session project key, and an explicit
  `--tools` list. An empty tool filter registers every tool.
- `env` is set on that ACP server, which the harness already accepts:
  `ENGRAM_DATA_DIR` points at one directory under the Host data home, and
  `ENGRAM_CLOUD_AUTOSYNC` is `0`. Do not forward a cloud token.
- The project key is the canonical workspace path's stable digest. Session
  creation does not currently know a `ResearchProject` id. A later binding can
  replace the digest with that id at the existing preferences owner. The key
  is never the directory basename.

The ACP tool policy meta uses the existing `pero.mcpToolPolicy` field:

| Tool | Decision |
| --- | --- |
| `mem_search`, `mem_context`, `mem_timeline`, `mem_get_observation`, `mem_stats`, `mem_current_project` | allow |
| `mem_save`, `mem_update` | ask |
| everything else, including `mem_delete`, `mem_save_prompt`, `mem_capture_passive`, `mem_session_start`, `mem_session_end`, `mem_session_summary`, `mem_merge_projects`, `mem_judge`, `mem_compare` | deny |

`--tools` carries the same names. Policy remains the authorization; the filter
only keeps the denied tools out of the prompt.

One data directory per project key makes `all_projects` unable to cross
projects. Pero still does not treat the project name as the boundary.

Disabled and missing-binary states do nothing and do not create a directory.
An enabled setting with a missing or relative binary fails that session
explicitly and does not fall back to `~/.engram`.

`topic_key` still overwrites. Host session instructions say to omit it and to
include the Host session id in the saved text. That instruction is not a
guarantee. Engram is not the store for a result that must keep an old version
or a verifier status.

### Insights boundary

Insights brief sessions are exactly the sessions whose `AppChatScope.app` is
`insights`. They do not receive the Engram server. Their prompt already forbids
tool calls and already supplies an empty `memoryContext`. Leave both in place.

The journal fold does not read Engram. A saved memory does not change turn
counts, excerpts, or brief cards. Card sources remain Host session ids from the
catalog. An Engram row is not evidence that a run or a paper claim was
verified.

A later, separate change can run `engram search` from the Host, then
`mem_get_observation` for the few hits, and place at most 20 truncated items
into `memoryContext` before `briefResultPrompt`. The existing prompt already
says that a memory relevance reason explains selection only. That read is not
part of the first admission change, and the brief Agent still must not receive
write tools.

## Acceptance

Use synthetic values only.

- Disabled, or enabled with a missing binary: no directory, no process, and the
  session either starts without Engram or reports the missing binary.
- Enabled: session A saves a unique value through `mem_save`; a new session B
  in the same project directory finds it by `mem_search` without copying the
  chat. Restarting the MCP process keeps the value.
- A second project directory does not return that value, including with
  `all_projects=true`.
- An Insights brief session's `session/new` server list has no Engram server.
  `insights_value` for an unrelated thread is unchanged.
- Denied tools are absent. A save does not increase Engram's prompt count.
- The same `topic_key` still overwrites. The test records that limitation
  rather than treating the new text as a versioned claim.

## Out of scope

Hindsight, LangMem, Graphiti, EverOS, Mastra, a claim database, dreaming,
wiki pages, and automatic promotion of a memory into a system instruction.
