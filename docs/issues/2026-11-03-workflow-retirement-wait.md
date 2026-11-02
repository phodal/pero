---
kind: incident
status: resolved
---

# Background Workflow retirement wait

A parent retirement test exposed a wait cycle: a Workflow retirement hook
joined a member activation, whose parent receipt awaited that parent's complete
retirement. Moving the join to Deactivated still ran before that receipt could
settle and preserved the cycle.

Retiring now fences admission and cancels accepted workflows without joining
inside the retirement callbacks. The AgentManager retires the child tree;
member receipts settle after parent retirement. The owning Workflow
contribution drains and joins all accepted work before releasing its catalog.
Cancellation through TaskStop or a live parent interruption can still join
directly. Terminal facts use the already admitted task's original Session,
allowing cancellation bookkeeping after live-agent admission is withdrawn.

The real retirement test handles the manager's explicit disposal-in-progress
receipt, waits for WaitRetired, then observes the workflow terminal and child
provider cleanup. TaskStop, interruption and contribution disposal have their
own real-process rows. No alternate model loop or child lifecycle is introduced.
