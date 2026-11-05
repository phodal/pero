# Structured user questions

`AskUserQuestion` uses an optional Pero ACP extension. It is separate from
`session/request_permission`: choosing an answer does not authorize a file,
command, tool or permission-mode change.

The native composition enables the extension with `Options.UserQuestions`.
The plugin CLI profile enables that option. A client must also include
`"pero.userQuestions": 1` in `initialize.clientCapabilities._meta`. An enabled
server advertises the same revision in `agentCapabilities._meta`. Both sides
must support revision 1 before the tool is registered. Missing or unsupported
client revisions leave the tool absent; there is no permission-popup fallback.

## Request and response

The server sends a JSON-RPC request, with its normal request ID:

```json
{
  "jsonrpc": "2.0",
  "id": "point-1",
  "method": "_pero/user_questions/ask",
  "params": {
    "sessionId": "current-session",
    "toolCallId": "question-call",
    "questions": [{
      "question": "Which language?",
      "header": "Language",
      "options": [
        {"label": "Go", "description": "Harness"},
        {"label": "Rust", "description": "UI"}
      ],
      "multiSelect": false
    }]
  }
}
```

Present all questions, their descriptions and an additional Other text input.
Return the original JSON-RPC ID with a result such as:

```json
{
  "outcome": "answered",
  "answers": [{"questionIndex": 0, "selectedOptions": [1]}]
}
```

Question and option indices are zero based. Every question must be answered
exactly once, in any order. A single-select question accepts exactly one choice
or nonempty `text`. A multi-select question accepts several distinct choices
and may include `text` for a custom answer. Unknown indices, duplicates and
incomplete answers fail the tool. To dismiss the batch, return
`{"outcome":"cancelled"}` without answers. Cancellation never selects a
default choice.

The broker returns the original `questions` and Claude-compatible `answers`
to the model, for example `{"Which language?":"Rust"}`. Multi-select labels
and custom text are joined with `", "`. The model cannot supply an `answers`
field to bypass the human transport. Calls support 1–4 questions, 2–4 options
per question and headers of up to 12 characters. Question text and option
labels must be unique within their respective batch/question.

The request remains pending until the user answers or its tool context is
cancelled. On cancellation the server emits the notification
`_pero/user_questions/cancel` with `sessionId` and `toolCallId`; dismiss the
matching UI and discard its pending reply. The existing RPC pending-request
owner ignores late responses. Requests are scoped to the exact live root
agent and are absent from subagents. Session resume mounts a fresh broker;
an interrupted question is not restored as a new interactive request.

Optional option `preview` strings pass through as presentation data. Render
them as inert text unless the client has a separate safe preview renderer.
Model-provided `answers`, `annotations` and `metadata`, freeform whole-card
responses, timed continuation and deferred/cold-resumed pending questions
are currently unsupported and are not advertised in the tool schema.

## Desktop integration status

The current Desktop client does **not** advertise this capability, so it does
not receive the tool. Adding it requires a dedicated input path:

- `crates/pero-runtime/src/acp/session.rs`: handle the namespaced ask request,
  retain a correlated reply sender and handle cancellation; advertise the
  revision only after the complete input path is mounted.
- `crates/pero-contracts/src/lib.rs` and the Host agent command/event path:
  carry a typed question batch and a typed answer command independently of
  permission requests.
- `crates/pero-chat-ui/src/conversation.rs` and a dedicated question view:
  retain pending input by session/tool call and render single-select,
  multi-select, Other text, submit and dismiss states with keyboard support.
  `approvals.rs` handles permissions and cannot serve as a questionnaire.

`go test -race ./harness ./acp` includes a real NDJSON client/server round trip
with answered, cancelled, malformed, unnegotiated and resumed-session cases.
The Claude field/answer conventions follow the official
[user input guide](https://code.claude.com/docs/en/agent-sdk/user-input) and
[tool input reference](https://code.claude.com/docs/en/agent-sdk/typescript#askuserquestion).
