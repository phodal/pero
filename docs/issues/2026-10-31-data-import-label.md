---
kind: incident
status: active
date: 2026-10-31
---

# Data import type needs an unambiguous accessible name

The hosted embedded and standalone smokes for `2e6018d` opened the real Data
App and Import dialog, but could not resolve the exact `Type` control label.
The wrapping label also contained the select options. The select now declares
the same short accessible name as its visible label; the original exact-label
tests remain unchanged. No timeout or iframe permission was relaxed.

TypeScript and UI checks pass. The follow-up exact-head hosted run must confirm
file import and restart behavior in both entry modes. The preliminary failure
screenshots establish startup, not successful import or complete acceptance.
