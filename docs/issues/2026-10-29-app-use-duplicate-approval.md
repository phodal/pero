---
kind: incident
status: resolved
date: 2026-10-29
---

# App Use added manual approval after Agent approval

The App Use Desktop adapter synthesized its own `app-use-*` permission requests
for operations, standing reads, captures and persistent writes. Those requests
always asked a person, even when the calling Agent session used automatic review
or full access. This was a second policy owner. Point delegates its questions to
the session approval policy rather than requiring an independent manual answer.

The authenticated ACP/MCP caller now follows its Agent's approval policy. Desktop
creates the bounded task or executes the validated declared write directly after
the tool call reaches it. Agent `session/request_permission` still uses the
existing Host/Chat permission path; denial prevents the Agent from executing the
requested tool. There is no second Desktop approval queue or policy selector.

App screenshots added to a draft also need no extra question: only the managed
App's visible frame is captured and the person still decides whether to send the
draft. App identity, selected conversation, fixed task actions, expiry, revoke,
visibility, original file grants, schema/route validation and evidence stay intact.

Acceptance covers automatic operation/file/write completion and explicit Agent
policy denial. Product records permission IDs to prove only Agent requests appear.


Verified: eight authority/context/file/write tests, six SDK tests and both actual
Desktop suites passed. Product completed eleven checks and recorded exactly two
explicit Agent-originated permission questions. Operations, captures, file input
and allowed persistent writes completed without a Desktop permission request.
The Host protocol check and embedded workflow test also passed.
