---
kind: incident
status: resolved
---

# MessageDisplay reentered the session notification lane

The actual CLI MessageDisplay regression hangs after the provider completion.
A child SIGQUIT stack shows ACP's synchronous assistant/message subscriber
running the display hook; its ReportStatus callback appends hook/status while
the same session's notification mutex is held. This is a deterministic self-join,
not a provider timeout. Hook implementations can also invoke other session effects.

Run display hooks at the agent's pre-publication message boundary, outside the
session observer lane. Keep one bounded display result per agent; ACP consumes
that presentation without executing hooks or changing canonical assistant text.
Use the existing CLI regression to verify the original model text remains in
the journal and only transformed text reaches the live client.

The existing loopback CLI regression passes after pre-publication preparation.
ACP and the focused CLI race checks pass. No session notification semantics
were changed and the original display hook inputs/journal remain canonical.
