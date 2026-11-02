# Code surface provenance

CodeViewer, CodeEditor, CodeCompare, CommandLine and their mapping logic were adapted from
Point's `packages/app-platform/app-sdk/src/components` at revision `872cbf87d`.
Point declares its App SDK under Apache-2.0; the license text is in LICENSE-POINT.
The port changes theme tokens, wrapper styles and mapped comparison layout to
Pero's existing Split component. It imports no Point Host, SDK runtime or server.

CodeMirror and Lezer remain pinned npm dependencies with their own license notices.

# Full SDK parity provenance

Design tokens, UI components and subsequent SDK ports use Point revision
d95f9118e291819a99fa62595a73c375f7bb64cf (Apache-2.0). Pure App SDK source is
ported into Pero with its own theme namespace and Host composition. This does
not include Point's runtime. Radix, React Aria, TanStack Table and Lucide remain
pinned npm dependencies under their respective licenses.
