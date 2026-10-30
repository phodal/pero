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
