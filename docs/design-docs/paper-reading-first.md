# Paper Agent: reading first

The paper is the default workspace. Research is an optional conversation beside
it. This implements the user's 2026-10-29 brief and reference image in the
existing App, without changing saved papers, inputs, reports or annotations.

`WorkspaceScreen` distinguishes the library from reading. `LibraryScreen` owns
import and discovery. `QuestionDraft` holds the unsent question and selected
passage. Existing frozen research inputs and reports remain the persisted turns;
there is no parallel chat database or new execution engine.

## Reading

Opening a paper hides the library. Its PDF is downloaded/cached through the
existing backend and opened with EmbedPDF/PDFium. The single top bar contains
Back, title, page controls, zoom and Ask. Text-only sources retain the existing
scientific renderer; failed PDF downloads expose retry and text fallback.

The PDF navigation is portalled into that bar from the live viewer. Opening or
closing Ask retains the viewer rather than remounting it, and fixes its current
numeric zoom before changing the available width. Selection, page and scroll
remain owned by EmbedPDF. Citation navigation within the same document uses its
existing scroll capability; another saved version still opens by document ID.

Selection reveals highlight/note and discussion actions. The PDF context menu
(right-click or Shift+F10) provides region capture, annotations, page text and
text view. Saved images retain native clipboard/download and matrix actions.
These secondary operations are absent from the default top bar.

## Research

Ask opens a conversation with a bottom composer. Existing inputs/reports are
shown as expandable previous turns for the current paper. New validated reports,
matrices and experiment records appear inline. Export belongs to each answer.
Research settings are available only through their explicit control; invalid
Agent output exposes repair without hiding the validation error.

Selected text can be attached to the next question. Each submitted question
still creates its own bounded, frozen research run through the existing Host
Agent boundary. Opening history never restarts an Agent. This redesign does not
add an unbounded autonomous session or implicitly reuse prior answers as facts.

PDF citations resolve against the frozen input's document ID, passage and exact
quote, then navigate/highlight in the still-visible PDF. Text citations retain
the source-context panel inside the conversation. Missing evidence and scientific
acceptance remain explicit.

## Navigation and accessibility

Back opens the full library, where importing, local search, discovery and saved
papers live. Discovery's Compare action selects its seed and candidate and opens
the existing research flow. No permanent Papers/Saved/Reports or document tabs
remain in reading mode.

Cmd/Ctrl+J toggles Ask. Escape closes citation/settings before the Agent and
restores focus; Alt+Left returns to the library. At widths of 760px and below,
the Agent overlays the document, keeps its controls inert and contains keyboard
focus. Closing it restores the same viewer. No animation is required.

Use the existing theme and teal action tokens with neutral App surfaces, system
fonts, 12/14/18/24px sizing and restrained separators. The PDF's own typography
and colors are source content and remain unchanged.
