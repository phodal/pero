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

At 15:55 UTC a second Docker disconnection left 32 official verdicts, 55
setup failures and two executed attempts without verdicts. A blind setup
recovery produced another 55 zero-request failures. The export pipeline
incorrectly treated 89 ended records as completion and started corrections.
That queue was stopped; its three setup attempts, both sets of 55 failures,
the interrupted native journals and the premature export are retained in
`vm-disconnection-20261104T1555/`. All 32 judged result hashes were recorded
before resuming the remaining 57 tasks with the frozen baseline configuration.
The second disconnection's root cause remains unknown; it is not yet confirmed
to be another VZ failure. The previous guest journal stops without a shutdown
record and does not establish a cause.

The local completion gate now requires agent execution and an official 0/1
verdict for each unique manifest task. Both baseline export and correction
launch use that gate. An incomplete 32/89 materialization is rejected. A Docker
health interruption must stop queue admission and preserve evidence before
recovery, rather than exhaust the queue against an unavailable daemon.

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

A subsequent recovery exposed a separate DNS outage before agent startup.
The guest's Colima resolver `192.168.5.4` timed out; direct UDP queries to
`1.1.1.1` and `8.8.8.8` returned valid answers. Three zero-request setup
attempts were preserved in `dns-failure-20261104T1607/`. Only this dedicated
profile now declares those public resolvers, and the running guest resolver
was updated. A fresh pinned amd64 container resolved both Ubuntu and DeepSeek
successfully before the remaining queue resumed. Default Docker context and
other profiles were not modified. The updated scheduler pauses on the next
setup failure; this hook is active only in processes started after that edit.

At 16:47 UTC, the old running scheduler admitted 19 zero-request setup failures
while direct public DNS returned inconsistent Docker Hub addresses, including
a registry connection with a certificate for another domain. Queue admission
was paused manually. All 34 existing verdict hashes and setup failure hashes
were recorded in `dns-registry-failure-20261104T1647/`. The dedicated guest's
hosts file temporarily pins registry and auth addresses obtained over HTTPS;
certificate validation remains enabled. Pulling the unchanged official
headless-terminal image succeeded with its saved digest before admission
resumed. These attempts require fresh setup recovery and are not model scores.
