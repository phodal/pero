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
