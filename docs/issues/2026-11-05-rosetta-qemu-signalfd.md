---
kind: issue
status: active
date: 2026-11-05
---

# Rosetta aborts the official QEMU binary on signalfd syscall 282

The two QEMU correction traces contain repeated `Unimplemented syscall number
282` diagnostics. Repeated reads of those logs are observations, not separate
crashes. Preserve their raw-zero verdicts and verifier stages independently.

A zero-model control now reproduces the platform failure in the unchanged
official `qemu-alpine-ssh:20251031` image. Its existing
`/usr/bin/qemu-system-x86_64 -M none -accel tcg -nographic -S`, bounded by a
three-second timeout, exits 133 immediately with the same Rosetta diagnostic.
There is no guest ISO, candidate implementation or model call in this control.

A minimal static Go probe creates and immediately closes a signal FD. The
amd64 build's old signalfd syscall 282 exits 133 under Rosetta. The native
arm64 build's signalfd4 syscall 74 succeeds in the same container image. This
isolates an unsupported syscall from the agent prompts. It does not establish
that a candidate would pass on native x86, or that every QEMU failure has this
sole cause. Alpine's separate uv download failure still prevents its functional
assertion; Startup's official test executes and fails 0/1.

Evidence is in the full-04 artifact root's `rosetta-signalfd-control/`: probe
source, separately built binaries, hashes, stdout/stderr and the actual QEMU
empty-machine log. These artifacts and binaries stay outside Git. The running
benchmark inputs, official images and pinned agent binaries remain unchanged.
Continue the local full suite with this environment limitation visible. Use a
native x86_64 runner for an independent QEMU acceptance before claiming prompt
quality or candidate correctness from these cases.

A separate explicit-user-emulator control invokes the dedicated VM's existing
native `/usr/bin/qemu-x86_64` for only the QEMU subprocess. Global binfmt stays
disabled, and the agent/runtime execution mode stays unchanged. The signalfd
probe then succeeds. The actual QEMU 5.2 empty machine also stays alive for
three seconds. This interpreter's preserve-argv0 form needs both program-path
arguments; the initial argument-form failure is retained separately.

With the unchanged Alpine ISO, that isolated mode reaches SeaBIOS/ISOLINUX's
boot prompt and stays alive for 45 seconds without the syscall abort. No login
prompt, SSH configuration or official assertion is established. This is a
possible subprocess compatibility path, not candidate acceptance or a change
to any queued benchmark. It must not globally restore the Go execution mode
that failed in the earlier, separate emulation incident.
