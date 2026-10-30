---
kind: issue
status: verifying
date: 2026-10-29
---

# Master build lockfiles

At master `8b55dd835587cc8c9fdbadba2eae3548f45fd032`, CI run
[40837327389](https://github.com/phodal/pero/actions/runs/40837327389) failed
the Linux and macOS frozen Bazel checks. Pages run
[40837327403](https://github.com/phodal/pero/actions/runs/40837327403) failed
before compiling the release workbench; its deployment job did not run.
Both failures were first diagnosed at `9549cfb`. The repair was then rebased
and revalidated against `8b55dd8`, preserving its concurrent local-worker work.
These failures are separate from the unmerged DSH work in PR #4.

## Causes and bounded correction

- `3002f03` added the composer and sidebar scripts to `package.json` after
  `bd15dd7` refreshed the rules_js input cache. Later local-worker scripts also
  changed that input. Script-only changes still invalidate the cache.
  Regenerate it with the pinned Bazel/pnpm toolchain;
  npm dependencies and the translated pnpm lock do not need upgrades.
- `scripts/lib/cargo.mjs` patches five GPUI packages to the external checkout
  pinned by the workflows at `ec89cfc36404667b7947aeb3d40b1c2859d729dd`.
  `Cargo.lock` instead identified those packages as registry crates. Cargo
  correctly refused to change their identities under `--locked`. Desktop CI's
  preceding unlocked contracts check masked the mismatch; Pages begins with
  the locked release build. Let Cargo resolve the existing pins and commit the
  path-package identities rather than add another unlocked build preparation.

The correction retains all dependency versions, the exact GPUI checkout,
`ASPECT_RULES_JS_FROZEN_PNPM_LOCK`, and the Wasm build's `--locked` argument.
No workflow, upload, or deployment configuration is changed.

## Verification

Both original lock failures were reproduced before regeneration: frozen Bazel
exited 48 and Cargo exited 101. On Linux after regeneration:

- `bazel run @npm//:sync` succeeded with the pinned Bazel 9.2.0 / pnpm 10.28.2;
  only the watched `package.json` hash changed. `pnpm-lock.yaml`,
  `package-lock.json`, and `MODULE.bazel.lock` are unchanged.
- `bazel test --config=ci //:checks`: all seven checks passed, without rewriting
  the committed locks. `bazel build //server/cmd/server` also passed.
- Full Cargo metadata resolution (without `--no-deps`) passed under `--locked`
  with stable and `nightly-2026-10-28`. All 844 package names, versions, and
  dependency lists are unchanged; only the five GPUI registry source/checksum
  pairs are removed.
- `npm test`: 73 Rust tests passed, with none failed or ignored. The same crate
  suites also passed with explicit `--locked`. `npm run test:contracts` passed;
  that existing suite exercises 30 of 45 declared Host event kinds.
- Go 1.26.4 `go -C server test -race ./...` passed. Database and external-service
  opt-in scenarios were not configured; this is not database acceptance.
- Under Node 22.23.4, `PERO_BUILD_RELEASE=1 npm run build:wasm` passed,
  including the pinned nightly `--locked --release` build, wasm-bindgen, and
  Binaryen 132 optimization. `npm run build:web` and `npm run check` passed.
- A local Pages directory assembled with the workflow's exclusions passed all
  original CNAME, required-file, Wasm-presence, and relative-asset checks. The
  optimized Wasm is 15,078,605 bytes, SHA-256
  `bbc3d35018910673d5d033b77130e119029815b401dde382f32871098607f9c4`.
  This Linux container used Python file copying in place of unavailable rsync;
  it did not perform the Pages service configuration check or artifact upload.

The final commands left both corrected lockfiles unchanged. The initial local
tool bootstrap required writable cache directories and the system Java trust
store; no repository gate or TLS verification was disabled.

Remote CI and Pages acceptance remain pending publication of the repair.
Local build verification does not upload artifacts or deploy the site.

## Integrated master follow-up (2026-10-29)

PR #20 standard CI run `40908701966` exposed two build failures also present
in incoming master `dc75f94`; the affected script and npm inputs are identical
on the integrated feature tree.

- Windows contracts preparation passed an absolute `D:` archive path to GNU
  tar, which interpreted the drive prefix as a remote host. Extract the pinned,
  checksum-verified crate by basename with the extraction directory as the
  process working directory. No GNU-only flag is needed for BSD tar.
- The frozen npm action-cache stamp is stale again after package-script changes.
  Regenerate it with the pinned Bazel/pnpm toolchain without changing dependency
  versions or weakening the frozen lock check.

Tar verification: GNU tar reproduced `Cannot connect to D: resolve failed`
with a colon-prefixed archive argument. Fresh production `prepareWebBackend()`
extraction and patch application passed in a temporary path containing spaces
and a colon; Linux `node scripts/cargo.mjs check -p pero-contracts` passed.
Native Windows execution remains a CI acceptance step, not a local claim.

The pinned sync added only the missing root importer for the already-declared
`@modelcontextprotocol/sdk` 1.32.2 (`zod` 4.6.7), plus its three input hashes.
Removing those three importer lines reproduces the prior pnpm lock byte for
byte: all package and snapshot entries are unchanged. `package.json`,
`package-lock.json`, and `MODULE.bazel.lock` are byte-identical to the integrated
head. The original frozen check failed before sync; afterward
`bazel test --config=ci //:checks` executed all seven checks successfully, with
no lock rewrite. The sync used writable XDG data/cache paths in this container.

## Patch checkout byte contract (2026-10-29)

Windows run `40924600214` reached pinned GPUI patch application but rejected
line 6 as corrupt. The canonical LF patch parses and applies to the pinned
crate; converting its bytes to CRLF reproduces that exact parser failure.
The patch contains blank context lines accepted as LF but not as CRLF.

A targeted `patches/*.patch text eol=lf` attribute now fixes patch bytes at
checkout, independently of Git's Windows `core.autocrlf` default. The patch,
crate checksum and patch digest algorithm are unchanged. A real temporary Git
index checkout test reproduces the CRLF failure without the attribute and
verifies exact canonical bytes and successful parsing with it. CI runs this
portable regression alongside the font-tool environment tests.

The existing post-checkout LF conversion succeeds in the Linux reproduction;
why it did not prevent the observed Windows failure has not been established.
Native Windows CI remains required to verify the explicit attribute repair.

## Integrated CI acceptance (2026-10-30)

Standard CI [40962596409](https://github.com/phodal/pero/actions/runs/40962596409)
passed all 16 jobs for head `26c371fad79ff6bb60ff32d7e3a383c9ba3e182f`,
testing merge `7beb3d9eeaf842eb2a899c1506ebf8bc37e2f15a`. Native Windows CI
completed the contracts preparation and patch checkout checks, closing the
Windows acceptance requirement above. Linux and macOS frozen Bazel generated
checks passed. Windows skips those Bazel generated checks under the existing
workflow condition and runs the npm checks instead; this is not a claim that
Windows executed the skipped gate. Desktop E2E ran on Linux only.

This tracker remains `verifying` because a new Pages workflow/deployment
acceptance has not been established. Standard CI success does not certify the
Pages service configuration, artifact upload or deployed site. Earlier pending
CI statements describe their historical checkpoints; the remaining acceptance
item is Pages, not the integrated Windows repair.

## Icon generated-byte portability (2026-10-30)

Standard CI [40992933908](https://github.com/phodal/pero/actions/runs/40992933908)
Windows job `123859362810` passed Build, TypeScript, locales and contracts but
failed the strict icon-generated `assets.rs` comparison. It tested merge
`1a67f59d3e4a570c0d1e90858929068ca606426c` against master `0847ddc`.
The icon generator, inputs and outputs are identical on the local PR tree and
that merge. The Linux strict icon check passes with Rust 1.99.1 / rustfmt 1.10.0.

A real Git checkout with `core.autocrlf=true` reproduces the same file-specific
failure: `assets.rs` acquires 405 CRLF line endings while generation emits LF.
However, the workflow's later `core.autocrlf=false; git checkout -- .` removes
those CRLFs in the Linux reproduction. Actual failing Windows file/stdout bytes
were not recorded, so this reproduces a portability defect, not a proven account
of why that workflow's conversion failed. Path ordering is not implicated by the
local reproduction. Native Windows CI acceptance remains required.

The bounded correction defines LF for the two generated icon outputs and the
two license files embedded verbatim in generated TSX, following the patch-byte
attribute precedent. The generator explicitly requests Unix newlines from
rustfmt; the strict comparison is unchanged. A mismatch now reports only numeric
lengths, CRLF counts and first differing code units, not file contents, so another
native failure can be diagnosed instead of inferred.

The existing checkout regression now also runs the production icon generator
against a minimal artwork catalog in a temporary Git index. It proves failure
without attributes, exact generation/check success with Windows checkout defaults
and a Windows formatter preference, and rejection of both CRLF drift and stale
content in each generated output. No CI gate, dependency pin or generated content
is changed.

## macOS Computer Use script cache (2026-10-30)

PR #51 added the macOS native acceptance command to `package.json`. Standard CI
[41004124147](https://github.com/phodal/pero/actions/runs/41004124147) failed the
Linux and macOS frozen Bazel checks before target analysis with exit 48: the
rules_js input cache still held the previous package.json hash. Native Computer
Use CI on all three operating systems passed independently. This is the same
script-only cache invalidation described above; no dependency upgrade is needed.

Regenerate the existing cache with the pinned Bazel/pnpm toolchain, then rerun the
frozen generated checks. Retain the lockfiles, dependency pins and freeze gate.

The pinned Bazel 9.2.0 `bazel run @npm//:sync` regenerated only the package.json
input hash. `pnpm-lock.yaml`, `package-lock.json` and `MODULE.bazel.lock` remain
byte-identical. `bazel test --config=ci //:checks` then passed all seven frozen
checks locally. Publication must rerun the remote frozen jobs; no gate was removed.

## Shared contracts and Computer Use lock (2026-10-30)

Reviewing the built-in Agent integration on master `034f36d2` reproduced a
`build:computer` failure under `--locked`. The standalone workspace's
`pero-contracts` entry lacked the reader dependencies already declared by the
shared crate. Resolve those existing manifest pins into `use/computer/Cargo.lock`,
retaining every previously locked package version. `npm run build:computer`
then passes with its original `--locked` flag on macOS arm64.

The pinned npm sync also fills the already-declared MCP Apps and zod importer
entries missing from the integrated pnpm lock, and refreshes the input cache
for the Harness build scripts. No existing package versions are upgraded.
`bazel run @npm//:sync` and all seven `bazel test --config=ci //:checks`
targets pass locally.
