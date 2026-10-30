# Workspace content tabs and shared Chat

Status: implemented in source, 2026-10-29. Extends ADRs 0001, 0007 and 0012.
Verification and remaining limits are recorded in
[Workspace architecture acceptance](../fitness/workspace-architecture.md).

## Context

The Workbench already renders navigation in GPUI and domain Apps in retained
HTML iframes. Switching full-page routes makes it difficult to move between a
conversation, its Project, a Task and an App without losing the visible work
context. The first improvement is one content area with named open items and
one shared Chat panel; it does not require another renderer or execution owner.

## Decision

`WorkspaceItem` identifies content by its source object: `Conversation` by
thread ID, `Project` by Project key, `Task` by Task ID, `App` by App and panel
names, and `Document` by its originating conversation and immutable source ID. Titles and icons are presentation derived from those source objects.
An App item does not relax the current one-panel App manifest contract.

A result document uses the shared `ContentDocument` contract and `ContentReader`
component rather than a second editor implementation. Its workspace view fills
the content slot and retains reading state while other items are selected.
Inline and workspace presentations share source text but own independent
selection and query state. Source revisions update retained views at the event
boundary; rendering does not perform source reconciliation. Closing a document
removes that presentation without deleting its conversation or result. Deleting
the source conversation removes its unavailable document items. Document layout
uses the existing shared Chat dock policy, and a document route hides retained
App surfaces through the same layout rule. Actual code-result acceptance is in
[Workspace document views](../fitness/workspace-documents.md).

`WorkspaceNavigation` owns the open-item list and one `WorkspaceRoute`:
`Page(WorkbenchPage)` for a page, or `Content(WorkspaceItem)` for a source object.
`WorkbenchPage` names Conversation, Projects, Agents, Tasks, Workers, Apps,
Insights, Connections and Settings. `ConversationTab` names Chat and Logs.
Legacy numeric page and tab values are converted only at the diagnostic
boundary; they do not drive navigation or layout.

Opening an already-open item activates it without duplication. Selecting an
absent item does not open it. Closing the active item selects its right neighbor,
or its left neighbor when it was the last item. Closing the final App returns to
the App library; closing the final other item returns to Projects. Source
reconciliation removes unavailable objects without opening new items or changing
the remaining order, and leaves a visible page alone when only background tabs
are removed.

Core transitions return the changed route, if any. UI actions and Host events
use that value to activate the selected source, focus its conversation or issue
the existing Host command. Rendering reads the route and produces presentation;
it does not reconcile sources, open content or repeat business activation.
Project aliases acquired during repository discovery are replaced by canonical
identities in the open list and route, with duplicates merged. This source
identity correction does not activate the same Project again. A history replay
preserves an explicitly opened Conversation; only an empty Conversation page
adopts the restored history selection.

`AppCatalog` owns installed App metadata and catalog presentation state. It does
not own an active App or a second content selection. App identity comes from the
navigation route. The existing `RemoteAdapter` remains the owner of remote Task
requests and transport selection, including publishing the requested Task with
its loading state. Workbench route selection is a separate UI concern. Ordinary
polling refreshes the remote snapshot without selecting a Workbench route;
explicit navigation and Task actions use the action/event path above.
The Apps navigation entry always opens the library. An already-open App is
restored from its content tab, retaining the same iframe document.

A tab is a view. Closing it does not delete a conversation, cancel a running
session or Task, uninstall an App, or stop an App backend. Those actions retain
their existing explicit controls and owners. App iframe documents remain in
the existing surface cache across view switches and tab closure; disabling or
uninstalling the App, or disconnecting the Host, performs the existing cleanup.
Open tabs and selection are current-window state in this slice, not a new
durable session store.

The Workbench has one center content area and a global shared Chat panel. The
existing `pero-chat-ui::ChatPanel` owns Composer and conversation presentation;
the Host continues to own ACP sessions, history, permissions and cancellation.
Conversation content uses the same shared panel rather than creating a second
conversation implementation. App-scoped conversation selection continues to
use `AppChatScope`; displaying an App does not grant its tools or file access.

`LayoutPreferences` belongs to `WorkbenchPreferences` in `pero-contracts`.
It carries the preferred Chat width and whether the panel is open. Width is an
integer from 320 to 640 pixels, initially 420; the panel is initially closed.
Dragging is bounded by this domain type. The current viewport can display a
smaller area or switch to a narrow-window layout without overwriting the
preferred width. Appearance and layout use the existing
`settings.workbench` / `settings.workbench.get` path and Host-owned runtime
settings file. An omitted layout in older settings or requests restores these
defaults; no renderer-local preference store is added.

`WorkspaceLayout` is a pure value computed from viewport width, route,
conversation tab, saved layout preferences and whether an overlay covers the
content. It owns sidebar sizing, narrow-window behavior, Chat placement and
effective dock width, and App surface visibility. Chat visibility checks use
the same placement rule. The renderer computes this value once per render;
it does not change saved preferences to fit the viewport.

Apps continue to render through the existing `pero-app://` iframe surface. GPUI
measures the content slot's actual bounds during prepaint; the Web shell mounts
and retains the document. The surface combines those bounds with the computed
layout visibility, rather than guessing coordinates or repeating route and
breakpoint rules. The iframe paints above the GPUI canvas, so settings overlays
and Chat resizing hide the surface while retaining its document. This change
does not turn an iframe into a native GPUI element or extend the native
developer preview with a WebView.

An external Browser content type, arbitrary URL navigation, Electron
`WebContentsView`, freely split panes, tab dragging and persisted workspace
restoration are outside this implementation slice. The existing App lifecycle
and Host execution authorities remain the integration boundaries for future
work.

## Verification

Core tests cover navigation transitions and source reconciliation, pure layout
choices, and saved-layout admission and resize rules. The runtime settings test
covers migration from settings without layout and restoration of the saved
layout while preserving other preferences. Generated Host contracts describe
the bounded width and optional legacy layout field.

Compilation and these tests do not establish Desktop acceptance. Runtime
verification must exercise content switching, closing and reopening views,
retained App state, shared Chat, resize and restart, keyboard focus and IME,
overlays, and narrow and light/dark layouts in the assembled Electron app.
Native preview behavior and signed-package acceptance remain separate evidence.
The existing [Workspace acceptance](../fitness/workspace.md) records the first
content-tab slice; the [architecture acceptance record](../fitness/workspace-architecture.md)
tracks this navigation and layout refactor separately.
