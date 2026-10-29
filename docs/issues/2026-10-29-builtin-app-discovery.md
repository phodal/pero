---
kind: issue
status: resolved
---

# New builtin Apps missing from existing profiles

The App runtime stops scanning its bundled catalog when `.builtins-seeded`
exists. Existing profiles that first installed Virtual Cell never discover a
later Paper Agent package. The Desktop does request the catalog at startup and
when entering/refreshing Apps; the Host only enumerates installed packages.

Replace the global gate with per-App discovery receipts. Scan the trusted
composition-root catalog at startup and list requests, install newly encountered
packages, and retain installed enable state and explicit removals. Do not update
existing packages or add a source watcher in this change.

The old marker stores only `1`, so migration has no complete per-App removal
history. Preserve the original Virtual Cell seed and all installed identities;
subsequent discovery/removal decisions have explicit durable receipts. Arbitrary
Apps removed before this migration cannot be distinguished from newly bundled
Apps solely from that legacy marker.

Verified: all 41 runtime tests plus one Host test, the real stdio App contract
suite, and the focused Electron catalog suite passed. The Desktop suite used an
old seeded profile with disabled Virtual Cell and retained research data; Paper
Agent appeared automatically. Removing it and restarting retained the removal.
See `docs/fitness/apps.md` for commands and evidence. The running user Desktop
was not restarted or its installed directories modified by these checks.
