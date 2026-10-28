# Scripts

Repository toolchain. Run these through the npm scripts in the root `package.json`. A script that belongs to one package stays next to that package (`pages/scripts/`).

## Layout

| Directory | Role |
| --- | --- |
| `lib/` | Helpers imported by other scripts. Not a command. |
| `cargo.mjs` | Cargo entry with the gpui-kit path patch. |
| `build/` | Build outputs such as wasm and the desktop bundle. |
| `codegen/` | Committed generated files. Each script accepts `--check`. |
| `check/` | Read-only gates. They do not write files. |

`npm run check` runs theme, locale, and contract checks. Regenerate diagrams with `npm run gen:architecture` and `npm run gen:overview`.

Regenerate the README domain composition diagram with `node scripts/codegen/building-blocks.mjs`; append `--check` to verify the SVG is current.

## Where a new script goes

1. Used by one package only → beside that package.
2. Imported by two or more scripts → `lib/`.
3. Writes build output (`dist`, wasm, `target`) → `build/`.
4. Writes a committed artifact and supports `--check` → `codegen/`.
5. Asserts and does not write → `check/`.

Do not add `utils/`, `helpers/`, or `misc/`. Delete one-off debug scripts instead of checking them in. An npm script that only forwards to a workspace does not need its own file.
