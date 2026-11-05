---
kind: issue
status: active
date: 2026-11-05
---

# Benchmark image audit incorrectly derives a Compose container name

The artifact-only mirror recovery adds an image-identity check before the agent
starts. It lowercases the trial name and appends the service suffix. Harbor also
sanitizes the Compose project name, so the dot in `install-windows-3.11` makes
that lookup invalid. The diagnostic raises before agent execution: zero model
requests, no native Session and no verifier result. This is our audit failure,
not a benchmark candidate failure or an image-content mismatch.

Retain that exact result and its hash. Resume the known diagnostic pause so the
event loop can service the already-running HF task's deadline. Let the other
29 task slots finish, then recover only this zero-request slot in a separate
job. Preserve the original frozen configuration, binary, source inputs and all
completed results. Use Harbor's own project-name sanitizer and the Compose
project/service labels to find the actual container. The completion guard must
join the recovery slot once and continue to reject duplicate or unstarted slots.

Evidence is retained under the full-04 artifact root's
`image-identity-capture-failure/`. The two early QEMU corrections and the 59-task
checkpoint remain unchanged.

A real zero-model Docker Compose control reproduces this exact dotted-name
case with the frozen Windows image. The old name lookup fails; Harbor's
sanitizer plus Compose project/service labels identifies exactly one container
whose image ID matches the frozen receipt. The control removes its container
afterward. `compose-control-receipt.json` retains the result.

The original queue is running again. A separate finite controller waits for
its completion, verifies the zero-request result hash, archives it, and admits
only Windows with the original binary/configuration. The completion guard
joins that fourth job and still requires 89 unique actual-started raw verdicts.
The incident remains active until the real Windows slot and its image receipt
are verified. All-attempt reporting also includes the retained setup incident.
