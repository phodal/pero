# Pero App SDK

A small iframe-local React SDK. `AppProvider` receives the parent-owned locale,
theme and visibility context; `useAppApi` calls only this App's `/api/*` origin.
Desktop proxies those calls to the Host-supervised backend without publishing
the backend token to the frame. This SDK does not grant filesystem, shell,
Agent or Project access.

`ui` exposes native accessible controls for the first App; tabs support arrow,
Home and End navigation. `chart` uses Pero's DESIGN.md palette. Every frame
bundles its own React runtime, so no React instance is shared with GPUI Wasm.

The frame announces `{type:'pero:app:ready'}` to its parent. The parent replies
with `{type:'pero:app:context',context:{locale,dark,active}}`. The provider accepts
only messages from its parent and validates the three fields. There are no
App-controlled credentials, host paths or Session bindings in this message.

`useAppChat().open()` opens the host-owned Chat panel when the product enables
Chat. `useAppChat().compose(text)` opens it and inserts text into its draft;
the user still sends the message. These requests use the managed iframe's App
identity and do not expose session commands or Agent credentials to the App.

`useAppObject()` declares the state and actions that an Agent can use through
`app_use`. Declare the same state and handlers that the UI uses; the SDK keeps
an object revision and calls the latest handler after validating its parameters.
For example:

```tsx
useAppObject({
  id: 'experiment', kind: 'experiment-view', label: 'Experiment',
  state: { view },
  actions: { select_view: {
    description: 'Select a science view',
    parameters: { type: 'object', properties: { view: { type: 'string', enum: ['cells', 'volume'] } }, required: ['view'], additionalProperties: false },
    run: ({ view }) => setView(view as string),
  } },
});
// Spread this onto the DOM element that renders the object.
<section {...appObjectProps('experiment')}>…</section>
```

The host exposes only the calling conversation's App scope. `app_use` starts a
task with a fixed action set before observing, capturing or operating a
panel. Approval belongs to the calling Agent's session policy. Automatic/full
access executes directly; an Agent permission request still appears in Chat.
Desktop adds no second approval. A standing session grant covers reading only. Hidden retained panels can be read but cannot be operated or captured,
and direct user input takes priority. DOM fallback uses references from the most
recent observation; semantic actions use the observed object revision.

An action reports `not-run` for verification. `verify` checks one declared state,
DOM or visual condition separately; a screenshot is evidence rather than a
scientific acceptance result. `wait` observes a condition, `runPlan` runs bounded
steps, and `stop` releases the task. This channel does not execute arbitrary
scripts, grant filesystem access or change a domain result's acceptance status.

App references and captures can be added to the draft without submitting it:

```tsx
const chat = useAppChat();
await chat.compose('Review the selection', {
  attachments: [chat.objectReference('experiment', { selected: ['condition-A'] })],
});
await chat.open({ capture: true });
```

`open` and `compose` return a Promise with the destination thread and inserted
reference IDs. The default mode appends; `mode: 'replace'` replaces the draft.
An object reference includes its revision and optional JSON selection (4 KiB).
The Desktop freezes its state and refuses a stale revision. The Composer exposes
Preview and Remove; the image preview can add regions and a note. These describe
the original pixels without modifying the image hash. An asynchronous response
returns to the original draft even if another conversation has been selected.

An App-requested capture adds frozen context to the draft without another question. The trusted parent also provides a
human “Capture to chat” control for every App. Both crop to the managed frame
and keep image, App metadata and receipt together. Drafts may hold images before
a provider connects; an unsupported provider preserves the draft with an error.

For an explicit conversation attachment, declare a semantic action parameter as
`{ type: 'string', format: 'pero-file-ref' }`. The Agent supplies a `sha256:…`
reference from `inventory.fileReferences`. Desktop substitutes a temporary
`/host/inputs/…` URL; the action can fetch it on its own App origin. The grant is
bound to the conversation, App and active task. Task stop, selection change,
expiry or revocation prevents subsequent reads. Paths and arbitrary URLs cannot
be substituted for a conversation file reference. Original bytes are retained.

Persistent document writes use `contributes.writes` in `app.json`, for example:

```json
{
  "name": "import-results",
  "description": "Save a supplied result document",
  "path": "/api/results",
  "schema": {
    "type": "object",
    "properties": { "title": { "type": "string", "maxLength": 1000 } },
    "required": ["title"],
    "additionalProperties": false
  }
}
```

This declaration requires an App backend. `app_describe` exposes the enabled
App's tool name, description and schema; `app_write` takes only `app`, `tool` and
`document`. Desktop validates and freezes the document, then POSTs through the installed
private backend route after the Agent policy allows the tool call. It adds no
separate approval. Changing or disabling the route before execution invalidates
the prepared write.
Use `useAppDataChanged(() => refresh().catch(onError))` to refresh after a write.
The backend remains the owner of domain validation and acceptance.

The Host bundles `/app-use` as a Composer skill and supplies the same workflow
to HTTP-MCP-capable Agents. Tasks survive turn boundaries within their lease;
cancel, stop, conversation switch and per-App Revoke end active authority.
