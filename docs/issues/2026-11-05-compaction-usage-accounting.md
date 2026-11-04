---
kind: issue
status: resolved
date: 2026-11-05
---

# Context compaction responses are absent from usage reports

The real context-pressure fixture makes separate summarization requests, but
the trial and Session reporter count only assistant/message usage. Accepted
summaries retain usage in compaction/summary; rejected or truncated summaries
can consume provider tokens without retaining any usage event. Counting only
main turns understates long-task consumption.

Record each completed compaction provider response before validating or
applying its summary. Count this event once in both offline reporters; use
legacy compaction/summary as a fallback only when no response event exists for
that compaction ID. Keep chunks and duplicate summary receipts excluded. Failed
provider requests without usage and old rejected summaries remain unknown.
The frozen baseline has compaction disabled and is not modified.

## Resolution and verification

A durable compaction/response now records each completed provider request before
validation. Both reporters count it once and fall back to legacy accepted
summary usage. Failed attempts without response usage remain unknown: Session
reports flag coverage gaps and the trial receipt records unreported_attempts.

Regression cases include accepted/duplicated, rejected, legacy accepted,
legacy failed, malformed identity and actual CLI JSONL restoration. Session
report tests (24), trial tests (21), CLI compaction race tests, vet and standalone
Bazel pass. The old real long-task trace contains 15 accepted summaries and 20
nonshrinking failures; its missing rejected-response usage cannot be recovered
retroactively. It is retained with incomplete coverage, not treated as zero cost.
Known compaction failures also retain their exact native error and seq/line
reference as findings, even when their usage is complete.
