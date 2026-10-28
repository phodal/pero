# Optional long-term memory (Engram)

Pero can give a coding session long-term memory by running [Engram](https://github.com/Gentleman-Programming/engram) as an **external MCP process** (`engram mcp`, stdio). It reuses the ACP `mcpServers` list the Rust runtime already sends and the Go harness's MCP bridge. Pero adds no memory database and does not embed Engram. Engram owns persistence, schema and recovery; Pero owns which tools may run and which calls need approval.

It is **off by default**. Nothing is discovered, installed or created: the Engram binary, data directory and project are all named by the operator.

## Enable

In `agents.local.json` (see [agents.example.json](../../agents.example.json)), add a `memory` block to the agent that should have it:

```json
{
  "id": "pero-agent",
  "name": "Pero Agent",
  "command": "/absolute/path/to/pero-agent-acp",
  "memory": {
    "enabled": true,
    "engram": "/absolute/path/to/engram",
    "data_dir": "/absolute/path/to/memory/this-workspace",
    "project": "this-workspace",
    "mutations": "deny"
  }
}
```

| Field | Meaning |
| --- | --- |
| `enabled` | Default `false`. A disabled block is inert: no file is read, checked or created. |
| `engram` | Absolute path of an Engram binary. Never searched for on `PATH`, never installed. |
| `data_dir` | Absolute directory Engram stores its database in. Pero does not create it; Engram does on first start. |
| `project` | Project every call is bound to (see [boundaries](#boundaries)). |
| `mutations` | `deny` (default) offers read tools only. `approve` also offers writes, each needing approval. |
| `tools` | Optional subset of the supported tools below. |

Unknown fields are rejected, so a typo such as `enable` fails loudly instead of leaving memory off or widening it.

If `enabled` is true and the binary is missing, the session fails with an explicit error **before any agent process starts**.

## Tools and approval

Pero polices exactly five Engram tools. Which of them mutate is declared by Pero, not read from the server: `readOnlyHint` and model instructions are never used as authorization.

| Tool | Class | Policy |
| --- | --- | --- |
| `mem_search` | read | `project` and `all_projects` forbidden |
| `mem_get_observation` | read | none (see boundaries) |
| `mem_context` | read | `project` forbidden |
| `mem_save` | mutating, approval per call | `capture_prompt` pinned to `false`; `project`, `project_choice_reason`, `recovery_token`, `session_id` forbidden |
| `mem_session_summary` | mutating, approval per call | same four arguments forbidden |

Everything else (`mem_save_prompt`, `mem_capture_passive`, `mem_update`, deletion, merging, stats, …) is not offered. `engram mcp` is also started with `--tools=` listing only the offered tools, so the server does not register the rest. A call the policy refuses is rejected before approval is requested and never reaches Engram. With `mutations: "deny"` the write tools are not offered at all.

A tool failure, or an unknown outcome such as the child dying mid-call, is returned to the model as-is. Writes are never retried or replayed.

## Privacy defaults

- **Prompt capture:** Engram's `mem_save` defaults `capture_prompt` to `true`. Pero pins it to `false` and rejects `true`. `mem_save_prompt` and `mem_capture_passive`, the tools that record prompts or extract text on their own, are not offered.
- **Cloud sync:** the child gets `ENGRAM_CLOUD_AUTOSYNC=0` and empty `ENGRAM_CLOUD_SERVER` / `ENGRAM_CLOUD_TOKEN`. Engram only autosyncs when the variable is exactly `1`.
- **Environment:** the child inherits **nothing** (`cleanEnvironment`): only `HOME`, `ENGRAM_DATA_DIR`, `ENGRAM_PROJECT` and the cloud overrides. Engram refuses to start without a `HOME`, so `HOME` is set to the data directory, never to the user's home.
- **No implicit state:** no home-directory discovery, no package-manager install, no cloud account setup.

## Boundaries

- `ENGRAM_PROJECT` is a default, not a security boundary. Engram resolves the project from an explicit argument, then a session id, then `ENGRAM_PROJECT`. Pero forbids the model from supplying the first two, but `mem_get_observation` takes a bare ID that is not project-scoped. **Use a separate `data_dir` wherever workspaces must not see each other's memory.**
- The tool policy is enforced by Pero's Go agent (`pero-agent-acp`). Other ACP agents (Codex, Claude, OpenCode adapters) ignore the policy: for them only the `--tools=` restriction and the agent's own permission prompts apply, so pins, forbids and Pero's approval do not. Prefer `mutations: "deny"` with those agents.
- Memory content is whatever the model chooses to save. Do not point it at real personal data until you have decided how it is reviewed.

## How it maps to the DSH overlay

The [DSH Engram overlay](https://github.com/deepseek-ai/deepseek-harness/blob/f3803c96974ad4a94195fb97e5c637e9c2a3afe3/apps/cli/config/examples/mcp-memory/engram.cordis.yml) starts `engram mcp` over stdio with the working directory as `cwd`, and leaves the data directory and project to Engram. Pero keeps the transport and command, and the session working directory is the child's `cwd`. It differs where the issue requires: explicit binary, data directory and project; an environment that inherits nothing; a closed tool allowlist; approval for writes. The tool names carry the same shape, `mcp__engram__<tool>`.

## Engram baseline

| | |
| --- | --- |
| Version | v1.20.0, commit `ba9e46ced152c37a7cb9e576153c41995873e2fc` |
| License | MIT (Copyright 2026 Alan Buscaglia). Pero only runs the binary: no source is vendored and no binary is committed. |
| Toolchain | `go 1.25.10` in `go.mod`; pure Go (`modernc.org/sqlite`), builds with `CGO_ENABLED=0` |

Build it outside the repository:

```sh
git clone https://github.com/Gentleman-Programming/engram /tmp/engram-src && cd /tmp/engram-src
git checkout ba9e46ced152c37a7cb9e576153c41995873e2fc
CGO_ENABLED=0 go build -o /absolute/path/to/engram ./cmd/engram
```

`engram mcp` does not check for updates; other `engram` subcommands do contact GitHub, so Pero never runs them.

## Verification

Report fixture and real-Engram results separately; each proves something different.

| Layer | Command | Proves |
| --- | --- | --- |
| Rust config | `cargo test -p pero-runtime memory` | Off by default; missing binary fails before spawn and creates nothing; the ACP entry equals the shared golden `tests/fixtures/engram-memory/mcp-server.json`; typos and unsupported tools are rejected |
| Policy core | `go -C harness/go test ./mcp` | Exposure, pins, forbids, validation |
| Fixture (stand-in MCP server) | `go -C harness/go test ./acp` | What the model sees; approval allow/reject/cancel; refused arguments never ask for approval; tool failure and a dying child are reported and never replayed; cancellation; child exit; environment isolation; strict `_meta` |
| Real Engram | `PERO_ENGRAM_BIN=/absolute/path/to/engram go -C harness/go test ./acp -run Engram -v` | Session A saves a synthetic value, fresh session B searches and reads it with no copied history, and it survives a new MCP process; separate data directories share nothing; tool surface and argument policy against the real server; denied or cancelled writes leave the store empty; no prompt is recorded; cloud and credential variables do not reach the child |

Without `PERO_ENGRAM_BIN` the real-Engram tests **skip with a message**; a skip is not a pass. No real user memory, model credentials or model calls are used: a scripted provider drives the real Agent loop.

Not covered: Bazel targets, Windows and macOS, the Desktop UI approval card, and a run through the full Rust Worker plus the built `pero-agent-acp` binary against Engram. The Rust-to-Go hand-off is covered by the shared golden entry on each side.
