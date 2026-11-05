---
kind: issue
status: active
date: 2026-11-05
---

# Cached image alias retains a failed mirror's media type

`overfull-hbox` fails before agent setup with zero provider requests. Docker
cannot create its container because the original image alias points at the
frozen manifest with `application/octet-stream` instead of the manifest media
type. The first mirror's failed pull left that descriptor behind. The second
mirror successfully downloaded the same manifest and layers with the correct
type, but tagging the original name did not replace its stale descriptor.

The original prefetch architecture check passed for the second mirror
reference; it did not establish readiness of the final original alias. A fresh
inventory finds this missing architecture only on this one of the 30 staged
original aliases. Retain the original prefetch receipts and failed trial;
the earlier blanket alias-readiness claim is superseded by this evidence.

Copying only the verified second-mirror descriptor over the original alias
preserves the exact manifest digest, image ID, layers and official task inputs.
A disposable container then starts the original alias and exits zero using
`/bin/true`, with no model call. The unrelated main queue resumes after the
zero-request failure is preserved. Isolated recovery must run this task after
that queue, alongside the already queued Windows diagnostic slot; completion
still requires 89 distinct actual-started official verdicts.

`image-manifest-startup-failure/` retains the result hash, all-30 inventory,
before/after containerd descriptors, repaired image inspection and actual
container readiness receipt. Candidate correctness and official verdict
remain pending. No model, prompt, task file or frozen source is changed.
