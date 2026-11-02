import unittest
from dataclasses import replace

from core import ArtifactMatch, CleanupResult, SessionReceipt, SessionSpec, TrialConfig, TrialError, Usage, pipeline_succeeded, session_succeeded


def config_input():
    return {"plugin_path": "/fixture/plugin", "workspace": "/fixture/workspace", "agent_binary": "/fixture/agent",
            "endpoint": "http://127.0.0.1:1234/v1", "model": "fixture", "api_key_env": "TRIAL_FIXTURE_KEY",
            "prompt": "Create a report", "success_patterns": ["reports/one.md", "reports/two.md"]}


class TrialRules(unittest.TestCase):
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

    def test_unsupported_configuration_fails_before_execution(self):
        for change in ({"budget": 1}, {"budget": float("nan")}, {"max_retries": 1}, {"max_retries": False},
                       {"sessions": []}, {"enable_shell": True}, {"unattended_questions": "auto"},
                       {"idle_timeout": 0}, {"max_requests": 0}, {"success_patterns": ["../outside"]}):
            with self.subTest(change=change):
                with self.assertRaises(TrialError):
                    TrialConfig.parse(config_input() | change)

    def test_explicit_policies_and_session_identity(self):
        config = TrialConfig.parse(config_input() | {"unattended_questions": "first-option", "enable_shell": True,
                                                    "shell_policy": "allow-unsandboxed", "max_continuations": 0})
        self.assertTrue(config.enable_shell)
        self.assertEqual(config.sessions[0].max_continuations, 0)
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
