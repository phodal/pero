# Session analysis

Session analysis reads one transcript and returns a typed analysis. It lives in
`crates/session-analysis` and is not part of the harness. The harness executes
the agent loop. A later Pulse product can compose this crate. Git analysis
(ahead/behind, dirty paths, commits, review, CI) is a sibling and is not
implemented here.

## Boundary

`prepare` validates a transcript once, then `partition` cuts turn boundaries
in order. `classify_turn` reads one turn and returns facts. `reduce` folds those
facts in index order. The caller passes the analysis id and time. The core does
not read a clock, files, git, or the network.

The host shell is `crates/pero-host/src/insights.rs`. It maps one thread of
`sessions.jsonl` into a transcript, calls the concurrent fold, and stores a
checkpoint at `insights/<session-id>.checkpoint.json` next to that journal.
The Insights page asks for that result by session id.

`Session.git_branch` and `Session.repository` are copied onto the result. They
are a link the caller already knows, not a git-analysis engine.

## Async and checkpoints

Classification is synchronous. `analyze_concurrent` and `resume` schedule those
calls with `Future`s and join them, then reduce in transcript order. A
checkpoint is the reduce state plus the last fully reduced turn index. It is
taken only at turn boundaries. `resume` skips any turn at or behind that
cursor. The shell stops scheduling after a caller-supplied turn budget and
returns the checkpoint. Encoding the checkpoint is serde JSON. Nothing in this
crate writes it.

## Kept and dropped

Kept: turn status and outcome, user and assistant excerpts, tool name and
error, child session id, message class (text, meta, compact), token
components, model, and the session's branch and repository facts.

Dropped from this crate: Pulse home budgets, memory, session-file conflicts,
git status, GitHub delivery kinds, and Wake's cross-session insights
(streaks, heatmaps, hourly and weekly charts). Tool arguments, tool output,
and thinking text are not fields of the transcript.
