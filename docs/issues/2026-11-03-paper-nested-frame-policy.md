---
kind: issue
status: resolved
---

# Paper HTML reader rejected by Desktop frame policy

CI run 41576148821 displayed “Paper frame is unavailable” and the legacy error
fallback instead of the nested HTML reader. DesktopApps served the new bundled
`_paper-reader/frame.html` with `frame-ancestors pero://workbench`. The real
ancestor chain also includes `pero-app://paper-agent`, so the browser rejected
the frame. Only the existing PDF `_reader/reader.html` had the same-app exception.

The exact resolved `_paper-reader/frame.html` asset now permits its own App
ancestor, only when served as paper-agent. This asset is copied from the trusted
reader package into Paper's build output by scripts/build/apps.mjs and resolved
within the Host-provided App asset directory. Other Apps, lookalike files, nested
paths, and ordinary App HTML retain the previous workbench-only ancestor policy.
The reader iframe remains script-disabled; its sandbox and declared external
frame origins are unchanged.

The existing DesktopApps response test exercises real temporary files and the
Host resolve protocol. It reproduced the missing same-app ancestor before the
fix, then passed all 12 App/path combinations after it. The frame-policy,
reproduction-approval and research-asset suites pass (15 tests). This is transport
policy verification, not a browser rerun; visual and nested-frame E2E verification
remain required on the repaired commit.
