from contextlib import contextmanager
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import subprocess
import shlex
import sys
import tempfile
import threading
import time
import unittest

from core import TrialError
from run_trial import artifact_matches, copy_context, parse_config, run_pipeline


def tool(name, arguments):
    return {"choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "id": "trial-tool", "type": "function",
            "function": {"name": name, "arguments": json.dumps(arguments)}}]}, "finish_reason": "tool_calls"}]}


@contextmanager
def provider(dispatch):
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            response = dispatch(request)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for value in response:
                try:
                    self.wfile.write(("data: " + json.dumps(value) + "\n\n").encode())
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    return
            try:
                self.wfile.write(b"data: [DONE]\n\n")
            except (BrokenPipeError, ConnectionResetError):
                pass

        def log_message(self, *_args):
            pass
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield "http://127.0.0.1:" + str(server.server_port) + "/v1"
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def answer(message="done"):
    return {"choices": [{"index": 0, "delta": {"content": message}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 11, "completion_tokens": 3, "total_tokens": 14}}


@unittest.skipUnless(os.name == "posix", "real trial cleanup requires Unix process groups")
class RuntimeTrial(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.build = tempfile.TemporaryDirectory()
        cls.binary = Path(cls.build.name) / "pero-agent-acp"
        root = Path(__file__).resolve().parents[3]
        subprocess.run(["go", "build", "-o", str(cls.binary), "./cmd/pero-agent-acp"], cwd=root / "harness/go", check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.build.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.plugin = self.root / "plugin"
        (self.plugin / ".claude-plugin").mkdir(parents=True)
        (self.plugin / ".claude-plugin/plugin.json").write_text('{"name":"sample","version":"1.0.0"}')
        skill = self.plugin / "skills/report/SKILL.md"
        skill.parent.mkdir(parents=True)
        skill.write_text("---\nname: report\ndescription: Create verified reports\ndisable-model-invocation: true\n---\ntrial-skill $ARGUMENTS\n")
        self.old_key = os.environ.get("TRIAL_FIXTURE_KEY")
        os.environ["TRIAL_FIXTURE_KEY"] = "loopback-trial-credential"
        self.addCleanup(self.restore_key)

    def restore_key(self):
        if self.old_key is None:
            os.environ.pop("TRIAL_FIXTURE_KEY", None)
        else:
            os.environ["TRIAL_FIXTURE_KEY"] = self.old_key

    def config(self, endpoint, **changes):
        return parse_config({"plugin_path": str(self.plugin), "workspace": str(self.root), "agent_binary": str(self.binary),
                             "endpoint": endpoint, "model": "fixture", "api_key_env": "TRIAL_FIXTURE_KEY", "prompt": "/sample:report topic",
                             "success_patterns": ["reports/one.md", "reports/two.md"], "max_continuations": 1,
                             "idle_timeout": 5, "session_timeout": 15, **changes})

    def assert_reclaimed(self, result):
        with self.assertRaises(ProcessLookupError):
            os.kill(result["sessions"][0]["agent_pid"], 0)

    def test_explicit_auto_review_renders_unmatched_skill_commands(self):
        skill = self.plugin / "skills/report/SKILL.md"
        skill.write_text('---\nname: report\ndescription: Dynamic context\ndisable-model-invocation: true\n---\nsnapshot !`printf trial-inline-context`\n')
        for permission, shell_enabled in (("full-access", True), ("auto-review", True), ("auto-review", False)):
            with self.subTest(permission=permission, shell_enabled=shell_enabled):
                calls = []

                def dispatch(request):
                    calls.append(request)
                    if len(calls) == 1:
                        self.assertIn("trial-inline-context", str(request["messages"]))
                        self.assertNotIn("!`printf", str(request["messages"]))
                        return [tool("Write", {"file_path": "reports/one.md", "content": "one"})]
                    if len(calls) == 2:
                        return [tool("Write", {"file_path": "reports/two.md", "content": "two"})]
                    return [answer()]

                with provider(dispatch) as endpoint:
                    options = {"permission_mode": permission, "enable_shell": shell_enabled, "max_continuations": 0}
                    if shell_enabled:
                        options["shell_policy"] = "allow-unsandboxed"
                    result = run_pipeline(self.config(endpoint, **options))
                self.assertEqual(result["permission_mode"], permission)
                if permission == "auto-review" and shell_enabled:
                    self.assertTrue(result["pipeline_complete"])
                    self.assertEqual(len(calls), 3)
                else:
                    self.assertFalse(result["pipeline_complete"])
                    self.assertEqual(len(calls), 0)
                events = [json.loads(line) for line in Path(result["journal_path"]).read_text().splitlines()]
                self.assertFalse(any(row.get("type") == "PermissionDecision" for row in events))
                self.assert_reclaimed(result)

    def test_real_plugin_questions_continuation_write_and_usage(self):
        calls = []
        def dispatch(request):
            calls.append(request)
            index = len(calls)
            if index == 1:
                self.assertIn("trial-skill topic", str(request["messages"]))
                return [tool("AskUserQuestion", {"questions": [{"question": "Choose format", "header": "Format", "options": [{"label": "Markdown", "description": "Write Markdown"}, {"label": "Text", "description": "Write text"}], "multiSelect": False}]})]
            if index == 2:
                self.assertIn("Markdown", str(request["messages"]))
                return [tool("Write", {"file_path": "reports/one.md", "content": "first report"})]
            if index == 3:
                return [answer("first saved")]
            if index == 4:
                self.assertIn("Required artifacts are still missing: reports/two.md", str(request["messages"]))
                return [tool("Write", {"file_path": "reports/two.md", "content": "second report"})]
            return [answer()]
        with provider(dispatch) as endpoint:
            result = run_pipeline(self.config(endpoint, unattended_questions="first-option"))
        self.assertTrue(result["pipeline_complete"], result)
        self.assertEqual(result["continuations"], 1)
        self.assertEqual(result["http_attempts"], 5)
        self.assertEqual(result["usage"]["reported_completions"], 2)
        self.assertEqual(result["usage"]["input_tokens"], 22)
        self.assertEqual(result["usage"]["unreported_completions"], 3)
        self.assertIsNone(result["usage"]["total_tokens"])
        self.assertIsNone(result["cost_usd"])
        self.assertEqual(result["pattern_artifacts"], {"reports/one.md": 1, "reports/two.md": 1})
        self.assertEqual(result["interactions"][0]["answers"], {"Choose format": "Markdown"})
        self.assertEqual(result["trace_summary"]["status"], "complete", result["trace_summary"])
        trace = json.loads((Path(result["trace_summary"]["output"]) / "summary.json").read_text())
        self.assertEqual(trace["summary"]["responses"], 5)
        self.assertEqual(trace["summary"]["usage"]["input_tokens"], result["usage"]["input_tokens"])
        self.assertEqual(trace["summary"]["usage"]["unreported_completions"], 3)
        self.assertIsNone(trace["summary"]["usage"]["total_tokens"])
        self.assertEqual(trace["summary"]["tool_calls"], sum(result["tool_summary"].values()))
        self.assert_reclaimed(result)

    def test_jsonl_unicode_separators_preserve_output_and_usage(self):

        value = "before\u0085NEL\u2028line\u2029paragraph after"
        calls = []

        def dispatch(request):
            calls.append(request)
            if len(calls) == 1:
                return [dict(tool("Write", {"file_path": "report.md", "content": value}),
                             usage={"prompt_tokens": 11, "completion_tokens": 3, "total_tokens": 14})]
            return [answer(value)]

        with provider(dispatch) as endpoint:
            result = run_pipeline(self.config(endpoint, success_patterns=["report.md"], max_continuations=0))
        self.assertTrue(result["pipeline_complete"], result)
        self.assertEqual(Path(result["workspace"], "report.md").read_text(), value)
        self.assertEqual(result["usage"]["reported_completions"], 2)
        self.assertEqual(result["usage"]["total_tokens"], 28)
        with Path(result["journal_path"]).open() as source:
            events = [json.loads(line) for line in source]
        previews = [block.get("preview", "") for event in events for block in event.get("blocks", [])]
        self.assertIn(value, "".join(previews))
        self.assert_reclaimed(result)

    def test_idle_after_effect_is_not_success_or_retried(self):
        calls, release = [], threading.Event()
        def dispatch(request):
            calls.append(request)
            if len(calls) == 1:
                return [tool("Write", {"file_path": "reports/one.md", "content": "write exactly once"})]
            def hung():
                release.wait(10)
                yield answer()
            return hung()
        with provider(dispatch) as endpoint:
            try:
                result = run_pipeline(self.config(endpoint, success_patterns=["reports/one.md"], idle_timeout=0.5))
            finally:
                release.set()
        self.assertFalse(result["pipeline_complete"])
        self.assertFalse(result["success"])
        self.assertTrue(result["sessions"][0]["timed_out"])
        self.assertEqual(len(calls), 2)
        self.assertEqual((Path(result["workspace"]) / "reports/one.md").read_text(), "write exactly once")
        self.assert_reclaimed(result)

    def test_pipeline_does_not_claim_unrun_sessions(self):
        def dispatch(_request):
            return [answer("no artifact")]
        sessions = [{"name": name, "prompt": "create report", "success_artifact": name + ".md", "max_continuations": 0} for name in ("first", "second")]
        with provider(dispatch) as endpoint:
            raw = {"plugin_path": str(self.plugin), "workspace": str(self.root), "agent_binary": str(self.binary), "endpoint": endpoint,
                   "model": "fixture", "api_key_env": "TRIAL_FIXTURE_KEY", "sessions": sessions}
            result = run_pipeline(parse_config(raw))
        self.assertFalse(result["pipeline_complete"])
        self.assertEqual(len(result["sessions"]), 1)
        self.assert_reclaimed(result)

    def test_budget_and_question_cancellation_remain_failure_after_write(self):
        for mode in ("request cap", "question cancelled"):
            with self.subTest(mode=mode):
                calls = []
                def dispatch(request):
                    calls.append(request)
                    if len(calls) == 1:
                        return [tool("Write", {"file_path": "reports/one.md", "content": "retained evidence"})]
                    return [tool("AskUserQuestion", {"questions": [{"question": "Choose next", "header": "Next", "options": [{"label": "Continue", "description": "Continue work"}, {"label": "Stop", "description": "Stop work"}], "multiSelect": False}]})]
                with provider(dispatch) as endpoint:
                    result = run_pipeline(self.config(endpoint, success_patterns=["reports/one.md"],
                                                      max_requests=1 if mode == "request cap" else 8))
                self.assertFalse(result["pipeline_complete"], result)
                self.assertFalse(result["success"])
                self.assertEqual(len(calls), 1 if mode == "request cap" else 2)
                self.assertEqual((Path(result["workspace"]) / "reports/one.md").read_text(), "retained evidence")
                self.assert_reclaimed(result)

    def test_context_and_artifacts_refuse_symlink_escape(self):
        source, workspace = self.root / "source", self.root / "workspace"
        source.mkdir()
        workspace.mkdir()
        root_link = self.root / "source-link"
        root_link.symlink_to(source, target_is_directory=True)
        with self.assertRaises(TrialError):
            self.config("http://127.0.0.1:1/v1", context_source=str(root_link))
        (source / "escape").symlink_to(self.plugin, target_is_directory=True)
        with self.assertRaises(TrialError):
            copy_context(source, workspace)
        (workspace / "outside.md").symlink_to(self.plugin / ".claude-plugin/plugin.json")
        with self.assertRaises(TrialError):
            artifact_matches(workspace, ("*.md",))

    def test_pipeline_final_patterns_include_global_and_prior_sessions(self):
        for mode, want in (("global missing", False), ("prior artifact removed", False), ("global complete", True)):
            with self.subTest(mode=mode):
                calls = []
                def dispatch(request):
                    calls.append(request)
                    if len(calls) == 1:
                        return [tool("Write", {"file_path": "first.md", "content": "first"})]
                    if len(calls) == 3:
                        if mode == "prior artifact removed":
                            return [tool("Bash", {"command": "rm first.md; printf second > second.md"})]
                        if mode == "global complete":
                            return [tool("Bash", {"command": "printf second > second.md; printf final > required.md"})]
                        return [tool("Write", {"file_path": "second.md", "content": "second"})]
                    return [answer()]
                sessions = [{"name": name, "prompt": "write " + name, "success_artifact": name + ".md",
                             "max_continuations": 0} for name in ("first", "second")]
                with provider(dispatch) as endpoint:
                    raw = {"plugin_path": str(self.plugin), "workspace": str(self.root), "agent_binary": str(self.binary),
                           "endpoint": endpoint, "model": "fixture", "api_key_env": "TRIAL_FIXTURE_KEY", "sessions": sessions}
                    if mode != "prior artifact removed":
                        raw["success_patterns"] = ["required.md"]
                    if mode != "global missing":
                        raw.update(enable_shell=True, shell_policy="allow-unsandboxed")
                    result = run_pipeline(parse_config(raw))
                self.assertEqual(result["pipeline_complete"], want, result)
                self.assertTrue(all(session["success"] for session in result["sessions"]), result)
                self.assertEqual(len(calls), 4)
                if mode == "global missing":
                    self.assertEqual(result["pattern_artifacts"]["required.md"], 0)
                if mode == "prior artifact removed":
                    self.assertEqual(result["pattern_artifacts"]["first.md"], 0)
                self.assert_reclaimed(result)

    def test_close_error_and_nonzero_exit_fail_after_artifact_and_reclaim_job(self):
        # Hook failures normally continue. Inject actual ACP/process failures
        # while letting the real agent own and reclaim the background job.
        binary = self.root / "close-failure-agent"
        binary.write_text("#!" + sys.executable + "\n" +
                          "import json, subprocess, sys\n" +
                          "child = subprocess.Popen([" + repr(str(self.binary)) + ", *sys.argv[1:]], stdin=subprocess.PIPE, text=True)\n" +
                          "for line in sys.stdin:\n" +
                          "    frame = json.loads(line)\n" +
                          "    if frame.get('method') == 'session/close':\n" +
                          "        frame['params']['sessionId'] = 'intentionally-unknown-session'\n" +
                          "    child.stdin.write(json.dumps(frame) + '\\n')\n" +
                          "    child.stdin.flush()\n" +
                          "child.stdin.close()\n" +
                          "child.wait()\n" +
                          "sys.exit(1)\n")
        binary.chmod(0o700)
        pid_path = self.root / "background.pid"
        calls = []
        def dispatch(request):
            calls.append(request)
            if len(calls) == 1:
                return [tool("Bash", {"command": "printf '%s' $$ > " + shlex.quote(str(pid_path)) + "; sleep 30",
                                      "run_in_background": True})]
            if len(calls) == 2:
                deadline = time.monotonic() + 3
                while not pid_path.exists() and time.monotonic() < deadline:
                    threading.Event().wait(0.005)
                self.assertTrue(pid_path.exists(), "background job did not publish readiness")
                return [tool("Write", {"file_path": "report.md", "content": "retained evidence"})]
            return [answer()]
        with provider(dispatch) as endpoint:
            result = run_pipeline(self.config(endpoint, success_patterns=["report.md"], max_continuations=0,
                                              enable_shell=True, shell_policy="allow-unsandboxed", agent_binary=str(binary)))
        receipt = result["sessions"][0]
        self.assertFalse(result["pipeline_complete"], result)
        self.assertFalse(receipt["success"])
        self.assertEqual(receipt["agent_exit_code"], 1)
        self.assertTrue(any("session/close" in failure for failure in receipt["cleanup_failures"]))
        self.assertIn("exited with code 1", receipt["diagnostic"])
        self.assertEqual(len(calls), 3)
        self.assertTrue((Path(result["workspace"]) / "report.md").is_file())
        with self.assertRaises(ProcessLookupError):
            os.kill(int(pid_path.read_text()), 0)
        self.assert_reclaimed(result)

    def test_timeout_reclaims_explicitly_allowed_shell_process(self):
        def dispatch(_request):
            return [tool("Bash", {"command": "printf '%s' $$ > bash.pid; sleep 30"})]
        with provider(dispatch) as endpoint:
            result = run_pipeline(self.config(endpoint, enable_shell=True, shell_policy="allow-unsandboxed", idle_timeout=1))
        self.assertFalse(result["success"])
        self.assertTrue(result["sessions"][0]["timed_out"])
        pid = int((Path(result["workspace"]) / "bash.pid").read_text())
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)
        self.assert_reclaimed(result)

    def test_migrated_package_entry_runs_real_acp_adapter(self):
        from migrate_plugin import migrate
        from test_migration import migration_fixture
        plan = migration_fixture(self.plugin)
        self.assertEqual(migrate(self.plugin, plan), "applied")
        calls = []
        def dispatch(request):
            calls.append(request)
            if len(calls) == 1:
                return [tool("Write", {"file_path": "report.md", "content": "from migrated entry"})]
            return [answer()]
        with provider(dispatch) as endpoint:
            supplied = {"runtime": "harness", "harness_runner": str(Path(__file__).with_name("run_trial.py")),
                        "plugin_path": str(self.plugin), "workspace": str(self.root), "agent_binary": str(self.binary),
                        "endpoint": endpoint, "model": "fixture", "api_key_env": "TRIAL_FIXTURE_KEY", "prompt": "write report",
                        "success_patterns": ["report.md"], "max_continuations": 0}
            process = subprocess.run([sys.executable, str(self.plugin / "scripts/run_trial.py")], input=json.dumps(supplied),
                                     text=True, capture_output=True, timeout=15)
        self.assertEqual(process.returncode, 0, process.stdout + process.stderr)
        result = json.loads(process.stdout)
        self.assertTrue(result["pipeline_complete"])
        self.assertEqual(result["runtime"], "pero-agent-acp")
        self.assertEqual(len(calls), 2)
        self.assert_reclaimed(result)


if __name__ == "__main__":
    unittest.main()
