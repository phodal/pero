#!/usr/bin/env python3
"""Run a fixed Aider Polyglot Python sample through Pero's real ACP agent."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict
from datetime import datetime, timezone
import difflib
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time

BENCHMARK_COMMIT = "7e0611e77b54e2dea774cdc0aa00cf9f7ed6144f"
REPO_ROOT = Path(__file__).resolve().parents[3]
TRIAL_DIRECTORY = Path(__file__).resolve().parents[1] / "trial"
SESSION_REPORT = Path(__file__).resolve().parents[1] / "session_report/report.py"
KEY_ENV = "DEEPSEEK_API_KEY"
SECRET = ""


def save(path: Path, value: object) -> None:
    encoded = json.dumps(value, indent=2, ensure_ascii=False) + "\n"
    if SECRET:
        encoded = encoded.replace(SECRET, "[credential-redacted]")
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(encoded)
    temporary.replace(path)


def git_head(path: Path) -> str:
    return subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"], text=True).strip()


def summarize_trace(source: Path, output: Path) -> dict:
    """Generate offline diagnostics without affecting the independent judge."""
    try:
        completed = subprocess.run([sys.executable, str(SESSION_REPORT), str(source), "--output", str(output)],
                                   capture_output=True, text=True)
        if completed.returncode:
            return {"status": "error", "diagnostic": completed.stderr[-1000:], "output": str(output)}
        return {"status": "complete", **json.loads(completed.stdout)}
    except (OSError, ValueError, TypeError) as error:
        return {"status": "error", "diagnostic": str(error)[-1000:], "output": str(output)}


def agent_wrapper_script(binary: Path, *, defer_tool_loading: bool = False) -> str:
    arguments = [str(binary), "--disable-thinking"]
    if defer_tool_loading:
        arguments.append("--defer-tool-loading")
    return "#!/bin/sh\nexec " + shlex.join(arguments) + " \"$@\"\n"


def judge(source: Path, solutions: dict[str, bytes], tests: list[str], directory: Path) -> dict:
    directory.mkdir(parents=True)
    for name, content in solutions.items():
        (directory / name).parent.mkdir(parents=True, exist_ok=True)
        (directory / name).write_bytes(content)
    for name in tests:
        shutil.copy2(source / name, directory / name)
    started = time.monotonic()
    environment = {k: v for k, v in os.environ.items() if k != KEY_ENV}
    command = [sys.executable, "-B", "-m", "unittest", "discover", "-s", ".", "-p", "*_test.py", "-v"]
    timed_out = False
    try:
        result = subprocess.run(command, cwd=directory, env=environment, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=180)
        output, exit_code = result.stdout, result.returncode
    except subprocess.TimeoutExpired as error:
        output, exit_code = (error.stdout or b"").decode(errors="replace"), 124
        timed_out = True
    if SECRET:
        output = output.replace(SECRET, "[credential-redacted]")
    (directory / "test-output.txt").write_text(output)
    count = re.search(r"Ran (\d+) tests? in", output)
    failures = re.search(r"failures=(\d+)", output)
    errors = re.search(r"errors=(\d+)", output)
    skipped = re.search(r"skipped=(\d+)", output)
    counts = {"tests": int(count[1]) if count else None, "failures": int(failures[1]) if failures else 0,
              "errors": int(errors[1]) if errors else 0, "skipped": int(skipped[1]) if skipped else 0}
    return {"passed": exit_code == 0 and bool(counts["tests"]) and not any(
                counts[name] for name in ("failures", "errors", "skipped")),
            "exit_code": exit_code, "timed_out": timed_out, **counts,
            "duration_seconds": round(time.monotonic() - started, 3), "output": output,
            "command": command, "directory": str(directory)}


def prepare(options, task: str) -> dict:
    source = options.benchmark / "python/exercises/practice" / task
    manifest = json.loads((source / ".meta/config.json").read_text())["files"]
    skeleton = {name: (source / name).read_bytes() for name in manifest["solution"]}
    reference = dict(zip(manifest["solution"], ((source / name).read_bytes() for name in manifest["example"])))
    directory = options.output / task
    workspace = Path(tempfile.mkdtemp(prefix="pero-polyglot-workspace-")).resolve()
    for name, content in skeleton.items():
        (workspace / name).write_bytes(content)
    documents = [source / ".docs" / name for name in ("introduction.md", "instructions.md", "instructions.append.md")]
    readme = "".join(path.read_text() for path in documents if path.is_file())
    readme += ("\n####\n\nUse the above instructions to modify the supplied files: " + " ".join(skeleton) + "\n"
               "Don't change the names of existing functions or classes, as they may be referenced from other code like unit tests, etc.\n"
               "Only use standard libraries, don't suggest installing any packages.\n")
    (workspace / "README.md").write_text(readme)
    baseline = judge(source, skeleton, manifest["test"], directory / "judge-baseline")
    reference_result = judge(source, reference, manifest["test"], directory / "judge-reference")
    save(directory / "validation.json", {"baseline": baseline, "reference": reference_result,
                                         "workspace": str(workspace)})
    if baseline["passed"] or not reference_result["passed"]:
        raise RuntimeError("judge validation failed for " + task)
    return {"name": task, "source": source, "directory": directory, "workspace": workspace,
            "manifest": manifest, "skeleton": skeleton, "baseline": baseline, "reference": reference_result}


def run_task(options, prepared: dict, judge_function=judge) -> dict:
    from acp import ACPClient, read_usage
    from core import TrialConfig

    task, directory, workspace = prepared["name"], prepared["directory"], prepared["workspace"]
    filenames = prepared["manifest"]["solution"]
    prompt = prepared.get("prompt") or ("Implement the Python exercise in this workspace. Read README.md and the provided solution "
              "skeleton first, then implement the required API in " + ", ".join(filenames) + ". "
              "You may run your own local checks. Official tests are held out and will be run after you finish. "
              "Work only in this workspace; do not search for external solutions, hidden tests, or reference code. "
              "Keep all scratch scripts and temporary files inside this workspace. "
              "Do not modify README.md. Complete the implementation now without asking questions.")
    config = TrialConfig.parse({"plugin_path": str(options.output / "neutral-plugin"),
        "agent_binary": str(options.output / "agent-wrapper.sh"), "workspace": str(workspace),
        "endpoint": options.endpoint, "model": options.model, "api_key_env": KEY_ENV,
        "prompt": prompt, "success_patterns": filenames, "max_continuations": 0,
        "session_timeout": 900, "idle_timeout": 240, "max_requests": options.max_requests, "max_tokens": 8192,
        "max_retries": 0, "enable_shell": True, "shell_policy": "allow-unsandboxed",
        "permission_mode": "auto-review", "unattended_questions": "cancel"})
    started = time.monotonic()
    receipt = {"task": task, "first_pass": False, "final_pass": False, "rounds": [],
               "baseline": prepared["baseline"], "reference": prepared["reference"]}
    client = ACPClient(config, workspace, directory / "agent", task)
    print(json.dumps({"event": "task_start", "task": task}), flush=True)
    try:
        client.start()
        receipt["session_id"] = client.session_id
        receipt["runtime_version"] = client.runtime_version
        for number in (1, 2):
            round_started = time.monotonic()
            response = client.call("session/prompt", {"sessionId": client.session_id,
                "prompt": [{"type": "text", "text": prompt}]})
            stop = response.get("stopReason", "unknown")
            snapshot = directory / ("attempt-" + str(number))
            snapshot.mkdir()
            solutions = {}
            for name in filenames:
                content = (workspace / name).read_bytes() if (workspace / name).is_file() else b""
                solutions[name] = content
                (snapshot / name).parent.mkdir(parents=True, exist_ok=True)
                (snapshot / name).write_bytes(content)
            difference = "".join(line for name in filenames for line in difflib.unified_diff(
                prepared["skeleton"][name].decode().splitlines(keepends=True),
                solutions[name].decode().splitlines(keepends=True), fromfile="a/" + name, tofile="b/" + name))
            (snapshot / "solution.diff").write_text(difference)
            result = judge_function(prepared["source"], solutions, prepared["manifest"]["test"], snapshot / "judge")
            passed = result["passed"] and stop == "end_turn"
            record = {"attempt": number, "stop_reason": stop, "passed": passed, "judge": result,
                      "duration_seconds": round(time.monotonic() - round_started, 3),
                      "cumulative_usage": asdict(read_usage(directory / "agent")),
                      "http_attempts": len(client.audit_path.read_text().splitlines())}
            receipt["rounds"].append(record)
            receipt["first_pass"] = receipt["rounds"][0]["passed"]
            receipt["final_pass"] = passed
            save(directory / "receipt.json", receipt)
            print(json.dumps({"event": "attempt_complete", "task": task, "attempt": number,
                              "passed": passed, "tests": result["tests"], "stop_reason": stop}), flush=True)
            if passed or stop != "end_turn":
                break
            prompt = ("The official tests failed. Fix the implementation in the same solution files. "
                      "Here is the unmodified test output:\n\n" + result["output"])
            if result["timed_out"]:
                prompt = ("The judge timed out after 180 seconds and terminated the test process "
                          "(exit code 124). The output below is incomplete; investigate non-terminating execution.\n\n"
                          + prompt)
    except Exception as error:
        receipt["error"] = type(error).__name__ + ": " + str(error)
        receipt["final_pass"] = False
    finally:
        cleanup = client.close()
        receipt["cleanup"] = {**asdict(cleanup), "succeeded": cleanup.succeeded, "failures": list(cleanup.failures)}
        receipt["tools"] = client.tool_summary
        receipt["http_attempts"] = len(client.audit_path.read_text().splitlines())
        receipt["usage"] = asdict(read_usage(directory / "agent"))
        receipt["duration_seconds"] = round(time.monotonic() - started, 3)
        receipt["interactions"] = [asdict(item) for item in client.interactions]
        if not cleanup.succeeded:
            receipt["final_pass"] = False
        # Provider errors and tool receipts are kept private and scrubbed after shutdown.
        if SECRET:
            for path in (directory / "agent").rglob("*"):
                if path.is_file():
                    content = path.read_bytes()
                    if SECRET.encode() in content:
                        path.write_bytes(content.replace(SECRET.encode(), b"[credential-redacted]"))
        receipt["trace_summary"] = summarize_trace(directory / "agent/sessions", directory / "trace-summary")
        save(directory / "receipt.json", receipt)
    print(json.dumps({"event": "task_complete", "task": task, "first_pass": receipt["first_pass"],
                      "final_pass": receipt["final_pass"], "http_attempts": receipt["http_attempts"]}), flush=True)
    return receipt


def main() -> None:
    global SECRET
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--benchmark", type=Path, required=True,
                        help="checkout of the fixed Aider Polyglot benchmark commit")
    parser.add_argument("--binary", type=Path, required=True,
                        help="explicit pero-agent-acp executable; only hashed during --prepare-only")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--tasks", default="forth,react,rest-api,zipper")
    parser.add_argument("--model", default="deepseek-flash")
    parser.add_argument("--endpoint", default="https://api.deepseek.com/v1")
    parser.add_argument("--parallel", type=int, default=1)
    parser.add_argument("--max-requests", type=int, default=64)
    parser.add_argument("--defer-tool-loading", action="store_true",
                        help="opt in to ToolSearch discovery before declaring other tools (default: eager)")
    parser.add_argument("--prepare-only", action="store_true",
                        help="validate held-out judges and prepare workspaces without starting the agent or reading credentials")
    options = parser.parse_args()
    for name in ("benchmark", "binary", "output"):
        setattr(options, name, getattr(options, name).expanduser().resolve())
    if options.output.exists():
        parser.error("--output must be a new directory")
    if git_head(options.benchmark) != BENCHMARK_COMMIT:
        parser.error("benchmark must be pinned to " + BENCHMARK_COMMIT)
    tasks = options.tasks.split(",")
    if not tasks or len(set(tasks)) != len(tasks) or any(not re.fullmatch(r"[a-z0-9-]+", task) for task in tasks):
        parser.error("--tasks must be unique exercise slugs")
    if not 1 <= options.parallel <= 4:
        parser.error("--parallel must be 1..4")
    if not 1 <= options.max_requests <= 1000:
        parser.error("--max-requests must be 1..1000")
    os.umask(0o077)
    options.output.mkdir(parents=True)
    runner_bytes = Path(__file__).read_bytes()
    (options.output / "runner.py").write_bytes(runner_bytes)
    save(options.output / "runner-provenance.json", {
        "sha256": hashlib.sha256(runner_bytes).hexdigest(),
        "source": str(Path(__file__).resolve()), "snapshot": str(options.output / "runner.py")})
    sys.path.insert(0, str(TRIAL_DIRECTORY))
    metadata = {"benchmark": "Aider Polyglot Python subset", "benchmark_url": "https://github.com/Aider-AI/polyglot-benchmark",
        "benchmark_commit": BENCHMARK_COMMIT, "pero_commit": git_head(REPO_ROOT), "python": platform.python_version(),
        "binary_sha256": hashlib.sha256(options.binary.read_bytes()).hexdigest(), "model": options.model,
        "endpoint": options.endpoint, "thinking": "disabled", "sampling": "provider-default; temperature not set",
        "tasks": tasks, "parallel": options.parallel, "max_requests_per_problem": options.max_requests, "max_tokens_per_request": 8192,
        "session_timeout_seconds": 900, "idle_timeout_seconds": 240, "http_retries": 0,
        "plugin": "neutral manifest only; no business skills, hooks, or workflow",
        "defer_tool_loading": options.defer_tool_loading,
        "scoring": "whole exercise passes every official unittest; at most one same-session repair using test output",
        "workspace": "solution skeleton and official docs only; unrelated temporary workspace, no adjacent judge/reference",
        "isolation": "no OS sandbox; separate directories do not enforce filesystem or network isolation",
        "created_at": datetime.now(timezone.utc).isoformat(), "prepare_only": options.prepare_only}
    save(options.output / "metadata.json", metadata)
    prepared = [prepare(options, task) for task in tasks]
    print(json.dumps({"event": "judges_validated", "tasks": tasks, "prepare_only": options.prepare_only}), flush=True)
    if options.prepare_only:
        return
    SECRET = os.environ.get(KEY_ENV, "")
    if not SECRET:
        raise RuntimeError("DEEPSEEK_API_KEY is unset")
    plugin = options.output / "neutral-plugin/.claude-plugin"
    plugin.mkdir(parents=True)
    save(plugin / "plugin.json", {"name": "benchmark-neutral", "version": "1.0.0", "description": "Neutral benchmark tool surface"})
    wrapper = options.output / "agent-wrapper.sh"
    wrapper.write_text(agent_wrapper_script(options.binary, defer_tool_loading=options.defer_tool_loading))
    wrapper.chmod(0o700)
    completed = []
    with ThreadPoolExecutor(max_workers=options.parallel) as pool:
        pending = {pool.submit(run_task, options, item): item["name"] for item in prepared}
        for future in as_completed(pending):
            completed.append(future.result())
            ordered = sorted(completed, key=lambda item: tasks.index(item["task"]))
            from core import Usage, sum_usage
            summary = {"completed": len(completed), "total": len(tasks),
                "first_pass": sum(item["first_pass"] for item in completed), "final_pass": sum(item["final_pass"] for item in completed),
                "http_attempts": sum(item["http_attempts"] for item in completed),
                "usage": asdict(sum_usage(tuple(Usage(**item["usage"]) for item in completed)))}
            save(options.output / "results.json", {"metadata": metadata, "summary": summary, "tasks": ordered})
    trace_summary = summarize_trace(options.output, options.output / "trace-summary")
    save(options.output / "results.json", {"metadata": metadata, "summary": summary, "tasks": ordered,
                                          "trace_summary": trace_summary})
    print(json.dumps({"event": "complete", "output": str(options.output), "summary": summary}), flush=True)


if __name__ == "__main__":
    main()
