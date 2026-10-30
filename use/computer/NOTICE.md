# Computer Use native driver

Pero includes the Point native dependency closure as tracked Rust source in
`vendor/point/`. `SOURCE.json` records its exact upstream revision, selected
crates and local adaptations, and is distributed as `bin/computer-source.json`.
Source: https://github.com/phodal/point/tree/a1b9150059a8858bac68497e6789e2b7cac8b08c/computer

Point's computer workspace declares the MIT license. Copyright belongs to
Point's contributors; the license text is reproduced below. The vendored copy
retains upstream source comments and compatibility types. It does not include
the Point application, service, CLI, or runtime configuration. Pero owns its
public contracts, selected-conversation authority, settings, receipts, evidence
storage, MCP transport, process lifecycle, Linux X11 adapter, and the in-process
ScreenCaptureKit bridge used on macOS 14+.

`npm run build:computer` compiles the checked-in sources. It needs no Point
credentials, checkout, Git fetch, or extracted-source cache. Cargo still obtains
public registry dependencies using `use/computer/Cargo.lock`. Local source
adaptations are documented in `vendor/point/README.md`.

The helper supports macOS 13+, Windows and Linux X11, with different observation
and input capabilities; see `use/README.md`. Pure Wayland is unsupported.
On macOS, Screen Recording and Accessibility permissions belong to the
application responsible for launching the helper. Grant both in System
Settings, then refresh after changing permissions.

## MIT license

Copyright (c) Point contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
