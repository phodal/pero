---
kind: incident
status: resolved
---

# Trial must preserve Unicode separators inside JSONL strings

The retained real coder continuation reached its HTTP request cap, but its
observation script then failed while aggregating usage. The original session
files are valid JSONL: each physical line decodes successfully. Python's text
splitlines also treats U+0085 (NEL) as a record separator, splitting legal JSON
string values and producing an unterminated-string error. The root log contains
six literal NEL characters from Unicode whitespace probes.

The same reader pattern exists in Trial's usage aggregation, pipeline journal
projection and review verifier. Correct record framing without altering source
logs, completion accounting or the workflow's incomplete status. Verify legal
NEL/line/paragraph separators in actual CLI output and provider usage, while
keeping malformed physical JSON records rejected.

All three JSONL readers now split byte records rather than Unicode text lines.
This preserves legal Unicode within each string and still rejects broken JSON
on a physical line. The actual CLI regression writes and returns NEL/U+2028/
U+2029 text, verifies the file and projected journal, retains both provider usage
reports, and confirms process cleanup. A reader regression also rejects a raw
newline inside a JSON string and an incomplete physical record. All eighteen
Trial tests pass. The retained real logs now aggregate to 509 committed provider
usage reports, without rerunning any model call or editing the original logs.
