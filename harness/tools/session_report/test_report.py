import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest

from report import build_report, inspect_session, write_report


class SessionReportRules(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def session(self, events, name="one.jsonl", session_id="fixture-session"):
        records = [{"header": {"version": 0, "id": session_id,
                               "createdAt": "2026-11-04T08:00:00Z", "cwd": "/fixture/work"}}]
        for seq, (kind, data) in enumerate(events, 1):
            if kind == "assistant/message":
                data = {"turn": 1, "step": 1, "finish": "stop",
                        "message": {"role": "assistant", "content": [{"type": "text", "text": "fixture"}]}, **data}
            records.append({"event": {"seq": seq, "time": f"2026-11-04T08:00:{seq:02d}Z",
                                      "type": kind, "data": data}})
        path = self.root / name
        path.write_bytes(b"".join(json.dumps(record, ensure_ascii=False).encode("utf-8") + b"\n"
                                  for record in records))
        return path

    @staticmethod
    def call(call_id="call-1", name="Bash", command="python check.py"):
        return "tool/call", {"callId": call_id, "name": name, "turn": 1, "step": 1,
                             "arguments": {"command": command}}

    @staticmethod
    def result(payload, call_id="call-1", is_error=False):
        return "tool/result", {"type": "tool-result", "toolCallId": call_id, "isError": is_error,
                               "content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}]}

    def test_repeat_results_are_changed_unchanged_or_unknown(self):
        events = []
        for i, value in enumerate(("one", "two", "two", "Full formatted result stored at: /saved/output")):
            events += [self.call(str(i), "Read", "same"), self.result({"text": value}, str(i))]
        events.append(self.call("missing", "Read", "same"))
        report = build_report([self.session(events)])
        calls = report["sessions"][0]["calls"]
        self.assertEqual([c["repeated_result"] for c in calls], [None, "changed", "unchanged", "unknown", "unknown"])
        self.assertEqual(tuple(report["summary"][name] for name in (
            "repeated_changed_results", "repeated_unchanged_results", "repeated_unknown_results")), (1, 1, 2))

    def test_boundary_measurements_use_selected_wire_not_raw_result_history(self):
        tools = [{"name": "Read", "inputSchema": {"type": "object"}},
                 {"name": "Agent", "inputSchema": {"type": "object"}}]
        path = self.session([
            ("request/header", {"tools": tools}),
            ("request/wire-size", {"stage": "prepared_for_http", "turn": 1, "step": 1,
                                   "payload_bytes": 500, "tool_result_message_bytes": 0}),
            ("assistant/message", {"step": 1}),
            self.call("read", "Read", "same"), self.result({"text": "x" * 10000}, "read"),
            # The actual next request may replace or compact the raw result.
            ("request/wire-size", {"stage": "prepared_for_http", "turn": 1, "step": 2,
                                   "payload_bytes": 600, "tool_result_message_bytes": 120}),
            ("assistant/message", {"step": 2}),
            ("tool/batch-budget", {"met": False, "before_bytes": 10000, "after_bytes": 10000}),
        ])
        report = build_report([path])
        summary = report["summary"]
        self.assertEqual((summary["prepared_requests_measured"], summary["prepared_payload_bytes"],
                          summary["retained_tool_result_message_bytes"], summary["batch_budget_misses"]), (2, 1100, 120, 1))
        session = report["sessions"][0]
        self.assertEqual([w["response_seq"] for w in session["wire_measurements"]], [3, 7])
        self.assertEqual([r["wire_seq"] for r in session["responses"]], [2, 6])
        self.assertEqual(session["contexts"][0]["unused_in_session"], ["Agent"])
        self.assertEqual(summary["schema_exposure_bytes"], session["contexts"][0]["schema_bytes"] * 2)
        self.assertEqual(summary["unused_schema_exposure_bytes"], session["contexts"][0]["tool_schema_bytes"]["Agent"] * 2)

    def test_only_committed_messages_count_usage_and_inherit_header(self):
        first = {"inputTokens": 7, "cacheReadTokens": 11, "cacheWriteTokens": 13,
                 "outputTokens": 17, "reasoningTokens": 5, "totalTokens": 35}
        second = {"inputTokens": 2, "cacheReadTokens": 3, "outputTokens": 5, "totalTokens": 10}
        path = self.session([
            ("request/header", {"turn": 1, "step": 1, "provider": "configured", "model": "deepseek-fixture",
                                "tools": [{"name": "Bash", "inputSchema": {"type": "object"}}]}),
            ("assistant/chunk", {"turn": 1, "step": 1, "chunk": {"usage": first}}),
            ("assistant/message", {"turn": 1, "step": 1, "usage": first}),
            ("assistant/chunk", {"turn": 1, "step": 1, "chunk": {"usage": second}}),
            # Retries can reuse turn/step. Durable messages remain distinct observations.
            ("assistant/message", {"turn": 1, "step": 1, "usage": second}),
        ])
        report = build_report([path])
        usage = report["summary"]["usage"]
        self.assertEqual((usage["input_tokens"], usage["cache_read_tokens"], usage["output_tokens"]), (9, 14, 22))
        self.assertEqual((usage["prompt_tokens"], usage["derived_total_tokens"], usage["total_tokens"]), (23, 45, 45))
        self.assertEqual((usage["cache_write_tokens"], usage["reasoning_tokens"]), (13, 5))
        self.assertEqual(usage["reported_completions"], 2)
        session = report["sessions"][0]
        self.assertEqual(len(session["contexts"]), 1)
        self.assertEqual([(r["model"], r["header_seq"]) for r in session["responses"]],
                         [("deepseek-fixture", 1), ("deepseek-fixture", 1)])

    def test_missing_and_null_usage_or_total_remain_unknown(self):
        for label, data, unreported, missing_total in [
            ("missing usage", {}, 1, 0),
            ("null usage", {"usage": None}, 1, 0),
            ("missing total", {"usage": {"inputTokens": 4, "outputTokens": 2}}, 0, 1),
            ("null total", {"usage": {"inputTokens": 4, "outputTokens": 2, "totalTokens": None}}, 0, 1),
        ]:
            with self.subTest(label=label):
                report = build_report([self.session([("assistant/message", data)])])
                usage = report["summary"]["usage"]
                self.assertIsNone(usage["total_tokens"])
                self.assertEqual(usage["known_total_tokens"], 0)
                self.assertEqual(usage["unreported_completions"], unreported)
                self.assertEqual(usage["totals_unreported"], missing_total)
                if unreported:
                    self.assertFalse(usage["usage_complete"])

    def test_unreported_attempt_marks_coverage_gap_without_adding_chunk_usage(self):
        known = {"inputTokens": 4, "outputTokens": 2, "totalTokens": 6}
        path = self.session([
            ("assistant/message", {"turn": 1, "step": 1, "usage": known}),
            ("assistant/chunk", {"turn": 1, "step": 2, "chunk": {"usage": known}}),
            ("assistant/attempt", {"turn": 1, "step": 2}),
        ])
        report = build_report([path])
        for usage in (report["summary"]["usage"], report["sessions"][0]["usage"]):
            self.assertEqual(usage["known_total_tokens"], 6)
            self.assertFalse(usage["usage_complete"])
            self.assertTrue(usage["committed_response_usage_complete"])
        self.assertEqual(report["summary"]["failed_or_interrupted_attempt_records"], 1)
        self.assertIn("usage_coverage_gap", {f["kind"] for f in report["sessions"][0]["findings"]})

    def test_final_shell_lifecycle_supersedes_running_receipt(self):
        for label, terminal, status, execution_failure in [
            ("nonzero", {"exitCode": 7, "stdout": {"text": "failed"}}, "failed", True),
            ("aborted", {"exitCode": None, "aborted": True}, "interrupted", False),
            ("timeout", {"exitCode": None, "timedOut": True}, "interrupted", False),
            ("completed", {"exitCode": 0, "stdout": {"text": "ok"}}, "succeeded", False),
            ("still running", None, "running", False),
        ]:
            with self.subTest(label=label):
                events = [self.call(),
                          ("shell-task/started", {"task_id": "task-1", "call_id": "call-1"}),
                          self.result({"task_id": "task-1", "status": "running", "output_file_partial": True})]
                if terminal is not None:
                    events.append(("shell-task/ended", {"task_id": "task-1", "status": "completed", "result": terminal}))
                session = inspect_session(self.session(events))
                call = session["calls"][0]
                self.assertEqual(call["status"], status)
                self.assertEqual(call["execution_failure"], execution_failure)
                self.assertEqual(call["process_end_seq"], 4 if terminal is not None else None)
                self.assertEqual(session["counts"]["failed_calls"], int(execution_failure))
                self.assertEqual(session["counts"]["interrupted_calls"], int(status == "interrupted"))

    def test_call_matching_and_protocol_errors_are_independent_of_exit_status(self):
        path = self.session([
            self.call("first", name="Write"), self.call("second"),
            self.result({"exitCode": 0, "stdout": {"text": "ok"}}, call_id="second"),
            self.result({"error": "outside workspace"}, call_id="first", is_error=True),
            self.result({"exitCode": 0}, call_id="orphan"), self.call("missing"),
            ("tool/call", {"callId": "search", "name": "ToolSearch", "arguments": {"query": "select:TerminalOpen"}}),
            self.result({"tools": [], "total": 0}, call_id="search"),
        ])
        session = inspect_session(path)
        calls = {call["id"]: call for call in session["calls"]}
        self.assertEqual((calls["first"]["result_seq"], calls["first"]["status"]), (4, "failed"))
        self.assertTrue(calls["first"]["protocol_error"])
        self.assertFalse(calls["first"]["execution_failure"])
        self.assertEqual((calls["second"]["result_seq"], calls["second"]["status"]), (3, "succeeded"))
        self.assertEqual(calls["missing"]["status"], "missing_return")
        self.assertEqual((session["counts"]["tool_calls"], session["counts"]["matched_results"]), (4, 3))
        self.assertEqual({f["kind"] for f in session["findings"]},
                         {"orphan_tool_result", "missing_tool_result", "empty_tool_search"})
        self.assertEqual(calls["search"]["discovery_total"], 0)
        self.assertFalse(calls["search"]["protocol_error"])
        self.assertFalse(calls["search"]["execution_failure"])
        self.assertEqual(session["counts"]["empty_tool_searches"], 1)
        self.assertEqual(next(f for f in session["findings"] if f["kind"] == "empty_tool_search")["severity"], "warning")

    def test_owner_failure_preserves_exit_diagnostic_and_counts_union_once(self):
        for label, exit_code, protocol_error in [("zero exit", 0, False),
                                                  ("missing exit", None, False),
                                                  ("overlapping evidence", 7, True)]:
            with self.subTest(label=label):
                ended = {"exitCode": exit_code, "cleanupUncertain": True, "stdout": {"text": "process output"}}
                path = self.session([
                    self.call(),
                    ("shell-task/started", {"task_id": "task-1", "call_id": "call-1"}),
                    self.result({"task_id": "task-1", "status": "running"}, is_error=protocol_error),
                    ("shell-task/ended", {"task_id": "task-1", "status": "failed",
                        "diagnostic": "preserve shell output failed", "result": ended}),
                    self.call("read", name="TaskOutput"),
                    self.result({"task_id": "task-1", "kind": "shell", "status": "failed",
                        "diagnostic": "preserve shell output failed", "result": ended}, call_id="read"),
                ])
                session = inspect_session(path)
                opened, observed = session["calls"]
                self.assertEqual(opened["status"], "failed")
                self.assertEqual(opened["exit_code"], exit_code)
                self.assertEqual(opened["protocol_error"], protocol_error)
                self.assertEqual(opened["execution_failure"], exit_code == 7)
                self.assertTrue(opened["lifecycle_failure"])
                self.assertEqual(opened["lifecycle_status"], "failed")
                self.assertEqual(opened["lifecycle_diagnostic"], "preserve shell output failed")
                self.assertTrue(opened["cleanup_uncertain"])
                self.assertEqual((session["counts"]["failed_calls"], session["counts"]["lifecycle_failures"]), (1, 1))
                self.assertFalse(observed["lifecycle_failure"])
                self.assertEqual(observed["observed_task_state"]["diagnostic"], "preserve shell output failed")
                self.assertEqual(observed["observed_task_state"]["exit_code"], exit_code)

    def test_reused_call_id_matches_each_completed_invocation_but_rejects_overlap(self):
        first = self.call("reused", command="first")
        second_kind, second_data = self.call("reused", command="second")
        second = second_kind, second_data | {"step": 2}
        first_result = {"exitCode": 0, "stdout": {"text": "first"}}
        second_result = {"exitCode": 9, "stdout": {"text": "second"}}
        for label, events, expected_refs in [
            ("sequential returns", [
                first, self.result(first_result, "reused"),
                second, self.result(second_result, "reused"),
            ], [(1, 2, None), (3, 4, None)]),
            ("independent background lifecycles", [
                first,
                ("shell-task/started", {"task_id": "first-task", "call_id": "reused"}),
                self.result({"status": "running"}, "reused"),
                second,
                ("shell-task/started", {"task_id": "second-task", "call_id": "reused"}),
                self.result({"status": "running"}, "reused"),
                ("shell-task/ended", {"task_id": "second-task", "result": second_result}),
                ("shell-task/ended", {"task_id": "first-task", "result": first_result}),
            ], [(1, 3, 8), (4, 6, 7)]),
            ("overlapping pending calls", [first, second], None),
        ]:
            with self.subTest(label=label):
                path = self.session(events)
                if expected_refs is None:
                    with self.assertRaisesRegex(ValueError, "overlapping tool call"):
                        inspect_session(path)
                    continue
                session = inspect_session(path)
                calls = session["calls"]
                self.assertEqual([(c["seq"], c["result_seq"], c["process_end_seq"]) for c in calls], expected_refs)
                self.assertEqual([(c["id"], c["step"], c["status"], c["output_preview"]) for c in calls],
                                 [("reused", 1, "succeeded", "first"), ("reused", 2, "failed", "second")])
                self.assertEqual((session["counts"]["tool_calls"], session["counts"]["matched_results"]), (2, 2))
                self.assertEqual(session["counts"]["execution_failures"], 1)
                self.assertFalse(session["findings"])

    def test_observing_or_stopping_shell_does_not_duplicate_its_interruption(self):
        path = self.session([
            self.call(),
            ("shell-task/started", {"task_id": "task-1", "call_id": "call-1"}),
            self.result({"task_id": "task-1", "kind": "shell", "status": "running"}),
            self.call("read", name="TaskOutput"),
            self.result({"task_id": "task-1", "kind": "shell", "status": "running"}, call_id="read"),
            self.call("stop", name="TaskStop"),
            self.result({"task_id": "task-1", "kind": "shell", "status": "stopped",
                         "result": {"exitCode": None, "aborted": True}}, call_id="stop"),
            ("shell-task/ended", {"task_id": "task-1", "status": "stopped",
                                  "result": {"exitCode": None, "aborted": True}}),
        ])
        session = inspect_session(path)
        calls = {call["id"]: call for call in session["calls"]}
        self.assertEqual(calls["call-1"]["status"], "interrupted")
        self.assertEqual((session["counts"]["interrupted_calls"], session["counts"]["running_calls"]), (1, 0))
        self.assertEqual(calls["read"]["observed_task_state"]["status"], "running")
        self.assertTrue(calls["stop"]["observed_task_state"]["aborted"])
        for call_id in ("read", "stop"):
            self.assertEqual(calls[call_id]["status"], "returned")
            self.assertIsNone(calls[call_id]["exit_code"])
            self.assertFalse(calls[call_id]["aborted"])

    def test_ended_shell_without_result_remains_unobserved(self):
        for label, ended in [("null", {"result": None}), ("missing", {})]:
            with self.subTest(label=label):
                path = self.session([
                    self.call(),
                    ("shell-task/started", {"task_id": "task-1", "call_id": "call-1"}),
                    self.result({"task_id": "task-1", "status": "running"}),
                    ("shell-task/ended", {"task_id": "task-1", "status": "stopped", **ended}),
                ])
                session = inspect_session(path)
                self.assertNotIn(session["calls"][0]["status"], ("running", "succeeded"))
                self.assertIsNone(session["calls"][0]["exit_code"])
                self.assertIn("shell_result_unobserved", {f["kind"] for f in session["findings"]})

    def test_terminal_open_uses_final_process_state_without_double_counting_reads(self):
        for label, result, status, failures, interrupted in [
            ("nonzero", {"exitCode": 1}, "failed", 1, 0),
            ("completed", {"exitCode": 0}, "succeeded", 0, 0),
            ("aborted", {"exitCode": None, "aborted": True}, "interrupted", 0, 1),
            ("unknown result", None, "unobserved", 0, 0),
        ]:
            with self.subTest(label=label):
                final = {"output": "process output\r\n", "truncated": False, "running": False, "result": result}
                path = self.session([
                    self.call(name="TerminalOpen"),
                    ("terminal/intent", {"terminal_id": "pty-1", "call_id": "call-1", "turn": 1,
                                         "command": "python check.py", "cwd": "/fixture/work"}),
                    self.result({"terminal_id": "pty-1", "state": {"output": "starting", "truncated": False, "running": True}}),
                    ("terminal/ended", {"terminal_id": "pty-1", "state": final}),
                    ("tool/call", {"callId": "read", "name": "TerminalRead", "turn": 1, "step": 2,
                                   "arguments": {"terminal_id": "pty-1", "offset": 0}}),
                    self.result({"terminal_id": "pty-1", "state": final}, call_id="read"),
                ])
                session = inspect_session(path)
                opened, read = session["calls"]
                self.assertEqual((opened["status"], opened["process_end_seq"], opened["result_seq"]), (status, 4, 3))
                self.assertEqual(opened["output_preview"], final["output"])
                self.assertEqual((session["counts"]["execution_failures"], session["counts"]["failed_calls"],
                                  session["counts"]["interrupted_calls"], session["counts"]["running_calls"]),
                                 (failures, failures, interrupted, 0))
                self.assertEqual(read["status"], "returned")
                self.assertFalse(read["execution_failure"])
                self.assertFalse(read["aborted"])
                self.assertIsNone(read["exit_code"])
                self.assertEqual(read["observed_task_state"]["result"], result)

    def test_zero_exit_pty_validation_is_a_candidate_and_preserves_truncation(self):
        for label, output, truncated, signal in [
            ("unittest footer", "Ran 2 tests\r\n\r\nFAILED (failures=1)\r\n", False, "unittest_failed"),
            ("truncated footer", "FAIL: test_api (check.ContractTests)\r\nAssertionError: mismatch\r\n", True, "unittest_case_failed"),
            ("expected error", "caught expected ValueError\r\nok\r\n", False, None),
        ]:
            with self.subTest(label=label):
                final = {"output": output, "truncated": truncated, "running": False, "result": {"exitCode": 0}}
                path = self.session([
                    self.call(name="TerminalOpen"),
                    ("terminal/intent", {"terminal_id": "pty-1", "call_id": "call-1", "turn": 1,
                                         "command": "python check.py", "cwd": "/fixture/work"}),
                    self.result({"terminal_id": "pty-1", "state": {"output": "", "truncated": False, "running": True}}),
                    ("terminal/ended", {"terminal_id": "pty-1", "state": final}),
                    ("tool/call", {"callId": "read", "name": "TerminalRead", "arguments": {"terminal_id": "pty-1"}}),
                    self.result({"terminal_id": "pty-1", "state": final}, call_id="read"),
                ])
                session = inspect_session(path)
                opened, read = session["calls"]
                self.assertEqual(opened["status"], "succeeded")
                self.assertEqual(opened["output_preview"], output)
                self.assertEqual(opened["truncated"], truncated)
                self.assertFalse(opened["reviewed_validation_failure"])
                self.assertEqual(session["counts"]["failed_calls"], 0)
                self.assertEqual(session["counts"]["zero_exit_validation_candidates"], int(signal is not None))
                self.assertFalse(read["validation_signals"])
                self.assertEqual(read["observed_task_state"]["truncated"], truncated)
                kinds = {s["kind"] for s in opened["validation_signals"]}
                if signal:
                    self.assertIn(signal, kinds)
                    self.assertTrue(all(s["confidence"] == "review_required" for s in opened["validation_signals"]))
                else:
                    self.assertFalse(kinds)

    def test_terminal_completed_receipt_remains_evidence_without_ended_event(self):
        for label, result, status, failures in [("nonzero", {"exitCode": 7}, "failed", 1),
                                                ("completed", {"exitCode": 0}, "succeeded", 0),
                                                ("unknown", None, "unobserved", 0)]:
            with self.subTest(label=label):
                state = {"output": "receipt process output\r\n", "truncated": True,
                         "running": False, "result": result}
                session = inspect_session(self.session([
                    self.call(name="TerminalOpen"),
                    ("terminal/intent", {"terminal_id": "pty-1", "call_id": "call-1"}),
                    self.result({"terminal_id": "pty-1", "state": state}),
                    self.call("read", name="TerminalRead"),
                    self.result({"terminal_id": "pty-1", "state": state}, call_id="read"),
                ]))
                opened, observed = session["calls"]
                self.assertEqual(opened["status"], status)
                self.assertEqual(opened["exit_code"], result["exitCode"] if result else None)
                self.assertEqual(opened["output_preview"], state["output"])
                self.assertTrue(opened["truncated"])
                self.assertIsNone(opened["process_end_seq"])
                self.assertFalse(opened["protocol_error"])
                self.assertEqual(session["counts"]["failed_calls"], failures)
                self.assertEqual(observed["status"], "returned")
                self.assertFalse(observed["execution_failure"])
                self.assertIsNone(observed["exit_code"])

    def test_zero_exit_validation_evidence_requires_review(self):
        for label, output, expected_signal in [
            ("unittest footer", "Ran 2 tests\n\nFAILED (failures=1)\n", "unittest_failed"),
            ("unittest truncated footer", "FAIL: test_add (check.ContractTests)\nAssertionError: mismatch\n", "unittest_case_failed"),
            ("traceback", 'Traceback (most recent call last):\n  File "check.py", line 1\nAssertionError: mismatch\n', "python_traceback"),
            ("printed exit", "exit=2\n", "printed_nonzero_exit"),
            ("uppercase exit", "EXIT=1\n", "printed_nonzero_exit"),
            ("mixed case exit", "Exit=124\n", "printed_nonzero_exit"),
            ("successful exit", "EXIT=0\n", None),
            ("quoted exit", 'print("EXIT=1")\n', None),
            ("printed source", '    raise SyntaxError("invalid input")\n', None),
            ("caught expected error", "caught ValueError: expected\nok\n", None),
            ("empty unittest", "Ran 0 tests in 0.000s\n\nOK\n", "empty_test_suite"),
            ("empty doctest", "0 tests in 2 items.\n0 passed and 0 failed.\nTest passed.\n", "empty_test_suite"),
            ("empty pytest", "collected 0 items\n\nno tests ran in 0.01s\n", "empty_test_suite"),
            ("pytest summary", "========= no tests ran in 0.01s =========\n", "empty_test_suite"),
            ("nonempty suite", "Ran 10 tests in 0.001s\n\nOK\n", None),
            ("zero failures", "10 passed and 0 failed.\n", None),
            # Quoted or expected tracebacks may look real; candidates still cannot confirm a failure.
            ("quoted traceback", 'Traceback (most recent call last):\nValueError: expected\nok\n', "python_traceback"),
        ]:
            with self.subTest(label=label):
                session = inspect_session(self.session([self.call(), self.result({"exitCode": 0, "stdout": {"text": output}})]))
                call = session["calls"][0]
                self.assertEqual(call["status"], "succeeded")
                self.assertFalse(call["reviewed_validation_failure"])
                self.assertEqual(session["counts"]["failed_calls"], 0)
                kinds = {signal["kind"] for signal in call["validation_signals"]}
                if expected_signal:
                    self.assertIn(expected_signal, kinds)
                else:
                    self.assertEqual(kinds, set())
                self.assertTrue(all(s["confidence"] == "review_required" for s in call["validation_signals"]))

    def test_invalid_usage_counters_are_rejected_instead_of_silently_counted(self):
        for key, value in [("inputTokens", True), ("outputTokens", -1),
                           ("cacheReadTokens", None), ("totalTokens", False)]:
            with self.subTest(key=key, value=value):
                path = self.session([("assistant/message", {"usage": {key: value}})])
                with self.assertRaisesRegex(ValueError, "usage field"):
                    inspect_session(path)

    def test_reviews_bind_source_snapshot_result_sequence_and_stdout(self):
        output = "FAILED (errors=1)\n"
        path = self.session([self.call(), self.result({"exitCode": 0, "stdout": {"text": output}})])
        review = {"source_sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "result_seq": 2,
                  "stdout_sha256": hashlib.sha256(output.encode()).hexdigest(), "verdict": "failed"}
        confirmed = inspect_session(path, [review])
        self.assertEqual(confirmed["counts"]["reviewed_validation_failures"], 1)
        self.assertEqual(confirmed["counts"]["failed_calls"], 0)
        for label, changed, expected_count in [
            ("other source", {"source_sha256": "0" * 64}, 0),
            ("other result", {"result_seq": 1}, 0),
            ("not a failure", {"verdict": "not-failure"}, 0),
        ]:
            with self.subTest(label=label):
                self.assertEqual(inspect_session(path, [review | changed])["counts"]["reviewed_validation_failures"], expected_count)
        with self.assertRaisesRegex(ValueError, "stdout hash mismatch"):
            inspect_session(path, [review | {"stdout_sha256": "0" * 64}])
        with self.assertRaisesRegex(ValueError, "review verdict"):
            inspect_session(path, [review | {"verdict": "probably"}])

    def test_unicode_line_separators_remain_inside_json_records(self):
        output = "中文\u0085NEL\u2028line\u2029paragraph"
        path = self.session([self.call(command="printf '中文\u2028'"),
                             self.result({"exitCode": 0, "stdout": {"text": output}})])
        session = inspect_session(path)
        self.assertEqual(session["raw_events"], 2)
        call = session["calls"][0]
        self.assertEqual((call["line"], call["result_line"]), (2, 3))
        self.assertEqual(call["output_preview"], output)
        self.assertEqual(call["stdout_sha256"], hashlib.sha256(output.encode()).hexdigest())

    def test_identical_session_copies_are_counted_once_and_conflicts_rejected(self):
        path = self.session([("assistant/message", {"usage": {"inputTokens": 4, "outputTokens": 2, "totalTokens": 6}})])
        copy = self.root / "copy.jsonl"
        shutil.copyfile(path, copy)
        report = build_report([path, copy])
        self.assertEqual((report["summary"]["sessions"], report["summary"]["responses"]), (1, 1))
        self.assertEqual(report["summary"]["usage"]["total_tokens"], 6)
        self.assertEqual(report["duplicates_skipped"], [str(copy.resolve())])
        conflicting = self.session([("assistant/message", {"usage": {"inputTokens": 5, "outputTokens": 2, "totalTokens": 7}})],
                                   name="changed.jsonl")
        with self.assertRaisesRegex(ValueError, "conflicting copies of Session"):
            build_report([path, conflicting])

    def test_write_report_round_trips_json_and_keeps_markdown_semantics(self):
        path = self.session([self.call(), self.result({"exitCode": 0, "stdout": {"text": "FAILED (errors=1)"}})])
        output = self.root / "report"
        report = write_report([path], output)
        self.assertEqual(json.loads((output / "summary.json").read_text()), report)
        markdown = (output / "summary.md").read_text()
        self.assertIn("requiring review", markdown)
        self.assertIn("not token estimates", markdown)
        self.assertIn(str(path.resolve()), markdown)


if __name__ == "__main__":
    unittest.main()
