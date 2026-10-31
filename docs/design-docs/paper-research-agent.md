# Paper research through one Host Agent session

## Problem

The earlier full-PDF flow opened separate planning, selection and answer sessions.
Two lexical searches could miss a central method section, and the answering
session had no way to open it. The observed Meta-Harness failure and baseline
answers are recorded in [the evidence coverage issue](../issues/2026-10-30-paper-research-evidence-coverage.md).

## Owners

`ResearchStudy` is a Python domain value containing the question, frozen sources,
observations, findings, unresolved gaps and final report reference. It has no
model client, process loop, running status, cancellation state or task queue.
The Rust Host and existing ACP Harness remain the execution and permission owner.

The Paper UI starts one Host session for a full-PDF question. That Agent chooses
reading/search/note operations and submits the final report through the existing
`app_describe` / `app_write` MCP transport. Abstract-only reading and explicit
code-verification requests keep their existing paths.

## Reading ledger

Study creation freezes `PaperSnapshot` and PDF identities, prior user questions
and answer context, a page catalog, and the exact initial prompt. Prior answers
are intent context, not scientific evidence. An explicit continuation preserves
the study and freezes a new prompt under a new Host request identity; it does not
replay previous tools. Each continuation prompt records available passage
locators, current notes and unresolved gaps.

The `research-step` App declaration routes to a fixed local API. Its domain
commands are:

| Command | Effect |
| --- | --- |
| `read` | Read a selected frozen PDF page from a specified character offset. Return original passages and an explicit continuation offset; append the observation. |
| `search` | Search only that study's frozen PDF versions; append exact retrieved passages. |
| `recall` | Return an already-observed passage and locator. Acquire no new evidence, consume no research step, and append no duplicate observation. |
| `note` | Append a finding and exact source references. Omitting gaps preserves them; supplying gaps replaces the open list, including an explicit empty list to clear it. |
| `finalize` | Freeze the observed input and validate/store the existing report format. End domain edits to that study. |

New observations and notes share a 24-step study budget; the last step is reserved
for finalization. A read returns at most 4,800 original characters in stable
passages, with `nextStart` whenever more page text remains. Search indexing is
per study, so a later replacement PDF cannot silently substitute the frozen
source. `recall` lets a continued session recover exact quotations even with only
the finalization step remaining.

Study definitions, steps and continuation prompts are saved independently in the
existing immutable document store, with steps partitioned by study. Reports use
`ResearchInput`, `ResearchReport` and exact quotation rules already owned by Paper.
Final evidence must come from passages observed in that study. Saved unresolved
gaps remain in the frozen retrieval scope, visible report footer and exports.

## App data access

Host `session_created` events already carry both `appBinding` and the App/panel
scope. Only that trusted association admits an App-owned run to background
`app_describe` / `app_write` access. A plain chat scope does not grant it. The
actual Host turn must be running, and another App or panel is refused.

Desktop continues to own the installed route and backend token. Agent arguments
cannot select a URL or credential. The calling Agent's existing permission policy
still applies, without another Desktop approval flow. Changing the visible Chat
does not interrupt a domain call from an App-owned session; cancellation, turn
completion, close and disconnect terminate pending calls. UI operation, capture
and Computer Use retain their selected-session and visibility requirements.

## UI and continuation

The question view shows recorded operations, findings and unresolved gaps. The
final report is loaded from the backend after finalization; the Agent's closing
chat message is not parsed as a second report. Starting failures retain the same
frozen request for retry.

Unfinished studies can be reopened from the question history. The UI checks the
original Host session before offering Continue. A still-running session is
reattached; a stopped one continues only after an explicit user action and with
the currently selected Agent. Completed reports remain immutable, and later
questions use the existing parent-input association.

## Boundaries and references

This implementation studies selected saved PDFs. It does not automatically
discover new web papers, render PDF page images into the model, execute scientific
experiments or provide a remote Research Worker. Its budget counts new research
steps, not provider reasoning or token cost. Exact quotation matching proves
location, not semantic support or scientific acceptance.

The implementation follows the studied mechanisms rather than vendoring another
runtime: PaperQA's tool loop, Feynman's working ledger, NVIDIA's findings/gaps
contract and FS-Researcher's recoverable source workspace. The nine actual Git
clones, versions and license observations are recorded in
[the source manifest](../../research_notes/Research%20Agent%20源码研究/manifest.json).
Detailed comparison is in [the source review](../../reports/Research%20Agent%20源码研究与%20Pero%20接入建议.md).

Verification: [Paper research Agent](../fitness/paper-research-agent.md).

## Original-text lines (2026-10-31)

New paper JSON records store `lines` rather than a single `content` string;
new PDF records store each page's `lines` rather than `text`. Entries retain
original newline characters, blank lines and Unicode exactly. Joining entries
reconstructs the same content digest and quotation offsets. Existing string
records remain readable without migration or changing source IDs. API responses
for the reader retain their existing text fields.

The study page catalog includes `lineCount`. The existing `read` action accepts
`startLine` and `endLine` (one-based, inclusive) with `paperId` and `page`.
A request must choose line ranges or the existing character `start` offset.
Observations retain the requested range, original passages, exact character
offsets and `nextLine`/`nextStart` continuation. The 4,800-character read budget
still applies; an oversized range is rejected with a smaller-range/character
read recovery message. Final report quotation validation and PDF highlighting
continue to use observed passage IDs and original offsets.

`GET /api/papers/{id}/lines?startLine=1&endLine=20` provides the same bounded
line view for saved online text, with source digest, total line count and next
line. Agent PDF research uses the scoped `research-step` tool and frozen PDF
identity; it does not use that HTTP route to bypass its evidence ledger.

## Follow-up evidence and delivery

A `StudyCarryover` retains original observed passages from the parent input only
when paper ID, PDF document ID and file digest match the newly frozen sources.
It never treats earlier answer prose as evidence. Reused passages appear in the
initial observation catalog with short previews and can be recalled through the
existing tool without consuming a reading step. Replacing a PDF excludes its old
passages; old study records without carryover keep their previous behavior.

A persisted finalized report is the App delivery. The UI requests cancellation
of the owned Host turn if it continues afterward, waits for the Host terminal
status, and retains the report. This prevents post-delivery tool use and a locked
composer. A successful saved report is not presented as a cancelled research
result just because the shell stopped the remaining execution.

Discussed selections retain their source paper, PDF version, page and rectangle.
The composer can reveal the original selection, and includes the paper title and
page in the submitted context. Citation, annotation and selection navigation use
one reveal operation; narrow layouts close the covering conversation. Source
buttons show PDF page numbers instead of repeating one long paper title.

`ContextSelection` preserves selected text separately from the question. The App
writes its exact UTF-8 bytes to `research-v1/context-files/<id>.txt`, and keeps an
immutable `ContextFile` record with the absolute path, digest and source/page
identity. The question retains its 2,000-character limit; selected text does not
consume that budget. Whole-page discussion uses the same file-backed flow.
Input and conversation records carry the file reference, so reopening or
explicitly following an older answer keeps its selected context.

The Agent receives the path and reads on demand with the declared `read-context`
App tool, using an opaque context ID and bounded character or original-line
ranges. App-managed absolute paths are not workspace-relative paths accepted by
every Agent's ordinary file tool. `ContextRead` owns range rules; the store reads
the bytes and checks the digest. Abstract-only questions use the same tool without
a PDF study. The existing study context action also delegates to this reader.
Reading a selection adds no validated evidence and consumes no study step;
reports still cite observed original sources.

Research polling continues while the App is hidden, including report delivery
and Host-turn cleanup. The currently read paper owns its source selection;
another paper's finishing task must not replace it. Saved answers offer an
explicit follow-up target. The transcript follows new output only while the
reader remains near the bottom, and Enter shares the visible Send action's
disabled conditions. The custom conversation described in this historical implementation was replaced
by the shared Host conversation below.


## Shared conversation and declared Paper capabilities (2026-10-31)

Paper Ask, PDF/page selections and comparison actions now freeze a
`PaperResearchSelection` into the existing Host Chat draft. The React registry
is updated before a reference is captured. A selection carries saved paper IDs,
PDF-reading mode and optional context-file, parent-input or unfinished-study ID;
it grants no tool permission. The SDK opens or fills the draft without sending. An explicit App launch creates
a new draft when the remembered conversation is closed after restart; the old
conversation remains in history.
The person chooses the Agent, sends, approves or cancels in the shared GPUI
ChatPanel. Paper has no composer, session launcher, transcript polling or
closing-message parser. Research records are a separate read-only domain view,
with exports, citations, editable matrix revisions and explicit follow-up or
continuation links. Existing immutable records stay readable.

The extension boundary is the installed App's `contributes.writes` schema:

| Tool | Domain effect |
| --- | --- |
| `prepare-research` | Parse `ResearchRequest` once, prepare missing PDFs when requested, freeze a study or bounded text input, and return its prompt/schema. Start no Agent. |
| `research-step` | Read/search/recall observations, record findings and gaps, finalize evidence-validated PDF reports using the existing ledger. |
| `read-context` | Read the selected UTF-8 context file on demand, without making it source evidence. |
| `continue-research` | Freeze an explicit continuation prompt while retaining the study, evidence and step budget. |
| `submit-report` | Validate and persist a non-study report against its frozen input. Tool JSON text is bounded at 64 KiB; PDF reports continue through the structured `research-step` document. |

The Agent discovers schemas with `app_describe` and calls them through
`app_write` in the same conversation. The returned frozen prompt owns the
research instructions. On success it summarizes the saved report and ends the
turn. Source text and earlier answer prose remain untrusted data. Domain report
validation remains in Python; neither shell introduces a Paper-specific tool
switch, report parser, scheduler or permission system.

Both Electron and native compose the same MCP authority, AppChatContext and
AppWriteRoutes. The native stdio adapter supplies selected-draft and semantic
snapshot ports and private Host route resolution. Only the managed sending
WebView determines App/panel identity. Native semantic snapshots can read a
retained panel; they do not claim that a hidden panel is operable or capturable.
Native UI operation/capture remains unavailable. Shared conversation data calls
follow the existing selected/running-session rule; switching conversations does
not grant background App data access merely because an App scope exists.
Reports record `app-submitted` provenance (submission origin, not a trusted Host
session attestation) without inventing a Host session ID from a
Paper request ID; older imported/client-reported records retain their digests.

To extend Paper, add a named domain command and its existing App API transport,
declare its schema here in `app.json`, and cover its behavior in the owning
Python concept's table. Add semantic App actions only for UI operations. The
chat and native shells require no Paper-specific extension code.
