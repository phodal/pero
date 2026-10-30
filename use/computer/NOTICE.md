# Computer Use native driver

Pero builds the macOS window backend from the Point source revision recorded
in `SOURCE.json` (distributed as `bin/computer-source.json`). Source:
https://github.com/phodal/point/tree/a1b9150059a8858bac68497e6789e2b7cac8b08c/computer

Point's computer workspace declares the MIT license. Copyright belongs to
Point's contributors. The build extracts only the pinned computer workspace;
it does not include the Point application, configuration, or approval system.
Pero owns its contracts, selected-conversation authority, settings, receipts,
evidence storage, MCP transport, process lifecycle, and the in-process
ScreenCaptureKit bridge used on macOS 14+.

`npm run build:computer` fetches that exact revision into ignored `target/`.
For offline development set `PERO_POINT_SOURCE` to a checkout containing that
commit. No local machine path is required by a distribution. The only staging
adaptation explicitly associates each upstream crate with its own workspace.

The native helper currently requires macOS 13 or newer. Other platforms return unsupported
and disable input controls. Screen capture and Accessibility permissions belong
to the application responsible for launching the helper. The app must be
granted both permissions in macOS System Settings; refresh after changing them.

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
