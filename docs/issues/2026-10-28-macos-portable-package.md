---
kind: feature
status: implemented
---

# Portable macOS package below 100 MB

The local development bundle linked to the checkout and could not be moved to
another machine. Development Wasm, duplicate fonts and bundled Agent runtimes
also exceeded the requested download budget.

The portable package includes release Rust Host, optimized Wasm, Electron and ACP
JavaScript adapters. Codex and Claude native CLIs remain user-installed. Only
English and Simplified Chinese Electron locales are retained. Embedded catalog
fonts and the existing system canvas fallback replace full embedded CJK fonts;
unused duplicate public font binaries are omitted.

The budget is strictly less than 100,000,000 bytes for the DMG. Installed App size
is recorded separately. The package is ad-hoc signed, not notarized.

Packaging exposed two concrete launch problems: Binaryen's all-features option
introduced compact imports unsupported by the shipped Electron, and an executable
still named Electron made the app report development mode. The optimizer now
preserves the input's target features and the executable/plist use Pero.

The fixture also needs to wait for bootstrap completion before native input.
macOS credential prompts blocked automation; Electron's test-only mock-keychain
switch is used only in the isolated, credential-free conversation suite. Normal
App startup retains OS credential protection. Real packaged keychain persistence
and real packaged OAuth return remain separate acceptance gates.

Verification and artifact sizes: [macOS package verification](../fitness/macos-package.md).
