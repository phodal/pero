"""Nonoverlapping observed recovery windows, separate from acceptance or causality."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from usage import Usage


def operation(call: dict) -> tuple:
    # Full invocation arguments conservatively preserve directory, process and
    # execution-mode differences. A changed timeout may therefore stay unresolved.
    return (call["name"], call["argument_sha256"])



@dataclass
class RecoveryWindow:
    turn: int | None
    start_seq: int
    start_time: str | None
    calls: list[dict] = field(default_factory=list)
    unresolved: set = field(default_factory=set)

    def observe(self, call: dict) -> None:
        self.calls.append(call)
        failed = any(call.get(key) for key in ("protocol_error", "execution_failure", "lifecycle_failure", "reviewed_validation_failure"))
        if failed or call.get("status") in ("missing_return", "interrupted", "unobserved", "running"):
            self.unresolved.add(operation(call))
        elif (call.get("status") == "succeeded" or call.get("status") == "returned" and not call.get("command") and call["name"] not in ("Bash","shell","TerminalOpen","terminal_open")) and not call.get("cleanup_uncertain"):
            self.unresolved.discard(operation(call))

    def finish(self, end_seq, end_time, outcome, responses, wire, gaps, compaction_gaps) -> dict:
        selected = [r for r in responses if self.start_seq < r["seq"] <= end_seq]
        prepared = [w for w in wire if self.start_seq < w["seq"] <= end_seq]
        missing = [g for g in gaps if self.start_seq < g["seq"] <= end_seq]
        missing_compactions = [g for g in compaction_gaps if self.start_seq < g["seq"] <= end_seq]
        agent, compaction = Usage(), Usage()
        for response in selected:
            (compaction if response["purpose"] == "compaction" else agent).add(response["usage"])
        total = Usage()
        for response in selected:
            total.add(response["usage"])
        usage = total.summary()
        usage["usage_complete"] = usage["usage_complete"] and not missing and not missing_compactions
        # Failed/prepared requests can lack a committed response. Unknown usage
        # must not appear as zero even when all committed response totals exist.
        matched = {r.get("wire_seq") for r in selected}
        unmatched = [w["seq"] for w in prepared if w["seq"] not in matched]
        if missing or missing_compactions or unmatched:
            usage["total_tokens"] = None
            usage["usage_complete"] = False
        duration = None
        if self.start_time and end_time:
            try:
                delta = (datetime.fromisoformat(end_time.replace("Z", "+00:00")) -
                         datetime.fromisoformat(self.start_time.replace("Z", "+00:00"))).total_seconds()
                if delta >= 0:
                    duration = round(delta * 1000, 3)
            except ValueError:
                pass
        categories = {}
        for call in self.calls:
            diagnostic = call.get("diagnostic") or {}
            if diagnostic.get("category"):
                category = diagnostic["category"]
                categories[category] = categories.get(category, 0) + 1
        return {"turn": self.turn, "start_seq": self.start_seq, "end_seq": end_seq,
                "outcome": outcome, "duration_ms": duration,
                "call_seqs": [c["seq"] for c in self.calls],
                "response_seqs": [r["seq"] for r in selected],
                "failed_operations": sum(any(c.get(k) for k in ("protocol_error", "execution_failure", "lifecycle_failure", "reviewed_validation_failure")) for c in self.calls),
                "unresolved_operations": len(self.unresolved), "diagnostic_categories": categories,
                "diagnostic_fingerprints": sorted({c["diagnostic"]["diagnostic_sha256"] for c in self.calls if (c.get("diagnostic") or {}).get("diagnostic_sha256")}),
                "committed_responses": len(selected), "prepared_requests": len(prepared),
                "unmatched_prepared_seqs": unmatched,
                "unreported_attempt_records": len(missing), "unreported_compaction_failures": len(missing_compactions),
                "usage": usage, "agent_usage": agent.summary(), "compaction_usage": compaction.summary()}


def build_recovery(calls, responses, turns, wire, gaps, last_time, last_seq, compaction_gaps=()) -> dict:
    chains = []
    active = None
    # Observe settled receipts, not invocation ordering: parallel calls can
    # finish in either order. Running receipts stay unresolved until trace end.
    timeline = [(c.get("process_end_seq") or c.get("result_seq") or c["seq"], 0, c) for c in calls]
    timeline += [(t["seq"], 1, t) for t in turns]
    for seq, kind, item in sorted(timeline, key=lambda x:(x[0], x[1])):
        if active and (kind == 1 or item.get("turn") != active.turn):
            chains.append(active.finish(seq if kind==1 else item["seq"]-1, item.get("time"), "unresolved-at-turn-end", responses, wire, gaps, compaction_gaps))
            active = None
        if kind == 1:
            continue
        failed = any(item.get(k) for k in ("protocol_error", "execution_failure", "lifecycle_failure", "reviewed_validation_failure"))
        if active and failed and operation(item) not in active.unresolved:
            chains.append(active.finish(seq, item.get("end_time"), "unresolved-at-different-failure", responses, wire, gaps, compaction_gaps))
            active = None
        if active is None and failed:
            active = RecoveryWindow(item.get("turn"), seq, item.get("end_time") or item.get("time"))
        if active:
            active.observe(item)
            if not active.unresolved:
                chains.append(active.finish(seq, item.get("end_time"), "matching-operation-succeeded", responses, wire, gaps, compaction_gaps))
                active = None
    if active:
        chains.append(active.finish(last_seq, last_time, "unresolved-at-trace-end", responses, wire, gaps, compaction_gaps))
    assigned = {seq for c in chains for seq in c["response_seqs"]}
    return {"chains": chains, "outside_chain_response_seqs": [r["seq"] for r in responses if r["seq"] not in assigned]}
