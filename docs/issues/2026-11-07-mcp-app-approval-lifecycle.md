---
kind: incident
status: resolved
---

# Preserve pending MCP App approval

Review of PR #146 found two ordinary approval lifecycle failures:

- The Host reused its 45-second connection setup timeout for interactive App
  operations. A user reviewing permission longer than that lost the operation,
  and the Host sent a session cancellation before the Agent's own tool deadline.
- Selecting a tool while another App was awaiting approval replaced the form.
  Opening the new form replaced the sole pending identity, so Close could leave
  the original approval alive.

Interactive calls should wait for approval like normal prompts, with tool
execution deadlines owned by the Agent. Read-only setup operations remain
bounded, and explicit close/cancel remains responsive. The panel permits one
pending opening until it completes or the user closes it.

Verification belongs in the existing ACP and rendered panel fixtures: approval
survives the setup deadline, and a replacement form cannot orphan an opening.

The real Host/Go ACP/MCP production browser fixture passed with approval withheld
for 46 seconds (`--browser --slow-approval`). The replacement-form case closes
the original opening, supplies a late approval and observes zero tool effects
and no mounted frame. Existing ACP lifecycle tests and `npm run check` pass.
