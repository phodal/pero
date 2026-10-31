---
kind: issue
status: resolved
---

# Paper Ask bypasses the shared conversation

Paper retained a React conversation, composer, Agent picker and Host-turn polling
alongside the shared GPUI ChatPanel. Sharing input chrome did not share the
conversation. Native additionally rejected App object attachments and supplied
no App data MCP endpoint, so replacing the UI alone would break research there.

The Host conversation owns input, messages, provider settings, permission and
cancellation. Paper owns frozen sources, study observations, exact quotations,
reports and the reading matrix. Paper now hands typed selection references to
`useAppChat`, exposes preparation/continuation/report submission as installed App
write declarations, and renders persisted research records separately. No App
starts an Agent or parses the closing chat message into a report.

Both shells use the existing AppUse MCP authority and AppWriteRoutes boundary.
Native injects its selected-draft/semantic observation ports, and routes private
requests over its existing stdio composition. It does not expose general native
UI operation or capture. Report provenance records App tool submission rather
than inventing a Host session ID from a domain request ID. Existing records stay
readable.

Verification is recorded after running the desktop and native journeys. Model
quality, signed builds and scientific acceptance require separate evidence.

## Verification

2026-10-31, macOS arm64 development working tree based on `9af37ba4`, with
concurrent unrelated workspace changes preserved:

- Paper TypeScript, App build, Wasm/Web/Desktop builds and root checks pass.
- 35 Python tests, 32 shared Chat/Workbench Rust tests and 15 MCP/context/goal
  tests pass. Native feature build passes with existing unused-code warnings.
- `npm run test:paper`: 16 Desktop groups pass, zero unexpected browser errors.
  Covers shared preparation/report tools, invalid quotation rejection, global
  cancellation, exact PDF highlights, matrix/export, themes and restart.
- `paper-harness.mjs` with the explicit synthetic two-page PDF: four groups pass,
  including same-conversation follow-up, matrix revisions and cancelled-study
  restart/continuation without rereading observed evidence. App Agent starts: 0.
- `native-paper-chat.mjs`: three checks pass in an actual native window with a
  fixture ACP Agent. Frozen App references reach shared Chat without sending;
  the same Host conversation discovers tools and saves one validated report.
  Native probe needs a visible/focused window because GPUI applies draft
  insertions while rendering; this changes acceptance mode only.

Evidence: `test-results/paper-agent/result.json`,
`test-results/paper-study/shared-chat/result.json`,
`test-results/native-paper-chat/result.json` and adjacent PNGs/logs. Provider
responses and paper contents are labelled fixtures. No real-provider answer,
publication PDF, signed package or scientific acceptance is claimed here.

Opening a remembered closed App conversation now creates an editable scoped
draft in shared Chat; old history is retained. This is necessary for explicit
continuation after restart and is verified by the study journey. Search Enter
submission also avoids the App sandbox's blocked native form submission path.
