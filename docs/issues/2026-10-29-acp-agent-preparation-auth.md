---
kind: incident
status: resolved
---

# Agent selection required a separate connection and advertised misleading login

Selecting an Agent only changed the draft's Agent ID. Users had to connect before
seeing models and session settings, although first-send already prepared a
session automatically. Connection readiness also locked Agent/workspace selection
for an otherwise empty conversation.

The Grok registry entry actually launched OpenCode with a pinned xAI provider.
Its `opencode-login` method acknowledges an external login; it does not perform
that login. Displaying it as an ordinary sign-in button implied an action it did
not carry out. Native Grok and Qoder installations were not represented.

## Resolution

Shared ChatPanel prepares visible drafts automatically, keeps an empty session
retargetable, preserves rich drafts and frozen references, and exposes startup
retry. Pending first submissions are restored after authentication/setup failure.
Replacement identities reach workspace navigation before stale tabs are removed;
late events from a discarded empty session are ignored.

Grok now denotes xAI's native CLI, Qoder uses `qodercli --acp`, and OpenCode is a
separate Agent. OpenCode/Qoder credential acknowledgement displays the actual
terminal command and an explicit completion action. Authentication never resends
a previous prompt.

## Local prerequisite still outstanding

On 2026-10-29, `~/.grok/bin/grok` and `agent` pointed to the missing
`~/.grok/downloads/grok-macos-aarch64`. `/opt/homebrew/bin/grok` is the unrelated
Homebrew grok 0.9.2 text-processing program. The native Agent is therefore shown
as unavailable; no installer, credentials or user-global configuration was changed.
This installation prerequisite is separate from the resolved UI/registry defects.

Verification and remaining boundaries: [Agent preparation](../fitness/agent-preparation.md).
