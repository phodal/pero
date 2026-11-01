---
kind: analysis
status: resolved
date: 2026-11-01
---

# PC-Gym smoke did not exercise optimizer updates

The first real smoke completed rollouts, MPC and independent recomputation, but
both saved SB3 checkpoints reported `num_timesteps=64`, `learning_starts=100`
and `_n_updates=0`. Its completed execution was valid wiring evidence, not evidence
that the optimizer ran. Synthetic contract tests did not expose this gap.

The smoke profile now requests 128 steps, above the observed warmup threshold.
The runtime records actual timesteps, learning_starts and gradient updates with
each checkpoint and in its progress events. The full table6 profile and original
upstream reward are unchanged. The original attempt is retained; validation uses
a new Spec/attempt rather than overwriting the completed record.

Actual first and corrected attempts are recorded in
[the scientific smoke verification](../fitness/paper-pcgym-smoke.md).
