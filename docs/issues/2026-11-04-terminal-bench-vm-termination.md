---
kind: issue
status: active
date: 2026-11-04
---

# Terminal-Bench VM terminated during the uncapped suite

At 2026-11-04 13:25:17 UTC, Lima reported a VZ
`VirtualMachineStateError`, followed by VZErrorDomain Code=3:
“The virtual machine is no longer live.” Docker queries then hung. Native
activity in both `dna-assembly` and `dna-insert` stopped at the same time.
This is a benchmark infrastructure interruption; the underlying cause is
unknown. It is separate from the earlier QEMU runtime incident.

Twenty completed official result hashes and both interrupted native Sessions
are preserved under the local full-04 artifact directory's
`vm-failure-20261104T1325/`. Before scheduler termination, the dead Docker
transport released queued setup errors. All 21 affected trial directories,
including zero-request failures and unfinished setups, are archived outside
the resumed job. The scheduler was stopped before restoring the VM.

Recovery must preserve completed results and interrupted attempt usage, use
only the dedicated `pero-benchmark-rosetta` VM, and start unfinished trials
fresh with the same pinned binary, uncapped requests and official timeouts.
Neither affected trial has a verifier outcome. No infrastructure interruption
is to be relabeled as a model failure or omitted from usage accounting.

Recovery is verified: only this profile was force-stopped and restarted;
QEMU's x86_64 registration was disabled again, Rosetta stayed enabled, and an
amd64 Go control completed 4,000 goroutine/channel sends. All 20 result hashes
remain unchanged after Harbor reconciliation. The remaining 69 tasks resumed
with the original execution settings; neither completed tasks nor official
test inputs were changed.

The separate timeout-follow-up pipeline now restores and checks the same
binfmt control after its own VM restart. The interrupted Sessions are included
in all-attempt usage and remain separate from selected task outcomes. The VM
failure's root cause remains open; a restart is a recovery, not a cause fix.
