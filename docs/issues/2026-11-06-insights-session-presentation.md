---
kind: issue
status: resolved
date: 2026-11-06
---

# Insights generation exposes its machine reply as an ordinary conversation

The supplied Native Preview screenshot shows a conversation titled
`Carry out the user's fro`, a fixed English instruction, the attachment label
`Frozen paper research input`, and a long inline JSON reply. This is an Insights
brief generation session, not a Paper research conversation.

## Local evidence

Profile: `/Users/phodal/.pero/native-preview`, workspace source `9cf2df12`.
The installed Insights source files match the workspace, and its built bundle
contains the same result parser.

- Host thread: `app:insights:insights-1793940610307`.
- `sessions.jsonl:33808` records `appBinding.app=insights`, agent `pero`, and
  scope `insights/main`; line 33809 records the wrapper instruction and a
  47,409-character frozen context.
- Lines 33812 through 36143 contain 2,330 `agent_message_chunk` events. Joined,
  they form valid JSON with 5,340 characters and six cards, matching the
  screenshot's opening title and body.
- Line 36144 records `turn_finished` with `stopReason=end_turn`. There are no
  tool calls, session errors or title updates in this thread.
- Harness session `4025e25c-e1ca-403b-8d5f-c42baccaac02.jsonl` records turn start
  at 2026-11-06 12:50:10 and normal stop at 12:50:24, Asia/Shanghai. The turn
  completed; the screenshot is not evidence of interrupted JSON generation.

## Why it appears this way

`apps/insights/ui-src/work-recap-model.mjs` explicitly instructs the Agent to
return only one JSON object because this Host has neither `pulse_context` nor
`pulse_publish`. The App starts a real Host session and parses the reply for
its own card UI. The ordinary conversation view instead accumulates assistant
text and passes it to the shared Markdown renderer. It has no Insights result
presentation. Bare JSON therefore becomes one long paragraph.

`crates/pero-host/src/app_agent.rs` uses the same wrapper instruction and
Paper-specific attachment label for every App-initiated request. The chat title
uses the first 24 characters of that wrapper until an Agent title is reported;
this thread has no title update. Chat displays context labels, not their body:
the visible JSON is the assistant reply, not an expanded frozen attachment.

Before this change, the brief lived only in React component state after `briefFromReply` succeeded.
The raw Host conversation persists separately. No brief publication or durable
brief save is implemented in this App path. This inspection did not establish
whether the App accepted and displayed this particular result before the user
opened its raw conversation.

## Related result-contract loss

Passing this exact reply through the existing `briefFromReply` confirms:

- All six cards lose `entity`, `action` and `sources`: the reply uses strings
  for entity/action and source objects without labels, while the parser
  requires objects with `label`.
- Two `tomorrow` suggestions are lost because the reply uses an array and the
  parser only accepts a string.
- `view.sections` survives parsing, but `PulseHomeResult` does not consume it.

The prompt describes these fields without an exact shape matching the parser.
A syntactically valid reply can therefore produce cards with no source links
or continuation actions. This is separate from raw JSON appearing in Chat.

## Implementation

Insights generation now has a localized prompt, an appropriate provisional
title and a compact result entry in Chat. Original JSON remains expandable in
a bounded reading area, with the existing Save as document action and source
anchor retained. Subsequent user conversation stays ordinary Chat. Other Apps
receive an App-specific frozen request label. Insights schema ownership stays
in the App; ordinary JSON replies do not become inferred cards.

The brief prompt now specifies entity/action/source objects and a string of
suggestions. The parser accepts both that contract and the observed historical
reply, recovering six objects, four actions, ten sources and two suggestions.
The unused generated-layout request was removed.

Host catalog metadata identifies real App bindings. Insights replays completed
briefs from the existing Host journal without starting an Agent or creating a
second store. An unreadable or unfinished newer generation retains the latest
readable result with local feedback. Missing generation timestamps are not
replaced by the current time or a Today label.

The screenshot's large empty research heading came from an out-of-date running
bundle, despite matching installed source files. The rebuilt App uses the shared
LibraryHeader. With a brief present,
successfully loaded empty research checks are omitted; checks with data,
loading and errors keep their own presentation and retained results.

## AI input and summary quality

The UI follow-up found that the first fixes still produced a status feed rather
than a useful synthesis. This was an input and publication-contract problem:

- The catalog used first appearance order, and the prompt took the first 20
  entries. Three real generations reused the same oldest 20 records, including
  11 prior Insights briefs, while excluding 7, 8 and 9 newer records.
- `toSession` dropped App identity before selection, so old generated briefs
  became input to later briefs. It also hid turn truncation.
- The App labelled cumulative history as the current day with equal start/end
  times and complete coverage. The prompt then described a yesterday window.
- Session analysis is a deterministic fold, not a semantic summary. It retains
  at most 800 UTF-8 bytes of each request/response and the last assistant segment
  of a turn. Real replies contained cards and suggestions but no overview.

The Host catalog now orders real content activity while ignoring close, title
and configuration replay. The App excludes actual Insights bindings before
selecting the latest 20 work conversations. It reports omitted/truncated input
honestly and leaves unreliable date bounds empty. The shell supplies the read
time to the value projection.

A current Host fold over a copied real journal returned 30 conversations:
16 Insights generations were excluded and all 14 work conversations were
selected. Nineteen of 23 turns were truncated, so coverage remained incomplete.
The constructed prompt was 44,888 UTF-8 bytes, below the 128,000-byte limit.
This check did not start an Agent or alter the original profile; unreadable=0
describes only the catalog's returned summaries, not whole-profile health.

The publication now includes a short cross-conversation `summary`. The prompt
asks for two or three work themes rather than concatenated card titles. All
reader-facing fields use the selected language and meaningful object, source
and action names. IDs, hashes, raw commit subjects, status fragments, error
codes and placeholder responses remain in dedicated reference fields or
necessary technical evidence. Historical single-entry availability does not
establish a current project-wide absence of source material. Different papers
and differing observations must retain their boundaries.

## Independent design review

An independent sub-agent reviewed the captured Native surface and produced a
separate prototype under this chat's `insights-redesign-agent` visualization
directory. That prototype uses real saved references with an explicitly marked
editorial summary; it is not real-provider or Native acceptance.

The production follow-through replaces the equal-weight tabbed feed with one
continuous reading surface: AI summary, sourced conclusions and discussion.
Only genuine `needs_you` findings occupy a separate warm decision area. At
narrow widths the order is summary, decision, findings and discussion. There
are no popularity or fabricated calendar claims. Legacy results keep their
findings without inventing a missing summary, and original publication
disclosure retains filtered coverage notes.

Discussion uses the existing shared Composer and an SDK frozen App object.
The visible draft is only the natural question; summary/cards/sources travel
in its context attachment. Neither the discussion action nor restoration starts
execution. This follows the existing Paper App seam rather than adding another
chat owner.

Real-provider replay exposed a missing `kind` field in all eight cards. Passing
the resulting `undefined` into the strict App object registry caused an error.
Publication normalization now calls the existing `cardKind` rule at entry;
missing kinds become `watch`. The prompt also lists `kind` as required.
The exact real reply now registers with all eight cards and its summary intact.

## Session titles

DSH comparison used the local checkout `/Users/phodal/test/deepseek-harness`
at `d743267388641bc76f17c45ce8b4c231aed1d32c`. It has first-prompt and
all-prompts LLM title providers. Pero previously lacked generation and also
did not project persisted `session/title` into ACP session metadata.

The built-in Pero Agent now opts into one asynchronous title call after its
first successful turn, using the actual model route, real user context and
completed answer. It uses the existing Agent operation lifecycle, bounded
input, a 128-token output budget and a 15-second deadline. Title attempts and
accepted titles persist in the session journal; ACP emits and replays
`session_info_update`. A failure leaves the existing provisional title and
does not retry on each later turn. Protocol-only CLI consumers opt in with
`--session-titles`; custom Agent configurations retain their own arguments.

## Verification

- Original 5,340-character reply replay: six objects, four actions, ten sources
  and two suggestions retained after parsing.
- App prompt tests: 5 passed. Host: 44 passed. Chat: 21 passed. Runtime ACP:
  35 passed. Root TypeScript, generated contracts, bilingual messages and icon
  checks passed.
- Real Host stdio restart test restores the App binding and completed JSON
  without incrementing the fixture execution count.
- Insights browser scenarios: 15 passed, including exact historical-result
  navigation, malformed/missing locations, retained errors, explicit regeneration
  and clearing an old recovery warning after success, summary-first rendering,
  frozen context discussion, missing-kind publications and all original sources.
  Wide and dark large-text narrow fixtures under
  `test-results/insights-summary-consumer/` were visually inspected separately
  from Native.
- Go Harness full race suite and vet passed; title cases cover nonblocking
  generation, frozen context, failure, single attempt and replay.
- Native debug build passed. In the actual window, the original conversation
  displays Work brief with a compact result entry; expanding raw data retains
  Save as document. The rebuilt Insights surface has one page heading, source
  links and actions, and no prominent empty research block.
- A real local generation, `app:insights:insights-1793941597862`, emitted
  `session_info_update.title="发布每日洞察简报"` at Host journal line 42015;
  the sidebar displayed that title after restart.
- Final Native bundle was rebuilt and its installed JavaScript and CSS matched
  the build. Opening Insights from the original conversation restored its own
  ROADMAP card, source link and suggestions rather than the newer edition.
  Missing generation time stayed hidden, and the empty research section was
  absent. The number of Insights generation sessions remained 26 across these
  restarts and read-only navigation checks.

The first real summary generation after input repair contained no machine IDs
in any reader-facing field. A further prompt refinement limits its length and
prevents a historical abstract-only observation from becoming a current
missing-full-text claim.

Final live generation `app:insights:insights-1793945724548` completed with
`end_turn`, a two-sentence summary and eight cards, all with valid kinds. Its
frozen prompt contains the final writing contract (48,182 UTF-8 bytes).
The reader-facing summary, titles, conclusions, source names and action labels
contain no raw session IDs, hashes, status counters or error codes. RiseHarness
figure materials remain distinct from the other papers' abstract-level records.
The summary still lists several paper names and is 221 characters including
English titles, above its soft 120–180-character writing target; this is a
remaining writing-quality limitation, not a parser failure.

The actual Native window displayed this generated summary and naturally named
source links. Clicking Discuss this brief opened the shared Composer with
only the natural question and a frozen Work brief object reference
(`insights-brief@3`), rather than embedding JSON in the visible draft. The
verification draft was cleared without sending. Screenshots are retained at
`test-results/insights-polish/04-native-summary-final.jpg` and
`test-results/insights-polish/05-native-discussion-context.jpg` (not committed).
The two deliberate summary-generation checks are separate from the earlier
26-session read-only restoration observation.

Observations concern the local macOS Native Preview, originally based on
`9cf2df12`, with the scoped commits and working changes from this task. Signed
packages and other platforms are not verified here.

## Approved parallel topic cards (2026-11-06)

Design reference: the approved interactive HTML at
`/Users/phodal/.codex/visualizations/2026/11/06/01a1af83-3cb9-7d81-a69a-5cf286d8089e/insights-work-brief.html`.
Its edited summary and screenshot-derived examples are not production data.
The previous single reading-surface Card is replaced with an unboxed short
summary followed by peer topic Cards, approximately 1,040px overall with the
shared 20px gap. Below 700px of actual App content width the cards stack.
The old reading-surface overlay and attention-side-column styles are removed.

Insights previously had status kinds but no content grouping. Its publication
entry now normalizes optional topic and topicType values once. The Agent
identifies engineering/research/general from the supplied work evidence;
projectBrief owns the grouping. Engineering and research entries each form a
single category, even when the Agent names narrower subtopics. Other named
and unclassified findings retain neutral groups. No title keyword matching,
array splitting or silent item loss is used. Legacy publications retain their
findings in a neutral group; original records are not rewritten.

Shared CardHeader gains blue/apricot content tones; neutral Card bodies keep
primary text readable. Shared Button gains a link variant for teal source and
continuation actions. Hover, keyboard focus and disabled behavior remain in
the public component. Status remains separate: needs_you and actual risks
use warning, while reported completion and unreviewed findings use neutral
badges rather than implying scientific acceptance. Base page/sidebar/text/
muted/border colors match the reference's corresponding shared palette;
content header tones use the design system's paired blue/apricot tokens.
No prototype hex values or competing control skins are copied into Insights.
Token contrast calculations in both themes: body text >=14.62:1, muted text
>=5.49:1, topic header text >=6.25:1, link text >=5.34:1, action text >=4.79:1
and focus against the neutral surface >=4.79:1. Decorative card separators
are not asserted as meaningful control boundaries.

Verification uses source 61faa581 plus this follow-up. Six model tests and
15 Insights browser scenarios pass, including explicit grouping, missing or
unknown categories, decisions outside topic cards, retained original
publications, side-by-side wide cards, 420px dark/24px stacked content,
recovery failures and frozen discussion references. npm run check passes.
Browser fixture captures in `test-results/insights-topics-fixture/` are
separate from the actual Native captures in
`test-results/insights-topics-native/`.

A real generation, `app:insights:insights-1793946930926`, completed and supplied
eight findings: three engineering and five research. The actual macOS Native
Preview restored all eight into two peer cards. Both light/dark wide views,
hover on the evidence control, a visible keyboard focus ring on a teal source
button (Tab from the evidence control), evidence expansion and long paper names were
visually inspected. At the default 1440px window with the actual 640px shared
chat pane, App content narrows to about 583px and the cards stack; the bottom
of engineering and start of research were observed together. The same real
brief was also inspected with UI size 24 in dark mode. The shared Composer
received a natural question and frozen Work brief attachment; the test draft
was cleared without sending. Original light theme and UI size 14 were restored.
Native images include wide-light-final.jpg, wide-dark.jpg, evidence.jpg,
stacked-topics-dark.jpg, narrow-dark24.jpg, keyboard-focus.jpg and discussion.jpg. These images
are local evidence, not committed files or signed-package acceptance.

### Regeneration action polish

The top-level outlined Regenerate text button competed with the reading
content. Existing briefs now use the shared ghost IconButton and refresh
icon, with the same accessible name and native hover title. Initial generation
keeps its labeled primary action. Busy/disabled admission, retained-content
status, retries and paused-session recovery retain their existing owners.
Native Preview visibly shows the compact refresh icon in the page header;
`test-results/insights-topics-native/refresh-action.jpg` records the actual
saved brief. All 15 existing Insights browser scenarios and npm run check pass,
including regeneration busy admission and retained results on failure.
