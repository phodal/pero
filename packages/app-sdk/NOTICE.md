# Code surface provenance

CodeViewer, CodeEditor, CodeCompare and their mapping logic were adapted from
Point's `packages/app-platform/app-sdk/src/components` at revision `872cbf87d`.
Point declares its App SDK under Apache-2.0; the license text is in LICENSE-POINT.
The port changes theme tokens, wrapper styles and mapped comparison layout to
Pero's existing Split component. It imports no Point Host, SDK runtime or server.

CodeMirror and Lezer remain pinned npm dependencies with their own license notices.
