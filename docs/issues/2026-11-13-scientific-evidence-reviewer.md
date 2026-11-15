---
kind: issue
status: resolved
date: 2026-11-13
---

# Bounded independent scientific evidence reviewer

## Problem and scope

The existing Harness owns agent execution, permissions and child lifecycles, and
the Host owns conversation artifacts with exact versions. Permission
`auto-review` approves tools; it does not independently review scientific claims.
Research quality scripts are offline evaluation tools rather than a product
scheduler. There was no session-level product path to request a bounded,
independent evidence consistency review and carry its findings into the next
user-requested turn.

This task adds a fresh-context Reviewer on the existing Harness subagent seam.
Its frozen packet contains recent answers, user requirements, plan/approval
records, actual tool outcomes, and exact delivered artifact identities available
in that session. Missing or truncated material remains uncertainty. The four
concerns are execution claims without records, numerical conflicts, unsupported
citations, and omitted explicitly approved plan steps. All findings are model
opinions; no model output becomes mechanical verification, independent
recomputation, or human scientific acceptance.

## Owners and bounded behavior

- `scientificreview` owns packet identity, candidate validation, precise source
  anchors, finding dispositions and presentation. No I/O or clock.
- `scientificreviewer` freezes committed session evidence, mounts one private
  existing in-process provider, saves reports in the session journal and supplies
  open findings to later requests. No new loop, scheduler, retry, approval owner,
  artifact database, or background service.
- One review uses at most two child model steps, 4096 output tokens per step,
  90 seconds and twelve findings; existing provider and parent budgets also
  apply. Automatic mode defaults off, runs at most once per turn and never
  injects repair turns. A user may explicitly request another review.
- Existing ACP select controls expose Manual/Automatic; `/review` requests a
  review. `/review status`, `auto on|off`, and `resolve|dismiss <id> <reason>`
  expose retained state and reasoned responses. Agent responses use the scoped
  `scientific_review_disposition` tool and do not imply independent acceptance.
- Existing shared Chat Markdown and Save reply → session artifact → Scientific
  Viewer/Inspector display retained reports. No local control styling or token
  migration. The previous permission selector retains its separate semantics.

## Verification

Implemented and verified in the independent checkout. Domain, actual Harness,
ACP and built-in CLI race tests and vet passed. Actual Electron exercised
automatic/manual review, real local shell evidence, subsequent correction,
reasoned dispositions, saved Inspector in both themes and read-only restart
retention. A separately opted-in real DeepSeek reviewer used one HTTP request
to identify the deliberately false mean 9 against the actually saved mean 2.
Precise evidence and limits are recorded in
[Scientific Reviewer verification](../fitness/scientific-reviewer.md).

Validation found and fixed concrete integration gaps: the existing schema seam
does not accept `maxItems` (the domain still enforces the limit), user messages
are raw session messages, Host can append workflow text to slash commands, and
Paper stop checkpoints can still continue. Automatic review therefore runs
after the existing prompt/continuation owner actually settles the final turn.

## Deliberate limits

The Reviewer reads the bounded evidence the session actually retained. It does
not crawl arbitrary workspace files, fetch missing citations, infer plan
approval from an assistant plan, independently recompute results, or acquire
new environment/account authority. Artifact delivery metadata pins a version
but is not artifact contents. Results absent from retained reads must remain
uncertain. Scientific and signed-package acceptance require separate evidence.
