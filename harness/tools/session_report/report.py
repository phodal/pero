#!/usr/bin/env python3
"""Offline usage and tool-call report from native Pero Session JSONL."""
from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys


TOKEN_KEYS = {"input_tokens": "inputTokens", "output_tokens": "outputTokens",
              "cache_read_tokens": "cacheReadTokens", "cache_write_tokens": "cacheWriteTokens",
              "reasoning_tokens": "reasoningTokens", "total_tokens": "totalTokens"}


def encoded(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


@dataclass
class Usage:
    input_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    output_tokens: int = 0
    reasoning_tokens: int = 0
    total_tokens: int | None = 0
    known_total_tokens: int = 0
    reported_completions: int = 0
    unreported_completions: int = 0
    totals_unreported: int = 0

    def add(self, usage: dict | None) -> None:
        if usage is None:
            self.unreported_completions += 1
            self.total_tokens = None
            return
        for field_name, key in TOKEN_KEYS.items():
            value = usage.get(key, None if key == "totalTokens" else 0)
            if value is not None and (type(value) is not int or value < 0):
                raise ValueError(f"invalid nonnegative integer usage field: {key}")
            if value is None and key != "totalTokens":
                raise ValueError(f"invalid null usage field: {key}")
            if key == "totalTokens":
                if value is None:
                    self.totals_unreported += 1
                    self.total_tokens = None
                else:
                    self.known_total_tokens += value
                    if self.total_tokens is not None:
                        self.total_tokens += value
            else:
                setattr(self, field_name, getattr(self, field_name) + value)
        self.reported_completions += 1

    def summary(self) -> dict:
        result = asdict(self)
        # Pero's normalized input excludes cache reads. Cache writes and reasoning
        # are descriptive subfields, not additional token lanes.
        result["prompt_tokens"] = self.input_tokens + self.cache_read_tokens
        result["derived_total_tokens"] = result["prompt_tokens"] + self.output_tokens
        result["committed_response_usage_complete"] = self.unreported_completions == 0 and self.totals_unreported == 0
        result["usage_complete"] = result["committed_response_usage_complete"]
        result["cost_usd"] = None
        return result


@dataclass
class Finding:
    kind: str
    severity: str
    message: str
    refs: list[dict] = field(default_factory=list)


@dataclass
class Call:
    id: str
    name: str
    seq: int
    line: int
    time: str
    turn: int | None
    step: int | None
    arguments_preview: str
    command: str | None
    argument_bytes: int
    argument_sha256: str
    source: dict
    result_seq: int | None = None
    result_line: int | None = None
    end_time: str | None = None
    protocol_error: bool = False
    execution_failure: bool = False
    lifecycle_failure: bool = False
    lifecycle_status: str | None = None
    lifecycle_diagnostic: str | None = None
    cleanup_uncertain: bool = False
    status: str = "missing_return"
    exit_code: int | None = None
    timed_out: bool = False
    aborted: bool = False
    output_preview: str = ""
    stdout_sha256: str | None = None
    result_bytes: int = 0
    output_bytes: int = 0
    duration_ms: float | None = None
    process_end_seq: int | None = None
    process_end_line: int | None = None
    repeated_from_seq: int | None = None
    repeated_result: str | None = None
    result_sha256: str | None = None
    validation_signals: list[dict] = field(default_factory=list)
    reviewed_validation_failure: bool = False
    review: dict | None = None
    truncated: bool = False
    observed_task_state: dict | None = None
    discovery_total: int | None = None


def text_blocks(value: dict) -> str:
    return "\n".join(block.get("text", "") for block in value.get("content", [])
                     if isinstance(block, dict) and block.get("type") == "text")


def payload_of(data: dict) -> dict:
    text = text_blocks(data)
    try:
        value = json.loads(text)
    except (ValueError, TypeError):
        return {}
    return value if isinstance(value, dict) else {}


def stream_text(value: object) -> str:
    return value if isinstance(value, str) else value.get("text", "") if isinstance(value, dict) else ""


def validation_signals(output: str) -> list[dict]:
    """Signals are review candidates, never an automatic assertion verdict."""
    patterns = [
        ("unittest_failed", r"^FAILED\s*\([^\n]*(?:failures|errors)=[1-9][0-9]*[^\n]*\)"),
        ("unittest_case_failed", r"^(?:FAIL|ERROR): test[\w.]+ \([^\n]+\)\s*$"),
        ("python_traceback", r"^Traceback \(most recent call last\):[\s\S]*?^[\w.]+(?:Error|Exception)(?::[^\n]*)?$"),
        ("printed_nonzero_exit", r"^(?i:exit)=[1-9][0-9]*\s*$"),
        ("pytest_failed", r"^=+[^\n]*\b[1-9][0-9]* failed\b[^\n]*=+\s*$"),
        ("empty_test_suite", r"^\s*(?:Ran 0 tests?\b|0 tests? in\b|collected 0 items\b|(?:=+\s*)?no tests ran\b)[^\n]*$"),
    ]
    signals = []
    for kind, pattern in patterns:
        match = re.search(pattern, output, re.MULTILINE)
        if match:
            evidence = match.group()
            signals.append({"kind": kind, "confidence": "review_required",
                            "evidence_excerpt": evidence[-800:]})
    return signals


def timestamp(value: str) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def label_for(path: Path) -> str:
    parts = path.parts
    if "runs" in parts:
        index = len(parts) - 1 - list(reversed(parts)).index("runs")
        if len(parts) > index + 2:
            return "/".join(parts[index + 1:index + 3])
    return path.stem


def inspect_session(path: Path, reviews: list[dict] | None = None) -> dict:
    """Read once; retain semantic records, never all streaming chunks in memory."""
    header = None
    counts: Counter = Counter()
    hasher = hashlib.sha256()
    size = 0
    calls: dict[int, Call] = {}
    pending: dict[str, int] = {}
    results: dict[int, tuple[dict, dict]] = {}
    processes: dict[int, str] = {}
    process_ends: dict[str, tuple[dict, dict]] = {}
    responses = []
    contexts = []
    wire_measurements, batch_budgets = [], []
    pending_wire = None
    turns = []
    turn_sources = {}
    findings = []
    usage = Usage()
    current_header = {}
    current_system = ""
    previous_seq = 0
    last_time = None
    event_count = 0
    source_path = str(path.resolve())
    with path.open("rb") as handle:
        for line_number, raw in enumerate(handle, 1):
            hasher.update(raw)
            size += len(raw)
            if not raw.strip():
                continue
            try:
                record = json.loads(raw)
            except ValueError:
                raise ValueError(f"invalid JSONL record at {path}:{line_number}") from None
            if header is None:
                header = record.get("header") if isinstance(record, dict) else None
                if not isinstance(header, dict) or not isinstance(header.get("id"), str):
                    raise ValueError(f"not a native Pero Session: {path}")
                continue
            event = record.get("event") if isinstance(record, dict) else None
            if not isinstance(event, dict) or type(event.get("seq")) is not int or not isinstance(event.get("data"), dict):
                raise ValueError(f"invalid Pero event at {path}:{line_number}")
            seq = event["seq"]
            if seq <= previous_seq:
                raise ValueError(f"duplicate or unordered event seq at {path}:{line_number}")
            previous_seq = seq
            event_count += 1
            kind, data = event.get("type"), event["data"]
            counts[kind] += 1
            last_time = event.get("time")
            ref = {"seq": seq, "line": line_number}
            if kind == "system/message":
                current_system = text_blocks(data.get("message", {}))
            elif kind == "request/header":
                current_header = data
                tools = data.get("tools", [])
                contexts.append({**ref, "provider": data.get("provider"), "model": data.get("model"),
                    "time": last_time, "tool_count": len(tools), "tool_names": [t["name"] for t in tools],
                    "schema_bytes": len(encoded(tools)),
                    "tool_schema_bytes": {t["name"]: len(encoded(t)) for t in tools}, "system_bytes": len(current_system.encode()),
                    "system_sha256": digest(current_system.encode())})
            elif kind == "request/wire-size":
                pending_wire = {**ref, **data}
                wire_measurements.append(pending_wire)
            elif kind == "tool/batch-budget":
                batch_budgets.append({**ref, **data})
            elif kind == "assistant/message":
                observed_usage = data.get("usage")
                if observed_usage is not None and not isinstance(observed_usage, dict):
                    raise ValueError(f"invalid usage at {path}:{line_number}")
                usage.add(observed_usage)
                responses.append({**ref, "time": last_time, "turn": data.get("turn"), "step": data.get("step"),
                    "provider": current_header.get("provider"), "model": current_header.get("model"),
                    "finish": data.get("finish"), "usage": observed_usage,
                    "header_seq": contexts[-1]["seq"] if contexts else None,
                    "tool_count": len(current_header.get("tools", []))})
                if pending_wire and pending_wire.get("turn") == data.get("turn") and pending_wire.get("step") == data.get("step"):
                    responses[-1]["wire_seq"] = pending_wire["seq"]
                    pending_wire["response_seq"] = seq
                pending_wire = None
            elif kind == "tool/call":
                call_id, name, arguments = data.get("callId"), data.get("name"), data.get("arguments", {})
                if not isinstance(call_id, str) or not isinstance(name, str) or not isinstance(arguments, dict) or call_id in pending:
                    raise ValueError(f"invalid or overlapping tool call at {path}:{line_number}")
                argument_data = encoded(arguments)
                calls[seq] = Call(call_id, name, seq, line_number, last_time, data.get("turn"), data.get("step"),
                    argument_data.decode()[:800], arguments.get("command"), len(argument_data), digest(argument_data),
                    {"path": source_path, "line": line_number})
                pending[call_id] = seq
            elif kind == "tool/result":
                call_id = data.get("toolCallId")
                call_seq = pending.pop(call_id, None)
                if call_seq is None:
                    findings.append(Finding("orphan_tool_result", "error", "Tool result has no matching pending call", [ref]))
                else:
                    results[call_seq] = ({**ref, "time": last_time}, data)
            elif kind == "shell-task/started":
                if data.get("call_id") in pending:
                    processes[pending[data["call_id"]]] = data["task_id"]
            elif kind == "shell-task/ended":
                if isinstance(data.get("task_id"), str):
                    process_ends[data["task_id"]] = ({**ref, "time": last_time}, data)
            elif kind == "terminal/intent":
                if data.get("call_id") in pending:
                    processes[pending[data["call_id"]]] = data["terminal_id"]
            elif kind == "terminal/ended":
                state = data.get("state", {})
                if isinstance(data.get("terminal_id"), str) and isinstance(state, dict):
                    process_ends[data["terminal_id"]] = ({**ref, "time": last_time},
                        {"result": state.get("result"), "status": data.get("status"),
                         "diagnostic": state.get("error"), "pty_output": state.get("output", ""),
                         "pty_truncated": state.get("truncated", False)})
            elif kind == "turn/start":
                if type(data.get("turn")) is int and isinstance(data.get("source"), str):
                    turn_sources[data["turn"]] = data["source"]
            elif kind == "turn/end":
                source = turn_sources.get(data.get("turn")) if type(data.get("turn")) is int else None
                turns.append({**ref, "time": last_time, **data, "source": source})
                if data.get("error"):
                    findings.append(Finding("turn_error", "error", str(data["error"])[:800], [ref]))

    if header is None:
        raise ValueError(f"empty Session: {path}")
    source_hash = hasher.hexdigest()
    history = {}
    for call in calls.values():
        signature = (call.name, call.argument_sha256)
        call.repeated_from_seq = history.get(signature)
        history[signature] = call.seq
        returned = results.get(call.seq)
        if returned is None:
            findings.append(Finding("missing_tool_result", "error", f"No result for {call.name}", [{"seq": call.seq, "line": call.line}]))
            continue
        result_ref, data = returned
        call.result_seq, call.result_line, call.end_time = result_ref["seq"], result_ref["line"], result_ref["time"]
        call.result_bytes = len(encoded(data.get("content", [])))
        call.protocol_error = data.get("isError") is True
        observed = payload_of(data)
        # Compare the returned observation, not a later lifecycle fact. Preserve
        # all shell fields except known timing noise; polling remains observable.
        if call.name in ("Bash", "shell") and observed:
            observed = {key: value for key, value in observed.items() if key not in ("durationMs", "elapsed_ms")}
            if isinstance(observed.get("result"), dict):
                observed["result"] = {key: value for key, value in observed["result"].items() if key not in ("durationMs", "elapsed_ms")}
        else:
            observed = data.get("content", [])
        # A pointer or truncated preview cannot establish equality of full results.
        partial = observed.get("truncated") is True if isinstance(observed, dict) else False
        partial = partial or "Full formatted result stored at:" in text_blocks(data) or any(
            isinstance(value, dict) and value.get("truncated") is True
            for value in payload_of(data).values())
        call.result_sha256 = None if partial else digest(encoded([call.protocol_error, observed]))
        body = payload_of(data)
        payload = body.get("result", body)
        payload = payload if isinstance(payload, dict) else {}
        # A running tool receipt is superseded by its actual process lifecycle.
        process_id = processes.get(call.seq)
        ended = process_ends.get(process_id)
        is_process_invocation = bool(process_id) or call.name in ("Bash", "shell", "TerminalOpen", "terminal_open")
        terminal_state = body.get("state") if isinstance(body.get("state"), dict) else None
        owner_state = body
        if ended:
            process_ref, shell = ended
            owner_state = shell
            payload = shell.get("result", {})
            if not isinstance(payload, dict) or not payload:
                payload = {}
                findings.append(Finding("shell_result_unobserved", "warning", "Process ended without a recorded result", [process_ref]))
            if "pty_output" in shell:
                payload = {**payload, "stdout": {"text": shell["pty_output"], "truncated": shell["pty_truncated"]}}
            call.process_end_seq, call.process_end_line = process_ref["seq"], process_ref["line"]
            call.end_time = process_ref["time"]
        elif call.name in ("TerminalOpen", "terminal_open") and terminal_state is not None:
            # A completed receipt already carries process evidence even if the
            # asynchronous terminal/ended record is absent from this snapshot.
            observed_result = terminal_state.get("result")
            payload = observed_result if isinstance(observed_result, dict) else {}
            payload = {**payload, "stdout": {"text": stream_text(terminal_state.get("output")),
                "truncated": terminal_state.get("truncated") is True}}
        if is_process_invocation:
            call.lifecycle_status = owner_state.get("status") if isinstance(owner_state.get("status"), str) else None
            call.lifecycle_diagnostic = owner_state.get("diagnostic") if isinstance(owner_state.get("diagnostic"), str) else None
            call.lifecycle_failure = call.lifecycle_status == "failed"
            call.cleanup_uncertain = payload.get("cleanupUncertain") is True
        if not is_process_invocation and ("exitCode" in payload or body.get("kind") == "shell" or terminal_state):
            # TaskOutput/TaskStop report another process's state; a successful
            # stop/read invocation is not itself an aborted shell execution.
            call.observed_task_state = {"status": body.get("status"), "exit_code": payload.get("exitCode"),
                "timed_out": payload.get("timedOut"), "aborted": payload.get("aborted"),
                "diagnostic": body.get("diagnostic"), "cleanup_uncertain": payload.get("cleanupUncertain")}
            if terminal_state:
                call.observed_task_state = {"running": terminal_state.get("running"),
                    "result": terminal_state.get("result"), "truncated": terminal_state.get("truncated")}
        call.exit_code = payload.get("exitCode") if type(payload.get("exitCode")) is int else None
        call.timed_out, call.aborted = payload.get("timedOut") is True, payload.get("aborted") is True
        call.execution_failure = is_process_invocation and call.exit_code is not None and call.exit_code != 0
        stdout, stderr = stream_text(payload.get("stdout")), stream_text(payload.get("stderr"))
        output = "\n".join(part for part in (stdout, stderr) if part)
        if not output:
            output = stream_text(payload.get("output")) or text_blocks(data)
        call.output_bytes = len(output.encode())
        call.output_preview = output[:800]
        call.stdout_sha256 = digest(stdout.encode())
        call.truncated = any(isinstance(payload.get(key), dict) and payload[key].get("truncated") is True
                             for key in ("stdout", "stderr", "output"))
        if call.truncated:
            call.result_sha256 = None
        if not is_process_invocation:
            call.exit_code, call.timed_out, call.aborted = None, False, False
        if call.timed_out or call.aborted:
            call.status = "interrupted"
        elif call.protocol_error or call.execution_failure or call.lifecycle_failure:
            call.status = "failed"
        elif (ended or (terminal_state and terminal_state.get("running") is False)) and is_process_invocation and call.exit_code is None:
            call.status = "unobserved"
        elif call.exit_code == 0:
            call.status = "succeeded"
        elif is_process_invocation and (body.get("status") == "running" or (terminal_state and terminal_state.get("running") is True)):
            call.status = "running"
        else:
            call.status = "returned"
        if call.exit_code == 0 and is_process_invocation:
            call.validation_signals = validation_signals(output)
        if call.name in ("ToolSearch", "tool_search") and type(body.get("total")) is int:
            call.discovery_total = body["total"]
            if call.discovery_total == 0:
                findings.append(Finding("empty_tool_search", "warning", "Tool discovery returned no matches; no tools activated",
                    [{"seq": call.seq, "line": call.line}, {"seq": call.result_seq, "line": call.result_line}]))
        for review in reviews or []:
            if review.get("source_sha256") != source_hash or review.get("result_seq") != call.result_seq:
                continue
            if review.get("stdout_sha256") != call.stdout_sha256:
                raise ValueError(f"review stdout hash mismatch: {path}:{call.result_line}")
            if review.get("verdict") not in ("failed", "not-failure"):
                raise ValueError("review verdict must be failed or not-failure")
            call.review = review
            call.reviewed_validation_failure = review["verdict"] == "failed"
        start, end = timestamp(call.time), timestamp(call.end_time)
        if start and end and end >= start:
            call.duration_ms = round((end - start).total_seconds() * 1000, 3)
    for call in calls.values():
        if call.repeated_from_seq is not None:
            previous = calls[call.repeated_from_seq]
            call.repeated_result = ("unknown" if call.result_sha256 is None or previous.result_sha256 is None
                                    else "unchanged" if call.result_sha256 == previous.result_sha256 else "changed")
    advertised = set(name for context in contexts for name in context["tool_names"])
    used = set(call.name for call in calls.values())
    context_by_seq = {context["seq"]: context for context in contexts}
    for context in contexts:
        context["unused_in_session"] = sorted(set(context["tool_names"]) - used)
        context["unused_schema_bytes"] = sum(context["tool_schema_bytes"][name] for name in context["unused_in_session"])
    for response in responses:
        context = context_by_seq.get(response["header_seq"])
        response["schema_bytes"] = context["schema_bytes"] if context else None
        response["unused_schema_bytes"] = context["unused_schema_bytes"] if context else None
    if advertised - used:
        findings.append(Finding("unused_tool_declarations", "opportunity",
            f"{len(advertised - used)}/{len(advertised)} advertised tools unused; evaluate deferred loading separately",
            [{"seq": context["seq"], "line": context["line"]} for context in contexts]))
    if usage.unreported_completions or counts["assistant/attempt"]:
        findings.append(Finding("usage_coverage_gap", "warning",
            "Some completions or failed/interrupted attempts have no complete provider usage; totals cover recorded usage only"))
    call_values = [asdict(call) for call in calls.values()]
    usage_summary = usage.summary()
    usage_summary["usage_complete"] = usage_summary["usage_complete"] and counts["assistant/attempt"] == 0
    label = label_for(path)
    if header.get("parentSession"):
        label += "/subagent:" + header["id"][-8:]
    return {"id": header["id"], "label": label,
        "parent_session": header.get("parentSession"), "origin": header.get("origin"),
        "delegation_depth": header.get("delegationDepth", 0),
        "source": {"path": source_path, "sha256": source_hash, "bytes": size}, "workspace": header.get("cwd"),
        "started_at": header.get("createdAt"), "ended_at": last_time,
        "raw_events": event_count, "event_counts": dict(counts), "usage": usage_summary,
        "responses": responses, "contexts": contexts, "wire_measurements": wire_measurements, "batch_budgets": batch_budgets, "calls": call_values, "turns": turns,
        "findings": [asdict(finding) for finding in findings], "counts": count_calls(call_values),
        "failed_or_interrupted_attempt_records": counts["assistant/attempt"]}


def count_calls(calls: list[dict]) -> dict:
    return {"tool_calls": len(calls), "matched_results": sum(c["result_seq"] is not None for c in calls),
        "protocol_errors": sum(c["protocol_error"] for c in calls),
        "execution_failures": sum(c["execution_failure"] for c in calls),
        "lifecycle_failures": sum(c["lifecycle_failure"] for c in calls),
        "failed_calls": sum(c["protocol_error"] or c["execution_failure"] or c["lifecycle_failure"] for c in calls),
        "interrupted_calls": sum(c["status"] == "interrupted" for c in calls),
        "running_calls": sum(c["status"] == "running" for c in calls),
        "unobserved_process_results": sum(c["status"] == "unobserved" for c in calls),
        "missing_results": sum(c["result_seq"] is None for c in calls),
        "zero_exit_validation_candidates": sum(bool(c["validation_signals"]) for c in calls),
        "reviewed_validation_failures": sum(c["reviewed_validation_failure"] for c in calls),
        "empty_tool_searches": sum(c["discovery_total"] == 0 for c in calls),
        "repeated_identical_calls": sum(c["repeated_from_seq"] is not None for c in calls),
        "repeated_changed_results": sum(c["repeated_result"] == "changed" for c in calls),
        "repeated_unchanged_results": sum(c["repeated_result"] == "unchanged" for c in calls),
        "repeated_unknown_results": sum(c["repeated_result"] == "unknown" for c in calls),
        "truncated_results": sum(c["truncated"] for c in calls),
        "argument_bytes": sum(c["argument_bytes"] for c in calls),
        "result_bytes": sum(c["result_bytes"] for c in calls)}


def build_report(paths: list[Path], reviews: list[dict] | None = None) -> dict:
    sessions = []
    seen = {}
    duplicates = []
    for path in paths:
        session = inspect_session(path, reviews)
        key = session["id"]
        if key in seen:
            if seen[key] != session["source"]["sha256"]:
                raise ValueError(f"conflicting copies of Session {key}; select one explicit snapshot")
            duplicates.append(session["source"]["path"])
            continue
        seen[key] = session["source"]["sha256"]
        sessions.append(session)
    usage = Usage()
    all_calls = []
    tools = {}
    for session in sessions:
        for response in session["responses"]:
            usage.add(response["usage"])
        all_calls.extend(session["calls"])
        for call in session["calls"]:
            tools.setdefault(call["name"], []).append(call)
    usage_summary = usage.summary()
    usage_summary["usage_complete"] = usage_summary["usage_complete"] and not any(s["failed_or_interrupted_attempt_records"] for s in sessions)
    return {"schema_version": 1, "kind": "pero-session-report",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "semantics": {"usage_source": "committed assistant/message.data.usage only; chunks, receipts and attempts are not added; totals are recorded usage, not a complete invoice",
            "input_tokens": "Pero normalized uncached input; add cache_read_tokens to obtain prompt tokens",
            "cache_write_tokens": "descriptive subfield; not an additional prompt token lane",
            "reasoning_tokens": "included in output_tokens; do not add twice",
            "bytes": "compact UTF-8 JSON/text sizes, not provider tokens; request/wire-size fields alone measure actual serialized provider body bytes",
            "wire_measurements": "prepared_for_http, not proof of sending or billing; each record is a separate preparation, including failed attempts; tool-result message bytes use the actual selected request after compaction/replacement",
            "schema_exposure": "compact declared tool JSON bytes per committed response; unused means never called in that Session; not provider tokens or causal waste",
            "repeated_result": "same arguments classified by returned observation; missing, spilled or truncated evidence is unknown, not unchanged",
            "validation_signals": "heuristic review candidates, not confirmed failures; raw output may quote source or expected errors",
            "task_outcome": "not inferred from stop or tool success; use an external judge/acceptance receipt",
            "cost_usd": "unknown; no authoritative pricing or missing-usage estimate"},
        "summary": {"sessions": len(sessions), "raw_events": sum(s["raw_events"] for s in sessions),
            "responses": sum(len(s["responses"]) for s in sessions), "usage": usage_summary,
            "schema_exposure_bytes": sum(r["schema_bytes"] or 0 for s in sessions for r in s["responses"]),
            "unused_schema_exposure_bytes": sum(r["unused_schema_bytes"] or 0 for s in sessions for r in s["responses"]),
            "prepared_requests_measured": sum(len(s["wire_measurements"]) for s in sessions),
            "prepared_payload_bytes": sum(w.get("payload_bytes", 0) for s in sessions for w in s["wire_measurements"]),
            "retained_tool_result_message_bytes": sum(w.get("tool_result_message_bytes", 0) for s in sessions for w in s["wire_measurements"]),
            "batch_budget_misses": sum(b.get("met") is False for s in sessions for b in s["batch_budgets"]),
            **count_calls(all_calls), "turn_errors": sum(bool(t.get("error")) for s in sessions for t in s["turns"]),
            "turn_errors_by_source": dict(Counter(t.get("source") or "unknown"
                for s in sessions for t in s["turns"] if t.get("error"))),
            "failed_or_interrupted_attempt_records": sum(s["failed_or_interrupted_attempt_records"] for s in sessions)},
        "tools": [{"name": name, **count_calls(calls)} for name, calls in sorted(tools.items())],
        "duplicates_skipped": duplicates, "sessions": sessions}


def md_text(value: object) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ").replace("\r", " ")


def markdown(report: dict) -> str:
    summary, sessions = report["summary"], report["sessions"]
    usage = summary["usage"]
    total = f'{usage["total_tokens"]:,}' if usage["total_tokens"] is not None else f'unknown ({usage["known_total_tokens"]:,} reported)'
    lines = ["# Pero Session summary", "", f'{len(sessions)} sessions; {summary["responses"]} committed responses; '
        f'{summary["tool_calls"]} tool calls / {summary["matched_results"]} matched results.', "",
        f'Native turn errors: {summary["turn_errors"]}; by source: '
        f'{json.dumps(summary["turn_errors_by_source"], sort_keys=True)}. '
        'These are separate from an external benchmark verdict.', "",
        f'Provider-reported total tokens: **{total}**. Uncached input: {usage["input_tokens"]:,}; '
        f'cache read: {usage["cache_read_tokens"]:,}; output: {usage["output_tokens"]:,}.', "",
        f'Explicit tool/process failures: **{summary["failed_calls"]}** '
        f'(isError={summary["protocol_errors"]}; nonzero exit={summary["execution_failures"]}; owner failure={summary["lifecycle_failures"]}; overlapping counts). '
        f'Interrupted: {summary["interrupted_calls"]}; running: {summary["running_calls"]}; missing returns: {summary["missing_results"]}.', "",
        f'Zero-exit validation signals requiring review: **{summary["zero_exit_validation_candidates"]}**; '
        f'hash-bound reviewed failures: {summary["reviewed_validation_failures"]}. These are separate from explicit tool failures.', "",
        f'Empty tool searches: **{summary["empty_tool_searches"]}**; repeated identical calls: {summary["repeated_identical_calls"]}. '
        'These are recovery/optimization signals, not additional failed invocations.', "",
        f'Repeated results: {summary["repeated_changed_results"]} changed; {summary["repeated_unchanged_results"]} unchanged; '
        f'{summary["repeated_unknown_results"]} unknown. Declared schema exposure: {summary["schema_exposure_bytes"]:,} compact JSON bytes; '
        f'{summary["unused_schema_exposure_bytes"]:,} from tools never called in that Session.', "",
        f'Prepared requests measured: {summary["prepared_requests_measured"]}; serialized payload bytes: {summary["prepared_payload_bytes"]:,}; '
        f'retained tool-result message bytes across those requests: {summary["retained_tool_result_message_bytes"]:,}; '
        f'batch budget misses: {summary["batch_budget_misses"]}. Missing boundary records are unobserved, not zero-cost requests.', "",
        "Usage covers committed provider reports. Failed requests may have unknown usage. Reasoning is included in output; "
        "cache writes are not an additional token lane. Byte measurements below are not token estimates. Task acceptance comes from the external judge.", "",
        "## Sessions", "", "| Session | Tokens | Calls | Failed | Interrupted | Validation signals |",
        "| --- | ---: | ---: | ---: | ---: | ---: |"]
    for session in sessions:
        counts = session["counts"]
        lines.append(f'| [{md_text(session["label"])}](<{session["source"]["path"]}>) | '
            f'{session["usage"]["total_tokens"] if session["usage"]["total_tokens"] is not None else "unknown"} | '
            f'{counts["tool_calls"]} | {counts["failed_calls"]} | {counts["interrupted_calls"]} | {counts["zero_exit_validation_candidates"]} |')
    lines += ["", "## Failures and validation candidates", "", "| Session / source | Tool | State | Evidence |", "| --- | --- | --- | --- |"]
    for session in sessions:
        for call in session["calls"]:
            if not (call["protocol_error"] or call["execution_failure"] or call["lifecycle_failure"] or call["status"] in ("interrupted", "running", "missing_return", "unobserved") or call["validation_signals"] or call["reviewed_validation_failure"]):
                continue
            evidence = "; ".join(s["evidence_excerpt"][-160:] for s in call["validation_signals"])
            evidence = evidence or call["lifecycle_diagnostic"] or call["output_preview"][-180:] or "See source result/process lifecycle"
            state = f'{call["status"]}; exit={call["exit_code"]}'
            if call["lifecycle_status"]:
                state += "; owner=" + call["lifecycle_status"]
            if call["cleanup_uncertain"]:
                state += "; cleanup uncertain"
            if call["validation_signals"]:
                state += "; validation review required"
            if call["review"]:
                state += "; reviewed=" + call["review"]["verdict"]
            lines.append(f'| [{md_text(session["label"])} seq {call["seq"]}→{call["result_seq"]}]'
                f'(<{session["source"]["path"]}:{call["line"]}>) | {md_text(call["name"])} | {md_text(state)} | {md_text(evidence)} |')
        for finding in session["findings"]:
            if finding["kind"] == "turn_error":
                ref = finding["refs"][0]
                lines.append(f'| [{md_text(session["label"])} seq {ref["seq"]}](<{session["source"]["path"]}:{ref["line"]}>) | turn | error | {md_text(finding["message"])} |')
    lines += ["", "## Recovery and coverage findings", "", "| Session | Finding | Count | Evidence |", "| --- | --- | ---: | --- |"]
    for session in sessions:
        kinds = sorted({f["kind"] for f in session["findings"]} - {"unused_tool_declarations", "turn_error"})
        for kind in kinds:
            group = [f for f in session["findings"] if f["kind"] == kind]
            refs = [r for f in group for r in f["refs"]]
            links = ", ".join(f'[seq {r["seq"]}](<{session["source"]["path"]}:{r["line"]}>)' for r in refs[:8])
            lines.append(f'| {md_text(session["label"])} | {kind} | {len(group)} | {links or md_text(group[0]["message"])} |')
    lines += ["", "## Tool traffic", "", "| Tool | Calls | Failed | Repeated identical calls | Argument bytes | Result bytes |", "| --- | ---: | ---: | ---: | ---: | ---: |"]
    for tool in sorted(report["tools"], key=lambda x: x["result_bytes"] + x["argument_bytes"], reverse=True):
        lines.append(f'| {md_text(tool["name"])} | {tool["tool_calls"]} | {tool["failed_calls"]} | '
            f'{tool["repeated_identical_calls"]} | {tool["argument_bytes"]:,} | {tool["result_bytes"]:,} |')
    lines += ["", "## Optimization evidence", "", "Repeated identical arguments are candidates for review; edits or changing process state may justify repetition. "
        "Result/argument bytes rank local traffic, not billable tokens or avoidable cost.", ""]
    for session in sessions:
        if session["contexts"]:
            context = session["contexts"][0]
            unused = set(name for c in session["contexts"] for name in c["tool_names"]) - set(c["name"] for c in session["calls"])
            lines.append(f'- {md_text(session["label"])}: first catalog {context["tool_count"]} tools / '
                f'{context["schema_bytes"]:,} compact JSON bytes; {len(unused)} advertised tools unused; '
                f'{session["counts"]["repeated_identical_calls"]} repeated calls. Evaluate `--defer-tool-loading` with a separate run.')
    return "\n".join(lines) + "\n"


def discover(inputs: list[Path]) -> list[Path]:
    candidates = set()
    for source in inputs:
        if source.is_file():
            candidates.add(source.resolve())
        elif source.is_dir():
            for path in source.rglob("*.jsonl"):
                with path.open("rb") as handle:
                    first = handle.readline()
                try:
                    record = json.loads(first)
                except ValueError:
                    continue
                if isinstance(record, dict) and isinstance(record.get("header"), dict):
                    candidates.add(path.resolve())
        else:
            raise ValueError(f"input does not exist: {source}")
    if not candidates:
        raise ValueError("no native Pero Session JSONL found in the explicit inputs")
    return sorted(candidates)


def write_report(inputs: list[Path], output: Path, reviews: list[dict] | None = None) -> dict:
    report = build_report(discover(inputs), reviews)
    report["analyzer"] = {"path": str(Path(__file__).resolve()), "sha256": digest(Path(__file__).read_bytes())}
    output.mkdir(parents=True, exist_ok=True)
    (output / "summary.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    (output / "summary.md").write_text(markdown(report))
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="+", type=Path, help="explicit native Session files or directories (recursive)")
    parser.add_argument("--output", required=True, type=Path, help="directory for summary.json and summary.md")
    parser.add_argument("--reviews", type=Path, help="optional JSON list of source/stdout hash-bound manual verdicts")
    parser.add_argument("--better-harness", type=Path, help="optionally also render Inspector HTML using this local checkout (requires Node)")
    options = parser.parse_args()
    try:
        reviews = json.loads(options.reviews.read_text()) if options.reviews else None
        if reviews is not None and not isinstance(reviews, list):
            raise ValueError("reviews must be a JSON list")
        report = write_report(options.inputs, options.output, reviews)
        inspector = None
        if options.better_harness:
            bridge = subprocess.run(["node", str(Path(__file__).with_name("inspector.mjs")),
                "--summary", str(options.output / "summary.json"), "--better-harness", str(options.better_harness),
                "--output", str(options.output / "inspector.html")], capture_output=True, text=True)
            if bridge.returncode:
                raise ValueError("summary saved, Inspector export failed: " + bridge.stderr[-1000:])
            inspector = json.loads(bridge.stdout)
    except (ValueError, OSError) as error:
        parser.exit(1, f"session-report: {error}\n")
    print(json.dumps({"summary": report["summary"], "output": str(options.output.resolve()),
                      "inspector": inspector}, ensure_ascii=False))


if __name__ == "__main__":
    main()
