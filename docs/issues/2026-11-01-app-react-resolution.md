---
kind: issue
status: resolved
date: 2026-11-01
github_issue: 49
github_state: closed
github_url: https://github.com/phodal/pero/issues/49
---

# App-owned React resolution

## Cause and bounded fix

The generic App builder bundles shared SDK source outside an App's dependency
ancestry. esbuild's `nodePaths` is a fallback, so an ancestor checkout's React
can win for the SDK while the App imports its own React. Separate module
identity breaks hooks even when both installed versions are identical.

Resolve only `react`, `react-dom`, and their subpaths from the App directory.
Use esbuild's normal package resolver rather than absolute directory aliases:
those aliases bypass package export conditions and make `react-dom/server`
select Node code in a browser bundle. Other packages and the Workbench builder
are unchanged. The resolver terminates when its resolve directory is the App.

## Verification (2026-11-01, Linux, Node 24.22.1)

- New isolated regression invokes the actual builder with copied real React
  19.2.8, React DOM and scheduler packages. Without the fix, the ordinary case
  passes and the ancestor-installation case fails on SDK/App React identity.
- With the fix, both cases pass. Assertions cover App-owned React identity,
  JSX runtime and JSX development runtime module objects, React DOM and client
  functions, automatic JSX, and a shared component's `useState` during browser
  server rendering. This also exercises browser package export conditions.
- Both generated bundles execute again after builtin distribution staging and
  deletion of source and dependencies. This checks the portable JS payload,
  not a signed Desktop installation.
- `node --test scripts/build/apps.test.mjs`: 2 pass, none skipped.
- `npm run test:product`: 9 pass (includes ordinary Workbench payload tests).
- `npm run typecheck --prefix apps/paper-agent`: pass.
- Real Paper UI bundle: `node scripts/build/apps.mjs --app paper-agent
  --reader-dist <fixture-directory>`: pass. The supplied reader directory
  is a temporary self-authored reader fixture; the Rust/Wasm reader was not rebuilt or certified.
- The regression is wired into the Linux core CI job immediately after frozen
  Paper dependencies are installed. Remote CI has not run for this local patch.

GitHub closed #49 completed on 2026-11-01.

No dependency upgrades, backend changes, paid providers or external writes.
Browser/Electron/native window behavior, macOS/Windows, signed packaging and
full Reader/Host builds remain unverified; the executable runtime regression
is not a claim of those acceptance levels.
