---
kind: incident
status: resolved
---

# Deferred Explore loses its authorized native tool pool

The tool-efficiency mergesort follow-up spawned Explore before parent Bash
activation. Its child made five empty ToolSearch calls and retained only the
discovery declaration. Builtin selection and child allowlist admission use
SchemasForAgent, which is the deferred presentation rather than the complete
authorized pool. Presentation state is accidentally treated as a permission cap.

Trusted delegation setup must select from the existing deferred owner's
caller-authorized candidates. It must not activate schemas, broaden workspace
authority or bypass inherited denies. Model request assembly continues using
ordinary declared schemas. Restricted child definitions also need the currently
authorized discovery tool to activate their allowed tools.

Verify actual HTTP: parent need not activate Read/Bash; child initially receives
only ToolSearch, discovers and invokes permitted Read, and cannot discover Write.
Custom tool allowlists, explicit empty tool pools, unavailable names and parent
denies remain effective.

Verification: a real loopback HTTP continuation table covers Explore, Plan,
a custom Read-only child, inherited parent denial and explicit no-tools.
The child starts with discovery only, receives exact permitted declarations
after discovery and reads real workspace content. Full Go race/vet pass;
standalone Bazel subagents and the complete 35-target suite pass.

The read-only builtin pool also retains Session-owned ReadToolOutput, allowing
recovery of its saved output. Explicit custom allowlists still exclude it unless
selected. The discovery HTTP table verifies both choices.

Live source `8f0b02fa` confirmed Explore can discover and invoke Bash in three
responses with no empty search. Its parent then exhausted the shared budget in
further delegated implementation/checks; no official submission was recorded.
That preserved failure motivates the direct-native-tool guidance follow-up.
