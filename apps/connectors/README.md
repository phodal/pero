# Connectors

A Pero Workbench App for provider search, MCP configuration/import, credential
references, OAuth, connection tests and explicit tool selection. The interface
is adapted from Point at `b45190a3db725953128b4a8a40e95a287aa9bfd7`.

Open **Apps → Connectors → Open**. Configuration and encrypted secrets live
beside the current workbench runtime settings under `connectors/`; they are not
stored in the App iframe. New conversations receive the current enabled tool
grants. Changing configuration fences earlier conversation snapshots.

From the repository root:

```sh
npm run build:connectors
node scripts/build/apps.mjs --app connectors
npm run build:host
npm run build:desktop
npm run test:connectors
npm run test:connectors:e2e
```

The E2E check also needs the current workbench Wasm/Web build. Theme and language
come from the App SDK. Try it composes a draft in the shared conversation.

Runtime ownership, migration scope and verification gaps:
[ADR 0025](../../docs/adr/0025-connectors-app.md) and
[verification](../../docs/fitness/connectors.md).
