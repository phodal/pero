---
kind: incident
status: active
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

Preserve the interrupted cohort in local analysis artifacts at
`reports/coding-benchmark-2026-11-04/terminal-bench2-full-01/`. The next cohort
will retain official amd64 images and use a static native Linux arm64 agent;
the arm64 kernel can execute that agent while binfmt runs image commands.
Record this mixed architecture explicitly and validate its ACP/tool lifecycle
before continuing. Do not combine infrastructure aborts with model scores
or overwrite them with later attempts. The precise QEMU/Go cause remains open.
