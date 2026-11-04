---
kind: issue
status: resolved
---

# Original source action missing from normal HTML reading

The normal sandboxed HTML reader does not render its structured children. The
per-block Reveal original controls therefore appeared only in recorded evidence
or error fallback, making the normal reader's block-level source action absent.

The Paper adapter now resolves the reader's selection anchors to one unique
structured block and exposes Reveal original beside the selection discussion
action. All anchors must map to the same block in the current document; missing,
ambiguous, or cross-block anchors expose no block action. The existing whole-file
Original HTML action remains available under source details.

The existing source operation owns the bundle/resource identity, original byte
window and receipt. Selection text and anchors are navigation context, not new
evidence offsets. The reader package, iframe sandbox and fallback are unchanged.

Non-browser component tests cover selection replacement/clearing, no duplicated
legacy view, exact block/scoped source requests, window continuation, unresolved
ownership and stale response rejection after bundle/revision changes. Browser
verification remains pending; it was not run in this repair environment.
