---
kind: incident
status: resolved
date: 2026-10-29
---

# Product screenshot context preview was blocked

The App Product's trusted parent could capture and freeze an App screenshot, but
its CSP did not allow data images. The preview dialog therefore had no decoded
pixels and correctly kept “Add annotations to draft” disabled. Workbench already
allowed data images; the independent Product shell needed the same image policy.

The Product policy now allows only `data:` and `blob:` images in its parent.
App origins and the Agent transport retain their existing policies. The native
Product acceptance flow opens the actual chip preview, adds and undoes a region,
then sends the frozen PNG and annotation JSON through ACP.

The Product flow passed with zero renderer errors. Verification is tracked in `docs/fitness/app-use.md`; generated screenshots stay
under `test-results/app-use/`.
