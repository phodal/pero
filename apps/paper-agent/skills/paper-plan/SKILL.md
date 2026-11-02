---
name: paper-plan
description: Plan a scientific paper from research artifacts. Use when the user asks for an outline, contribution framing or a claim-evidence map.
---

# Plan a manuscript

Produce a reviewable argument and evidence outline at the requested depth. Continue
the current conversation; planning does not start experiments or a second Agent.

## Establish the target

Identify the research question, supplied materials, article type, requested scope,
language and venue when supplied. Use existing project decisions. If a missing
choice would change the scientific framing, ask a focused question while inspecting
the usable materials. Otherwise record the assumption and proceed with a concrete plan.

An unspecified venue permits a generic outline. Venue rules require the actual
current author instructions and template; preserve unresolved rules as gaps.

## Read the evidence before framing contributions

Open relevant results, method descriptions, code revisions and source passages.
Treat narrative notes as leads; distinguish completed observations from intended
experiments, synthetic demonstrations and hypotheses. Retain competing definitions
when sources disagree instead of choosing the one that gives a stronger claim.

When creating a claim map, read the shared
[evidence contract](../paper-write/references/evidence-contract.md). Reuse existing source
and attempt identities. In a filesystem-only workflow, use versioned file locators;
do not invent App observation IDs, runs or human verification records.

For the manuscript's actual contribution type, read the relevant part of
[paper types](../paper-write/references/paper-types.md). A checklist names questions to ask;
it supplies no missing experiment, baseline, mechanism or result.

## Design the argument

State the strongest supported contribution in one sentence. Map material empirical,
methodological and literature claims to their evidence, scope and uncertainties.
Keep proposals and assumptions visibly distinct from observations. Do not require
a citation marker on connective prose merely to fill a registry.

Give each proposed section its purpose, claim references and required displays.
For each figure or table, identify the actual source data or original asset and
the question it answers. Keep unsupported slots in the gap list. A useful partial
plan is preferable to inventing an ablation or blocking all supported sections.

## Deliver

Return the contribution sentence, evidence map, section outline and material gaps.
When an authorized workspace is available, save a compact plan and its associated
claim map there. Keep local records distinct from a persisted Pero manuscript.

The plan is complete when it answers what the paper can currently argue and what
evidence is still needed. Drafting, computation and submission follow only the
user's requested scope. Tool names and lifecycle integration proposals are in
[the Pero adapter notes](../paper-write/references/paper-agent-integration.md); discover real
capabilities before using them.

## Runtime availability

The headless catalog loads this entrypoint only. Supporting references require
an authorized file reader within the selected skills root. If unavailable, work
within this entrypoint and disclose the unread guidance; do not guess tool commands.
