import unittest
from dataclasses import replace
import json
from pathlib import Path
import tempfile

from acp import read_usage
from core import ArtifactMatch, CleanupResult, SessionReceipt, SessionSpec, TrialConfig, TrialError, Usage, pipeline_succeeded, session_succeeded


def config_input():
    return {"plugin_path": "/fixture/plugin", "workspace": "/fixture/workspace", "agent_binary": "/fixture/agent",
            "endpoint": "http://127.0.0.1:1234/v1", "model": "fixture", "api_key_env": "TRIAL_FIXTURE_KEY",
            "prompt": "Create a report", "success_patterns": ["reports/one.md", "reports/two.md"]}


class TrialRules(unittest.TestCase):
    def test_endpoint_requires_an_explicit_http_opt_in(self):
        for endpoint, allow_http, accepted in (
            ("https://provider.invalid/v1", False, True),
            ("http://provider.invalid/v1", False, False),
            ("http://provider.invalid/v1", True, True),
            ("http://127.0.0.1/v1", False, True),
            ("ftp://provider.invalid/v1", True, False),
            ("http://u:p@provider.invalid/v1", True, False),
            ("http://provider.invalid/v1?key=fixture", True, False),
            ("http://provider.invalid/v1#fragment", True, False),
            ("https://provider.invalid/v1", "true", False),
        ):
            with self.subTest(endpoint=endpoint, allow_http=allow_http):
                supplied = config_input() | {"endpoint": endpoint, "allow_http": allow_http}
                if accepted:
                    TrialConfig.parse(supplied)
                else:
                    with self.assertRaises(TrialError):
                        TrialConfig.parse(supplied)

    def test_usage_jsonl_preserves_unicode_and_rejects_broken_records(self):
        event = {"event": {"type": "assistant/message", "data": {
            "message": "legal\u0085NEL\u2028line\u2029paragraph",
            "usage": {"inputTokens": 11, "outputTokens": 3, "totalTokens": 14}}}}
        valid = json.dumps(event, ensure_ascii=False).encode() + b"\n"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sessions").mkdir()
            path = root / "sessions/one.jsonl"
            path.write_bytes(valid)
            self.assertEqual(read_usage(root), Usage(11, 3, 14, reported_completions=1))
            for invalid in (valid.replace(b"legal", b"broken\nrecord"), valid + b"{incomplete\n"):
                path.write_bytes(invalid)
                with self.assertRaises(ValueError):
                    read_usage(root)

    def test_completion_requires_all_patterns_and_normal_end(self):
        all_found = (ArtifactMatch("one", ("one",)), ArtifactMatch("two", ("two",)))
        for label, matches, stop, fatal, want in [
            ("all artifacts", all_found, "end_turn", False, True),
            ("second missing", (all_found[0], ArtifactMatch("two", ())), "end_turn", False, False),
            ("cancelled with files", all_found, "cancelled", False, False),
            ("fatal with files", all_found, "end_turn", True, False),
            ("no patterns", (), "end_turn", False, False),
        ]:
            with self.subTest(label):
                self.assertEqual(session_succeeded(matches, stop, fatal), want)

    def test_usage_includes_compactions_once_and_marks_unknown_attempts(self):
        known = {"inputTokens": 4, "outputTokens": 2, "totalTokens": 6}
        events = [
            ("assistant/message", {"usage": known}),
            ("compaction/response", {"compactionId": "one", "usage": known}),
            ("compaction/summary", {"compactionId": "one", "usage": known}),
            ("compaction/response", {"compactionId": "two", "usage": known}),
            ("compaction/end", {"compactionId": "two", "error": "rejected"}),
            ("compaction/summary", {"compactionId": "legacy", "usage": known}),
        ]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sessions").mkdir()
            path = root / "sessions/one.jsonl"

            def write():
                path.write_text("".join(json.dumps({"event": {"type": kind, "data": data}}) + "\n"
                                        for kind, data in events))

            write()
            self.assertEqual(read_usage(root), Usage(16, 8, 24, reported_completions=4))
            events += [("compaction/end", {"compactionId": "old-failed", "error": "rejected"}),
                       ("assistant/attempt", {})]
            write()
            self.assertEqual(read_usage(root), Usage(16, 8, None, reported_completions=4, unreported_attempts=2))
            for identity in (None, "", 1):
                events.append(("compaction/response", {"compactionId": identity, "usage": known}))
                write()
                with self.subTest(identity=identity), self.assertRaises(TrialError):
                    read_usage(root)
                events.pop()

    def test_unsupported_configuration_fails_before_execution(self):
        for change in ({"budget": 1}, {"budget": float("nan")}, {"max_retries": 1}, {"max_retries": False},
                       {"sessions": []}, {"enable_shell": True}, {"unattended_questions": "auto"},
                       {"idle_timeout": 0}, {"max_requests": 0}, {"success_patterns": ["../outside"]},
                       {"permission_mode": "bypassPermissions"}, {"permission_mode": True},
                       {"api_format": "unknown"}, {"api_format": "responses"}, {"disable_streaming": "true"}):
            with self.subTest(change=change):
                with self.assertRaises(TrialError):
                    TrialConfig.parse(config_input() | change)

    def test_explicit_policies_and_session_identity(self):
        config = TrialConfig.parse(config_input() | {"unattended_questions": "first-option", "enable_shell": True,
                                                    "shell_policy": "allow-unsandboxed", "max_continuations": 0})
        self.assertTrue(config.enable_shell)
        self.assertEqual(config.sessions[0].max_continuations, 0)
        responses = TrialConfig.parse(config_input() | {"api_format": "responses", "disable_streaming": True})
        self.assertEqual(responses.api_format, "responses")
        self.assertTrue(responses.disable_streaming)
        with self.assertRaises(TrialError):
            SessionSpec.parse({"name": "../escape", "prompt": "go", "success_artifact": "report.md"})

    def test_pipeline_completion_rechecks_final_requirements(self):
        found = (ArtifactMatch("report.md", ("report.md",)),)
        missing = (ArtifactMatch("report.md", ()),)
        receipt = SessionReceipt("one", "id", 1, "fixture", 0, True, 0, False, 0, (), "journal", "sessions",
                                 "end_turn", "", found, Usage(), 0, {})
        for label, receipts, count, matches, fatal, want in (
            ("complete", (receipt,), 1, found, False, True),
            ("final artifact removed", (receipt,), 1, missing, False, False),
            ("declared session not run", (receipt,), 2, found, False, False),
            ("session failed", (replace(receipt, success=False),), 1, found, False, False),
            ("final matching failed", (receipt,), 1, found, True, False),
        ):
            with self.subTest(label):
                self.assertEqual(pipeline_succeeded(receipts, count, matches, fatal), want)
        supplied = config_input()
        supplied.pop("prompt")
        supplied.update(sessions=[{"name": "one", "prompt": "write", "success_artifact": "report.md"}],
                        success_patterns=["../outside.md"])
        with self.assertRaises(TrialError):
            TrialConfig.parse(supplied)

    def test_cleanup_requires_observed_successful_shutdown(self):
        for label, result, want in (
            ("clean exit", CleanupResult(True, 0, ()), True),
            ("nonzero exit without RPC error", CleanupResult(True, 1, ()), False),
            ("RPC failed despite zero exit", CleanupResult(True, 0, ("ACP session/close failed",)), False),
            ("exit unconfirmed", CleanupResult(True, None, ()), False),
            ("resource cleanup failed", CleanupResult(True, 0, ("trial journal cleanup failed",)), False),
        ):
            with self.subTest(label):
                self.assertEqual(result.succeeded, want)


if __name__ == "__main__":
    unittest.main()
