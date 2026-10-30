---
kind: issue
status: resolved
---

# Patched GPUI dependencies inherit the Pero workspace

After integrating the current master, `npm test`, `build:host` and
`build:wasm` fail while loading the patched `gpui-base` manifest:
`workspace.dependencies.anyhow` is missing.

The source-addressed Kit copy lives under Pero's `target/`. Cargo treats these
path dependencies as members of the enclosing Pero workspace rather than
using the Kit workspace, which owns the inherited dependency declarations.

Exclude the generated `target` directory from the Pero workspace. The cache
retains its own workspace and no upstream checkout needs modification.
`npm test`, `npm run build:host` and `npm run build:wasm` pass with this
exclusion.
