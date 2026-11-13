---
kind: progress_note
status: in_progress
---

# Shared human / Agent computation session

## Scope and owner

`scienceenv.Env` remains the owner of each exact Agent's Python, R and repl
processes. The Notebook is an observer and user input surface. The new
`_pero/science/session` ACP extension carries commands to this existing owner;
Host grants and the existing App chat scope select the session. There is no
additional kernel pool, approval flow, retry loop, artifact store or model loop.

Viewer previously offered only App-owned Jupyter `python3`. It now defaults to
Shared Agent session and labels the existing Jupyter path Separate Python kernel.
That explicit standalone mode retains nbformat rich outputs and its existing App
lifecycle; it does not claim to share Agent variables. Shared Python, R and repl
retain the existing scienceenv language boundaries; repl remains a separate
Python process and only repl supports host.mcp.

## Behavior to preserve

- Agent tools still require existing Harness approval; typed user commands use
  the existing App agent grant and are bound by Host to that App's live session.
- One interpreter serializes actual cells; a competing submission reports busy.
- Agent and user cells share variables and are observable in one execution journal.
  Receipts are appended to the existing Agent JSONL log as `science/cell` records.
- A language exception retains state. Interrupt follows the existing scienceenv
  contract: kill the process and discard variables. Restart/close clear variables,
  keep receipts and expose the new interpreter generation. No automatic replay.
- Closing or switching the shared Notebook view does not close a kernel. Exact
  Agent retirement closes only its own kernels. Other conversations remain live.
- Missing R is an explicit unavailable state with installation/configuration and
  retry guidance; no Python fallback is represented as R execution.
- Existing artifact/Notebook evidence types are unchanged. This is computation
  history, not scientific verification or acceptance.

## Migration

`NotebookRunner` gains a mode selector and a `SharedNotebook` consumer of public
App SDK agent APIs. The original local path remains. Output rendering is shared
between the two modes through `NotebookOutput`; theme tokens and controls remain
from `@pero/app-sdk/ui`. Desktop and Native forward the new operations through
existing Host capability carriers. Stored Notebook files need no migration.

Verification and remaining acceptance boundaries are recorded in
[shared science session verification](../fitness/shared-science-session.md).
