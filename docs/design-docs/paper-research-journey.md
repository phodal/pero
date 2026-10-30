# Paper research continuation and Harness journey

The reading-first surface stays intact. This slice adds local PDF import,
follow-up context, bounded model-assisted retrieval and editable evidence cells.
Host remains the execution/approval/cancellation owner; Python owns immutable
research records and evidence validation.

A `ConversationTurn` freezes prior questions and answer text as intent context,
never as supporting evidence. A request may reference a preceding frozen input;
the store resolves up to three prior turns from saved records, rather than
accepting prior answer text from the browser. Matrix values use the current
manual revision with an explicit provenance label; old frozen turns stay unchanged.

`ResearchPlan` freezes the question, sources and conversation for a source-language
query proposal. `RetrievalBatch` freezes retrieved page passages for model
selection/reordering. The model may request one additional query; at most two
search rounds execute. Only selected, existing passage IDs enter the final frozen
research input. Empty evidence produces a clear failure rather than an invented
answer. Each planning/selection/answer prompt is sent through the existing Host
Agent API with its own stable request identity. The App presents these bounded
stages; it does not create another process or tool runtime.

Local PDF upload uses raw `application/pdf` through the existing authenticated
App proxy. The saved bytes' SHA-256 identifies duplicates; original bytes,
annotations and locators use the existing PDF store. Local sources have a
`urn:sha256:` identity instead of a fabricated public URL. No OCR is added.

Matrix corrections form separate immutable revisions over a saved report.
Source evidence remains exact and machine-authored content remains recoverable.
Corrections never overwrite the original report or imply scientific acceptance.

The acceptance journey uses Meta-Harness: End-to-End Optimization of Model
Harnesses, arXiv:2603.28052v1. Import its actual PDF, ask a Chinese question about
its method, follow up about limitations/experimental conditions, inspect exact
PDF citations, correct a matrix value and reopen results. Include an unsupported
question. Record synthetic wiring checks separately from real Agent outcomes.
