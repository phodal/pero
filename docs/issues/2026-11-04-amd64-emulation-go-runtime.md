---
kind: incident
status: resolved
date: 2026-11-04
---

# Go runtime abort during amd64 benchmark emulation

The first two tasks of the full Terminal-Bench 2.0 attempt abort immediately
after their first DeepSeek response. Both ACP logs contain `fatal error: found
bad pointer in Go heap`; Harbor records `NonZeroAgentExitCodeError`. These are
runtime failures, not failed coding submissions. The third task was cancelled
and the other 86 tasks never started when the queue was stopped for diagnosis.

The clean Go 1.27.3 linux/amd64 binary was built from `2f02e684`, SHA-256
`0ed53b5f787cbf3798995bb7402b05d84a55b57b9ea4c4890c8a1ad4b615591c`.
Official prebuilt amd64 task images run under QEMU on an arm64 Colima VM.
The first stack includes `runtime.asyncPreempt` while executing a deferred
tool batch. This suggests an emulation/runtime interaction; the stack does
not establish its cause or identify a production memory-safety bug.

The offline deferred-tool tests repeated 20 times pass on native macOS arm64
and as a static Linux arm64 executable inside the same official amd64 image.
The amd64 executable under QEMU instead aborts with `close of synctest channel
from outside bubble`, both normally and with `GODEBUG=asyncpreemptoff=1`.
Disabling preemption is therefore not an established workaround.

A separate 9-line program using only `fmt`, `runtime`, and `sync` repeatedly
creates, closes and receives from fresh channels in eight goroutines. Under
the same image, its amd64 build incorrectly panics `close of closed channel`;
its arm64 build completes successfully. Neither binary imports Pero or its
dependencies. This isolates the failure from Pero's tool registry; it does
not distinguish a Go code-generation bug from an emulator bug.

The intermediate cohort with a native arm64 agent avoided that abort, but
the amd64 Chrome verifier could not start under QEMU. The official oracle also
failed with `SessionNotCreatedException`, establishing an independent verifier
environment failure. Its three completed model trajectories and two cancelled
tasks remain preserved in `terminal-bench2-full-02/`; no aggregate model score
is claimed for that interrupted cohort.

## Resolution for benchmark execution

Use a dedicated Colima VZ profile with Rosetta enabled and qemu-x86_64 disabled.
The original amd64 binary's standalone channel probe and the deferred-tool
tests repeated 20 times pass there. The same browser task's unchanged official
oracle and verifier pass 1/1 with reward 1, without skips. This resolves the
benchmark execution blocker without production code or prompt changes; the
precise QEMU/Go cause remains open.

The full 89-task cohort uses official amd64 images and the original clean
amd64 binary in `terminal-bench2-full-03/`. The two interrupted cohorts remain
separate evidence, including failures and cancelled tasks. Record emulator,
image digests, source and binary hashes rather than treating a reward-zero
verifier startup failure as a model implementation failure.
