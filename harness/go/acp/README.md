# ACP session admission and MCP restoration

Native composition can supply a working-directory validator; new/load/resume
run it before persistence loading or MCP/agent activation. Protocol-only users
without a validator retain the absolute-cwd contract. Tool execution still
rechecks authority after admission.

Resume and load inspect the latest persisted `session/acp-controller` receipt.
For the current version-1 receipt, `requiresClientMCP: true` requires the client
to supply a nonempty `mcpServers` list again. Missing dependencies fail before
agent resumption, interrupted-turn repair or a new controller receipt is written.
Malformed, incomplete or unknown-version controller receipts fail explicitly;
they are never silently treated as `false`. A session without a receipt, or whose
latest supported receipt says `false`, retains its existing behavior.

This is only a dependency-presence check. It does not establish equality of
server names, endpoints, executable paths, versions or permissions. Current MCP
configuration is still explicitly supplied by the trusted ACP client and passes
normal validation. No MCP credentials or endpoint configuration are added to the
receipt, and this change introduces no automatic permission grant or reconnect
configuration policy.

## Incremental output

Live ACP output projects the existing Point-derived `assistant/chunk` events,
without another model runtime or provider dispatch. Text becomes
`agent_message_chunk`; visible reasoning text becomes `agent_thought_chunk`.
Opaque reasoning metadata, usage and partial tool arguments are not exposed as
assistant text. Tool calls/results keep their existing separate updates.

The completion supplies only text/thought suffixes not already streamed (plus
non-text committed content). Non-streaming adapters still project the full
completion. If a provider contradicts its streamed prefix, ACP cannot retract
those bytes: the conflicting final lane is suppressed live, and the committed
completion remains canonical on load. Failed/retried attempts may already be
visible provisionally; attempts reset deduplication, never merge their prefixes.

`session/resume` does not replay old notifications. `session/load` projects only
committed messages and tool events, not provisional chunks; failed uncommitted
prefixes therefore disappear on load, while interrupted committed prefixes
appear once. Cancellation/close seals live projection. The shared harness fences
provider emit callbacks to the exact Generate invocation and cancellation context,
so retained callbacks cannot write into later attempts or reused sessions.

## Explicit model selection (opt-in)

`--model a --selectable-model b` enables the ACP v1 `model` select option.
Repeat `--selectable-model` for at most 32 additional model IDs. The default
single-model launch still returns no model selector. Every session also
advertises a `permission` selector, defaulting to `auto-review`. These are
operator declarations, not model discovery: the existing compatible adapter
returns detached metadata from its configured catalog without HTTP requests.
The existing ProviderRegistry validates metadata and Agent.SelectModel validates
and records the session choice. No provider, credential or settings registry is
introduced; endpoints and credentials are neither chosen nor persisted by ACP.

Every declared model shares the explicit `--context-window`, output cap and
reasoning configuration. The operator must choose a conservative capacity and
settings supported by **all** selected models. No capacity is inferred from an
ID. Existing compaction validation runs before additional declarations are
cloned; zero capacity leaves compaction disabled. Embedded callers opting into
`Options.ModelSelection` must supply a catalog through the registered adapter;
unequal context/output capacities and mismatched compaction fallbacks fail at
startup. A changed route capacity rejects subsequent selection or restoration.
The shared TokenMeter invalidates the prior usage anchor when the next request
header changes model; the compactor resolves that request's model metadata.

New/load/resume responses include the current model and complete option list.
`session/set_config_option` accepts `configId: "model"` when model selection is
enabled, and `configId: "permission"` for an advertised permission mode.
Selection is session-local, serialized against prompt admission,
and rejected during active prompts, commands or closure. Unknown models,
sessions, config IDs and fields fail closed. Experimental `session/set_model`
is not claimed. Successful selection is durably flushed; load/resume validates
the recorded route against the current explicit catalog before agent activation.
A selection append/flush failure closes the uncertain session instead of
claiming rollback; recovery requires explicit load/resume and a usable store.
Changing a model itself never generates a completion.

Provenance: the pinned Point ACP server did **not** implement model selection.
This is new, narrow ACP transport/CLI glue over existing Point primitives, not a
claim of copied upstream ACP behavior. See `MODEL_SELECTION_SOURCE.json`.
Protocol: https://agentclientprotocol.com/protocol/v1/session-config-options
