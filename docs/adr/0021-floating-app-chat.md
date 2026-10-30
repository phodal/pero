# Compact App Chat presentation

Status: proposed, 2026-10-30. Extends [ADR 0012](0012-shared-gpui-app-chat.md)
and [ADR 0013](0013-workspace-content-tabs.md). Implementation and acceptance
are recorded separately; this decision does not assert that a floating surface
or an App-owned slot has been delivered.

## Context

An App can already open the Host-owned conversation and add text or frozen
context to its draft. In the Workbench that conversation uses the shared Chat
dock: it reserves a column, and at narrow widths replaces the visible App while
retaining its iframe. A person often needs a short question while continuing to
work with the App. Point's compact App Chat demonstrates a useful progression
from a small entry to an input and then a transcript, while retaining a single
Host conversation. Pero's App is a cross-origin iframe and its Workbench Chat is
GPUI, so Point's same-document React portal is not a transport for Pero.

## Decision

Add a compact presentation for the active App in the Workbench and in Products
that enable Chat, using the existing `ChatPanel`, `AppChatScope { app, panel }`,
Composer and Host session. The intended presentation has three user-visible
states; the first implementation and its verification determine which are
delivered:

- **Collapsed:** a small entry reopens Chat. Running, permission-request and
  error states must remain discoverable when the transcript is hidden.
- **Composer:** a compact input allows a question and its draft references to be
  reviewed while the App remains visible.
- **Conversation:** the transcript and Composer are visible together, with
  existing cancellation, permission and tool-result controls available.

The user can collapse and reopen the same conversation; presentation changes do
not cancel work, send a prompt or clear its draft. A submitted prompt reveals the
conversation so its progress can be followed. Existing App SDK `open` and
`compose` requests reveal the appropriate App scope; `compose` still only fills
the draft, including frozen references. The user submits through the shared
Composer. Switching App scopes retains each scope's selected session and draft.
The Workbench's existing dock remains available when a larger view is useful;
the standalone Product uses an expanded floating conversation.

Each shell owns presentation and derives App identity from the managed iframe.
Host remains the owner of ACP sessions, authorization,
history, cancellation and execution. An App Chat scope is an association, not
an App Use, file or execution grant; ACP permission requests continue through
the existing Chat approval path. The App does not acquire a Host handle or a
second conversation backend. No new approval queue is introduced.

### Surface boundary and scope

The App iframe is mounted by the Web shell above the GPUI canvas. Before choosing
the floating surface implementation, verify actual paint order, clipping, focus,
pointer and keyboard input in Electron. The solution must retain the App document
and make both App and Chat interactive in their visible regions. A visually
overlapping GPUI element hidden behind the iframe is not an implementation.
Respect existing overlays and App Use visibility checks, and do not claim an
unobstructed App region where Chat covers it.

The first implementation targets both the Workbench App surface and Products
that enable Chat. The Product shell retains its existing separately instantiated
chat-only Wasm; it shares component implementation, not a live GPUI entity, with
the Workbench. Native GPUI preview has no equivalent HTML App surface. No
additional Wasm instance or chat backend is required for the Workbench.

### App layout slot

An App may reserve a region for its scoped conversation through the SDK's
`AppConversation`. The iframe reports its local rectangle; the trusted parent
derives the App and panel from the sending managed iframe, checks the rectangle
against that frame and the window, and places the existing conversation there.
The App displays a fallback until the parent accepts the slot. Moving, hiding or
removing the region releases or updates its presentation without deleting the
session, clearing a draft or sending a prompt. A Workbench slot uses the same
GPUI ChatPanel; a Product moves its existing chat-only iframe.

The first slot binds the current App/panel scope, not an arbitrary Session or
Project chosen by App code. The Workbench supports it only in a single-pane App;
unsupported or unavailable surfaces keep the fallback. App Use observes the
same covered-surface rules as floating Chat. Layout, clipping, scrolling, focus,
capture and theme behavior require actual Desktop verification, separate from
provider and packaged release acceptance.

## Verification

Pure state/layout checks should cover transitions and preservation of scope and
draft; shell checks should exercise the actual GPUI/iframe boundary. In real
Electron, verify the entry, input, transcript, collapse during a running turn,
permission and cancellation, switching Apps, context references, App interaction
outside the overlay, focus and keyboard/IME behavior, narrow windows and light /
dark themes. Inspect loading and error recovery as well as successful turns.
Fixture Agent results, real-provider execution, standalone Product, platform and
signed-package acceptance are distinct evidence. Record observed results and
remaining limits in the appropriate fitness record rather than updating this
decision to imply untested coverage.
