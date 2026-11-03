#!/usr/bin/env python3
"""Prepare an isolated coder review fixture, optionally execute a real ACP trial."""

import argparse
from dataclasses import asdict
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
from textwrap import dedent

from core import TrialError
from run_trial import parse_config, run_session


def plugin_digest(root: Path) -> str:
    snapshot = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if path.is_file():
            snapshot.update(path.relative_to(root).as_posix().encode() + b"\0")
            snapshot.update(path.read_bytes())
            snapshot.update(b"\0")
    return snapshot.hexdigest()


def prepare(source: Path, base: Path, node_binary: str) -> Path:
    """Use the original preparation/provenance/selection scripts, never a fake verdict."""
    plugin = base / 'plugin'
    shutil.copytree(source, plugin, ignore=shutil.ignore_patterns('.git', '__pycache__'))
    workspace = base / 'workspace'
    workspace.mkdir(mode=0o700)
    idea = workspace / '.review' / 'labels'
    for directory in ('tasks', 'task-reports', 'cr'):
        (idea / directory).mkdir(parents=True)
    node = node_binary
    def run(*args):
        return subprocess.run(args,cwd=workspace,text=True,capture_output=True,check=True).stdout.strip()
    run('git', 'init', '-b', 'main')
    run('git', 'config', 'user.name', 'Acceptance Fixture')
    run('git', 'config', 'user.email', 'acceptance@example.invalid')
    (workspace/'.gitignore').write_text('__pycache__/\n.review/\n.pero/\n')
    (workspace/'labels.py').write_text('def normalize_label(value: str) -> str:\n    return value.strip()\n')
    (workspace/'test_labels.py').write_text('import unittest\nfrom labels import normalize_label\n\nclass ExistingLabelTest(unittest.TestCase):\n    def test_trim(self):\n        self.assertEqual(normalize_label(" a "), "a")\n\n    def test_case(self):\n        self.assertEqual(normalize_label(" A "), "A")\n')
    run('git', 'add', '.')
    run('git', 'commit', '-m', 'fixture: existing label normalization')
    base_ref = run('git', 'rev-parse', 'HEAD')
    (idea/'task-workflow-state.yaml').write_text('idea: labels\ntasks:\n  task-001:\n    file: tasks/task-001.md\n    status: coded\n    rework_count: 0\n')
    (idea/'tasks'/'task-001.md').write_text(dedent('''
    ---
    task_id: task-001
    starting_points: [labels.py, test_labels.py]
    forbidden_files: [.git/**]
    ---
    # Stable batch label normalization
    ## Acceptance Criteria
    - AC-1: normalize_labels accepts a list of strings, strips each value, discards empty values and removes duplicates while preserving first occurrence order.
    - AC-2: Empty input returns an empty list. Case and Unicode are preserved.
    - AC-3: The caller list is not mutated. Existing normalize_label behavior is unchanged.
    ## Expected Files
    - labels.py
    - test_labels.py
    ## Forbidden Files / Areas
    - .git/**
    ## Behavior Invariants
    - normalize_label strips whitespace and preserves letter case.
    - This is a pure in-memory utility; no IO or shared mutable state is added.
    ''').lstrip('\n'))
    attempt=json.loads(run(node,str(plugin/'scripts/task-provenance.mjs'),str(idea),'task-001','--start','--project-root',str(workspace),'--owner','acceptance-fixture'))
    (workspace/'labels.py').write_text(dedent('''
    def normalize_label(value: str) -> str:
        return value.strip()


    def normalize_labels(values: list[str]) -> list[str]:
        result = []
        seen = set()
        for value in values:
            label = normalize_label(value)
            if label and label not in seen:
                seen.add(label)
                result.append(label)
        return result
    ''').lstrip('\n'))
    (workspace/'test_labels.py').write_text(dedent('''
    import unittest
    from labels import normalize_label, normalize_labels


    class LabelTests(unittest.TestCase):
        def test_trim(self):
            self.assertEqual(normalize_label(" a "), "a")

        def test_case(self):
            self.assertEqual(normalize_label(" A "), "A")

        def test_batch_order_dedup(self):
            self.assertEqual(normalize_labels([" b ", "a", "b", "a "]), ["b", "a"])

        def test_empty(self):
            self.assertEqual(normalize_labels([]), [])
            self.assertEqual(normalize_labels(["", "  "]), [])

        def test_case_unicode(self):
            self.assertEqual(normalize_labels([" A ", "a", " 标签 ", "标签"]), ["A", "a", "标签"])

        def test_caller_unchanged(self):
            values = [" a ", "a", ""]
            self.assertEqual(normalize_labels(values), ["a"])
            self.assertEqual(values, [" a ", "a", ""])
    ''').lstrip('\n'))
    verification=subprocess.run(['python3','-m','unittest','discover','-v'],cwd=workspace,text=True,capture_output=True,check=True)
    (base/'unit-test.log').write_text(verification.stdout+verification.stderr)
    run('git', 'add', 'labels.py', 'test_labels.py')
    run('git', 'commit', '-m', 'fixture: add stable batch label normalization')
    run(node,str(plugin/'scripts/task-provenance.mjs'),str(idea),'task-001','--finish','--run-id',attempt['run_id'])
    (idea/'task-reports'/'task-001-report.md').write_text(dedent('''
    ---
    task_id: task-001
    changed_files: [labels.py, test_labels.py]
    status: coded
    ---
    # Implementation report
    ## Acceptance Criteria Result
    - AC-1: pass; test_batch_order_dedup executes the original input order, stripping and duplicate handling.
    - AC-2: pass; test_empty and test_case_unicode cover empty, case and Unicode.
    - AC-3: pass; test_caller_unchanged checks the input list, and test_trim/test_case cover the unchanged function.
    ## Completion Status
    Implemented and verified by python3 -m unittest discover -v: six tests passed. No network, file IO, mutable global state or external dependency was added to labels.py.
    ''').lstrip('\n'))
    context=json.loads(run(node,str(plugin/'scripts/cr-prepare.mjs'),str(idea),base_ref,str(workspace)))
    scope=json.loads(run(node,str(plugin/'scripts/scope-check.mjs'),str(idea),'task-001'))
    assert scope['pass'],scope
    (base/'scope-check.json').write_text(json.dumps(scope,ensure_ascii=False,indent=2))
    run(node,str(plugin/'scripts/review-selector.mjs'),str(idea),'--write','--project-root',str(workspace),'--base-ref',base_ref,'--complexity','simple')
    args=json.loads((idea/'cr/review-workflow-input.json').read_text())
    workflow={'scriptPath':str(plugin/'workflows/coder-review.js'),'args':args}
    (base/'workflow-call.json').write_text(json.dumps(workflow,ensure_ascii=False,indent=2))
    metadata={'base':str(base),'workspace':str(workspace),'plugin':str(plugin),'idea':str(idea),'baseRef':base_ref,'candidateRef':run('git','rev-parse','HEAD'),'sourceWorkflowSha256':hashlib.sha256((plugin/'workflows/coder-review.js').read_bytes()).hexdigest(),'context':context,'scopePass':scope['pass'], 'pluginDigest': plugin_digest(plugin)}
    (base/'fixture.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2))
    return base


def verify(base: Path, session_directory: Path) -> dict:
    """Check the source journal and original report parser, rather than file presence."""
    fixture = json.loads((base / "fixture.json").read_text())
    workspace, plugin, idea = (Path(fixture[key]) for key in ("workspace", "plugin", "idea"))
    call = json.loads((base / "workflow-call.json").read_text())
    if plugin_digest(plugin) != fixture["pluginDigest"]:
        raise TrialError("the selected plugin changed during review")
    calls, results = {}, []
    for path in session_directory.glob("*.jsonl"):
        for line in path.read_text().splitlines():
            event = json.loads(line).get("event")
            if not event:
                continue
            if event["type"] == "tool/call" and event["data"]["name"] == "Workflow":
                arguments = event["data"]["arguments"]
                if arguments.get("scriptPath") != call["scriptPath"] or arguments.get("args") != call["args"]:
                    raise TrialError("Workflow did not execute the original selector's exact input")
                calls[event["data"]["callId"]] = event["data"]
            if event["type"] == "tool/result" and event["data"]["toolCallId"] in calls:
                result = event["data"]
                if result.get("isError"):
                    raise TrialError("the actual Workflow tool failed")
                results.append(json.loads(result["content"][0]["text"]))
    if len(results) != 1:
        raise TrialError("expected exactly one actual Workflow result")
    actual = results[0]
    saved = json.loads((idea / "cr/runtime-result.json").read_text())
    if actual != saved or actual["stopReason"] != "completed" or actual["value"]["status"] != "approved":
        raise TrialError("the actual Workflow did not approve this positive fixture, or its saved result changed")
    parses = {}
    for dimension in ["spec", *call["args"]["activeDimensions"]]:
        response = subprocess.run(["node", str(plugin / "scripts/cr-parse.mjs"), str(idea), "--dim", dimension],
                                  cwd=workspace, text=True, capture_output=True, check=True)
        parses[dimension] = json.loads(response.stdout)
        if parses[dimension]["result"] != "pass":
            raise TrialError("a report disagrees with the approved workflow result")
        body = (idea / ("cr/dim-" + dimension + "-cr.md")).read_text()
        headings = ["## 结论", "## Scope Check Proof"]
        headings += ["## Acceptance Criteria 覆盖", "## Expected Files 覆盖"] if dimension == "spec" else ["## 检查结果", "## Rework Items", "## Observations (non-blocking)"]
        if any(heading not in body for heading in headings):
            raise TrialError("a report lacks a required original workflow heading")
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=workspace, text=True).strip()
    changed = subprocess.check_output(["git", "diff", "--name-only", "HEAD"], cwd=workspace, text=True).strip()
    if head != fixture["candidateRef"] or changed:
        raise TrialError("review modified the candidate's tracked source or commit")
    tests = subprocess.run(["python3", "-m", "unittest", "discover", "-v"], cwd=workspace,
                           text=True, capture_output=True, check=True)
    (base / "post-review-unit-test.log").write_text(tests.stdout + tests.stderr)
    return {"workflow": actual, "reportParses": parses, "sourceUnchanged": True, "unitTestsPassed": True}


def execute(base: Path, options) -> dict:
    fixture = json.loads((base / "fixture.json").read_text())
    workspace, plugin = Path(fixture["workspace"]), Path(fixture["plugin"])
    call = (base / "workflow-call.json").read_text()
    prompt = ("Review the already implemented isolated Git fixture. Do not run the full coder development orchestrator or another Skill. "
              "Call Workflow exactly once with the original script and exact selector-generated args below. "
              "Reviewers must read the original rules, actual source and context, run necessary checks, write their reports, and submit structured_output. "
              "Do not preselect pass/fail, skip a selected dimension, change the script, or replace Workflow with your own review.\n" + call +
              "\nAfter Workflow returns, save its actual complete JSON result (value/stopReason/agentCalls) into .review/labels/cr/runtime-result.json. "
              "Run the original cr-parse.mjs for spec and each executed dimension, then python3 -m unittest discover -v. "
              "Do not fabricate missing reports, modify labels.py/test_labels.py/Git history/plugin code, repair findings, publish or git push. "
              "If spec_failed or needs_rework, report it honestly and stop; this verification does not authorize a repair decision.")
    binary = options.agent_binary.resolve(strict=True)
    if not os.access(binary, os.X_OK):
        raise TrialError("agent binary is not executable")
    if options.disable_thinking:
        # Exec the same ACP binary with its existing explicit provider option.
        # This launcher contains no credential or alternate model loop.
        launcher = base / "agent-with-thinking-disabled"
        launcher.write_text("#!/bin/sh\nexec " + shlex.quote(str(binary)) + " --disable-thinking \"$@\"\n")
        launcher.chmod(0o700)
        binary = launcher
    config = parse_config({"plugin_path": str(plugin), "agent_binary": str(binary), "workspace": str(workspace),
                           "endpoint": options.endpoint, "model": options.model, "api_key_env": options.api_key_env,
                           "plugin_models": {"opus": options.model, "sonnet": options.model}, "prompt": prompt,
                           "success_patterns": [".review/labels/cr/runtime-result.json"], "max_continuations": 0,
                           "session_timeout": options.timeout, "idle_timeout": 150, "max_requests": options.max_requests,
                           "max_tokens": 4096, "enable_shell": True, "shell_policy": "allow-unsandboxed"})
    session = run_session(config, config.sessions[0], workspace, base / "records")
    summary = {"model": options.model, "sameModelAliases": ["opus", "sonnet"], "requestLimit": options.max_requests,
               "automaticRetries": 0, "thinkingDisabled": options.disable_thinking, "session": asdict(session)}
    if session.success:
        try:
            summary["acceptance"] = verify(base, Path(session.session_directory))
            summary["passed"] = True
        except (TrialError, OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
            summary.update(passed=False, verificationError=type(error).__name__)
    else:
        summary["passed"] = False
    (base / "acceptance.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plugin", type=Path, required=True)
    parser.add_argument("--output-parent", type=Path, default=Path(tempfile.gettempdir()))
    parser.add_argument("--execute", action="store_true", help="explicitly opt into model requests and approved fixture Bash")
    parser.add_argument("--agent-binary", type=Path)
    parser.add_argument("--endpoint")
    parser.add_argument("--model")
    parser.add_argument("--api-key-env", default="DEEPSEEK_API_KEY")
    parser.add_argument("--max-requests", type=int, default=80)
    parser.add_argument("--timeout", type=int, default=900)
    parser.add_argument("--disable-thinking", action="store_true")
    options = parser.parse_args()
    if options.execute and not all((options.agent_binary, options.endpoint, options.model)):
        parser.error("--execute requires --agent-binary, --endpoint and --model")
    node = shutil.which("node")
    if not node:
        parser.error("Node is required by the original plugin preparation scripts")
    base = Path(tempfile.mkdtemp(prefix="pero-coder-review-", dir=options.output_parent.resolve())).resolve()
    prepare(options.plugin.resolve(strict=True), base, node)
    if not options.execute:
        print(json.dumps({"prepared": True, "modelExecuted": False, "directory": str(base)}))
        return 0
    summary = execute(base, options)
    print(json.dumps({"passed": summary["passed"], "directory": str(base), "httpAttempts": summary["session"]["http_attempts"]}))
    return 0 if summary["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
