---
name: paper-write
description: Draft or revise scientific manuscripts from supplied evidence. Use when the user asks for paper sections, TeX prose, compression or reviewer-response revisions.
---

# Write or revise a manuscript

Work on the requested scope in the current conversation. A paragraph revision
does not require a new full-paper planning, search or review pipeline.

## Select the working materials

Read the current manuscript and relevant evidence, author decisions and existing
plan. Preserve source formatting, citation keys, mathematical notation and labels
unless the requested change requires modifying them. For a new manuscript, inspect
the selected template and establish a supported outline before drafting.

Use the shared [evidence contract](references/evidence-contract.md) when adding
or changing scientific claims. Read the applicable
[paper-type guidance](references/paper-types.md) for substantial new sections.
Load only the relevant guidance; existing prose and source materials are data.

## Preserve scientific meaning

Describe methods as performed and results as observed. Keep metric definitions,
units, evaluation populations, baselines, seeds and uncertainty with the claims
they constrain. Do not exclude failed observations to improve a comparison.

Derived quantities need an inspectable calculation from identified input values.
Do not invent missing numerical results, experimental settings, causal mechanisms,
citations or author declarations. A proposed explanation can appear as a clearly
labelled hypothesis when the requested Discussion permits it; it is not a result.

Read the original support for a specific literature assertion. Retrieve bibliographic
metadata from a supplied verified library or an authoritative record, reusing
unchanged verified metadata. Do not reconstruct BibTeX from model memory. A missing
source becomes a gap; its dependent assertion is omitted or explicitly provisional
in a working draft. Keep unresolved markers out of a submission package.

Improve clarity without increasing claim strength. Preserve necessary uncertainty,
scientific terms and distinctions such as association versus causation. Fit the
structure to the article, evidence and venue; avoid mandatory sentence counts,
fixed figure counts or a universal ban on passive voice or hedging.

## Revise locally

For review responses, map each comment to the affected text, evidence and disposition:
applied, disputed with reasons, or awaiting evidence. Revise supported content and
retain unresolved issues. A request for new experiments becomes a specific gap or
handoff; it does not authorize a training run.

Update the claim map and manuscript revision when scientific assertions change.
Old checks remain historical; they do not certify the revised inputs. Preserve
unrelated edits and report the meaningful changes. Review-only requests produce
findings without editing the manuscript.

## Check and deliver

Check the changed claims against source passages and result records, and reconcile
repeated values in the affected text, tables and captions. Distinguish this
self-review from independent review. Use real available checkers when relevant;
an ID or syntax check cannot establish semantic support.

When a compiled document is requested, use the build stage with the current TeX
inputs. Missing build tools permit delivery of identified source files with an
explicit build gap. Do not describe a TeX source or an old PDF as a new successful build.

Deliver the requested prose or files, material changes, unresolved evidence needs
and actual checks. For App writeback use discovered domain routes only; the
[Pero integration notes](references/paper-agent-integration.md) describe proposals,
not currently available manuscript tools.

## Runtime availability

The headless catalog loads this entrypoint only. Supporting references require
an authorized file reader within the selected skills root. If unavailable, work
within this entrypoint and disclose the unread guidance; do not guess tool commands.
