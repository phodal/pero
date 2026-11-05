---
kind: issue
status: resolved
date: 2026-11-04
---

# Explicit HTTP provider endpoints cannot be tested through the native agent

The operator supplied a remote HTTP endpoint and credential for actual `sol`
and `terra` compatibility checks. Model discovery succeeds, but the provider
constructor rejects every non-loopback HTTP endpoint before inference. The
trial client has the same default restriction.

Add an explicit `--allow-http` opt-in for the configured provider endpoint and
an equivalent trial setting. Defaults must retain HTTPS/non-redirect behavior;
the option must not change TLS verification, web-tool endpoints or automatic
proxy selection. Credentials remain in the named environment variable and are
removed before tool children start. Do not include operator credentials in
configuration, journals or checked-in examples.

Verify endpoint admission, unsupported URL forms and an actual agent tool
round trip. Record model availability and provider failures separately from
Claude plugin compatibility or benchmark correctness. The active DeepSeek
Terminal-Bench binary and its frozen follow-up must stay unchanged.

Verified with the explicit HTTP setting through a real native sol Responses
trial: six successful provider requests, paired file/shell tool calls, normal
agent shutdown and all nine independently rerun tests passed. The endpoint's
Chat tool route rejects requests, so protocol selection is explicit. No HTTP
endpoint admission default or frozen DeepSeek benchmark binary was changed.
