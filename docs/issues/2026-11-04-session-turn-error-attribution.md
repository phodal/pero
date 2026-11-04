---
kind: incident
status: resolved
date: 2026-11-04
---

# Session summaries omit the source of failed turns

The uncapped Terminal-Bench `bn-fit-modify` attempt ends its human prompt
normally after 33 responses. Its native Session then starts a plugin turn for
a queued Bash completion notice while the ACP client is closing. That second
turn records `runtime: run is inactive`, with no additional provider request.
The reporter counts one turn error but omits `turn/start.source`, making it
hard to distinguish this tail event from a failure of the human prompt.

Retain each turn's source and report native turn errors grouped by source.
Missing starts remain unknown. Preserve the original errors and total error
count; source attribution alone cannot establish a shutdown root cause or
change the independent verifier outcome. This is a reporting repair, not a
runtime-lifecycle fix.

The reporter now joins `turn/start.source` to each terminal turn record and
adds `turn_errors_by_source` to JSON and Markdown summaries. Its regression
retains a successful human turn, plugin error, human error and missing-start
error without changing the original errors or total. All 21 reporter tests
and 18 trial-client tests pass. Re-analysis of the actual BN Session reports
one plugin error while preserving the previous usage and failed-call counts.
