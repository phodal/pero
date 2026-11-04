#!/usr/bin/env python3
"""Run a fixed QuixBugs Python program-repair sample through the real ACP agent."""
from __future__ import annotations

import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET

import run_benchmark as runner

BENCHMARK_COMMIT = "4257f44b0ff1181dedaedee6a447e133219fcebf"
DEFAULT_TASKS = "bitcount,find_first_in_sorted,flatten,lis,next_permutation,shortest_paths"


def judge(source: Path, solutions: dict[str, bytes], tests: list[str], directory: Path) -> dict:
    """Run unchanged upstream pytest files against only the frozen submission."""
    directory.mkdir(parents=True)
    shutil.copy2(source / "conftest.py", directory / "conftest.py")
    (directory / "python_testcases").mkdir()
    shutil.copy2(source / "python_testcases/load_testdata.py", directory / "python_testcases/load_testdata.py")
    for name, content in solutions.items():
        (directory / name).parent.mkdir(parents=True, exist_ok=True)
        (directory / name).write_bytes(content)
        task = Path(name).stem
        data = source / "json_testcases" / (task + ".json")
        if data.is_file():
            (directory / "json_testcases").mkdir(exist_ok=True)
            shutil.copy2(data, directory / "json_testcases" / data.name)
    for name in tests:
        shutil.copy2(source / name, directory / name)
    command = [sys.executable, "-B", "-m", "pytest", "-q", "--timeout=3", "--timeout-method=signal",
               "--junitxml=verdict.xml", *tests]
    environment = {key: value for key, value in os.environ.items() if key != runner.KEY_ENV}
    environment.pop("PYTEST_ADDOPTS", None)
    environment.pop("PYTHONPATH", None)
    started = time.monotonic()
    timed_out = False
    try:
        result = subprocess.run(command, cwd=directory, env=environment, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=180)
        output, exit_code = result.stdout, result.returncode
    except subprocess.TimeoutExpired as error:
        output, exit_code = (error.stdout or b"").decode(errors="replace"), 124
        timed_out = True
    if runner.SECRET:
        output = output.replace(runner.SECRET, "[credential-redacted]")
    (directory / "test-output.txt").write_text(output)
    verdict = directory / "verdict.xml"
    counts = {name: 0 for name in ("tests", "failures", "errors", "skipped")}
    if verdict.is_file():
        for suite in ET.parse(verdict).getroot().iter("testsuite"):
            for name in counts:
                counts[name] += int(suite.get(name, "0"))
    return {"passed": exit_code == 0 and counts["tests"] > 0 and not any(
                counts[name] for name in ("failures", "errors", "skipped")),
            "exit_code": exit_code, "timed_out": timed_out, **counts,
            "duration_seconds": round(time.monotonic() - started, 3), "output": output,
            "command": command, "directory": str(directory)}


def prepare(options, task: str) -> dict:
    directory = options.output / task
    directory.mkdir()
    filename = "python_programs/" + task + ".py"
    tests = ["python_testcases/test_" + task + ".py"]
    skeleton = {filename: (options.benchmark / filename).read_bytes()}
    reference = {filename: (options.benchmark / "correct_python_programs" / (task + ".py")).read_bytes()}
    # The workspace's parent contains no judges, references, dataset or run outputs.
    workspace = Path(tempfile.mkdtemp(prefix="pero-quixbugs-workspace-")).resolve()
    (workspace / filename).parent.mkdir()
    (workspace / filename).write_bytes(skeleton[filename])
    (workspace / "README.md").write_text(
        "Repair the supplied Python program in " + filename + ".\n"
        "The original source contains the program specification and examples. Preserve its public API.\n"
        "Use only the Python standard library. You may create your own checks inside this workspace.\n"
        "Official tests are held out and run after submission. Do not modify this README.\n")
    baseline = judge(options.benchmark, skeleton, tests, directory / "judge-baseline")
    reference_result = judge(options.benchmark, reference, tests, directory / "judge-reference")
    runner.save(directory / "validation.json", {"baseline": baseline, "reference": reference_result,
                                               "workspace": str(workspace)})
    if baseline["passed"] or not baseline["tests"] or baseline["errors"] or not reference_result["passed"]:
        raise RuntimeError("judge validation failed for " + task)
    prompt = ("Repair the buggy Python program in this workspace. Read README.md and " + filename +
              " first, then fix the implementation while preserving its public API. "
              "You may run your own local checks. Official tests are held out and run after you finish. "
              "Work only in this workspace; do not search for external solutions, hidden tests, or reference code. "
              "Keep scratch files inside this workspace. Do not modify README.md. Finish without asking questions.")
    return {"name": task, "source": options.benchmark, "directory": directory, "workspace": workspace,
            "manifest": {"solution": [filename], "test": tests}, "skeleton": skeleton,
            "baseline": baseline, "reference": reference_result, "prompt": prompt}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--benchmark", type=Path, required=True)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--tasks", default=DEFAULT_TASKS)
    parser.add_argument("--model", default="deepseek-flash")
    parser.add_argument("--endpoint", default="https://api.deepseek.com/v1")
    parser.add_argument("--max-requests", type=int, default=32)
    parser.add_argument("--defer-tool-loading", action="store_true")
    parser.add_argument("--prepare-only", action="store_true")
    options = parser.parse_args()
    for name in ("benchmark", "binary", "output"):
        setattr(options, name, getattr(options, name).expanduser().resolve())
    if options.output.exists():
        parser.error("--output must be a new directory")
    if runner.git_head(options.benchmark) != BENCHMARK_COMMIT:
        parser.error("benchmark must be pinned to " + BENCHMARK_COMMIT)
    if subprocess.check_output(["git", "-C", str(options.benchmark), "status", "--porcelain",
                                "--untracked-files=no"], text=True).strip():
        parser.error("benchmark tracked files must be unchanged")
    tasks = options.tasks.split(",")
    if not tasks or len(set(tasks)) != len(tasks) or any(not re.fullmatch(r"[a-z_]+", task) for task in tasks):
        parser.error("--tasks must be unique Python program names")
    if not 1 <= options.max_requests <= 1000:
        parser.error("--max-requests must be 1..1000")
    versions = {name: importlib.metadata.version(name) for name in ("pytest", "pytest-timeout")}
    os.umask(0o077)
    options.output.mkdir(parents=True)
    provenance = []
    for path in (Path(__file__).resolve(), Path(runner.__file__).resolve()):
        content = path.read_bytes()
        snapshot = options.output / path.name
        snapshot.write_bytes(content)
        provenance.append({"source": str(path), "snapshot": str(snapshot),
                           "sha256": hashlib.sha256(content).hexdigest()})
    runner.save(options.output / "runner-provenance.json", provenance)
    metadata = {"benchmark": "QuixBugs Python repair subset", "benchmark_url": "https://github.com/jkoppel/QuixBugs",
        "benchmark_commit": BENCHMARK_COMMIT, "pero_commit": runner.git_head(runner.REPO_ROOT),
        "python": platform.python_version(), "test_dependencies": versions,
        "binary_sha256": hashlib.sha256(options.binary.read_bytes()).hexdigest(),
        "model": options.model, "endpoint": options.endpoint, "thinking": "disabled",
        "sampling": "provider-default; temperature not set", "tasks": tasks, "parallel": 1,
        "max_requests_per_problem": options.max_requests, "max_tokens_per_request": 8192,
        "session_timeout_seconds": 900, "idle_timeout_seconds": 240, "http_retries": 0,
        "defer_tool_loading": options.defer_tool_loading,
        "scoring": "every unchanged official pytest passes, no skips; at most one same-session failure-feedback repair",
        "workspace": "only buggy source and README; unrelated temporary workspace, no adjacent judge/reference",
        "isolation": "no OS sandbox; separate directories do not enforce filesystem or network isolation",
        "plugin": "neutral manifest only; no business skills, hooks, or workflow",
        "created_at": datetime.now(timezone.utc).isoformat(), "prepare_only": options.prepare_only}
    runner.save(options.output / "metadata.json", metadata)
    prepared = [prepare(options, task) for task in tasks]
    print(json.dumps({"event": "judges_validated", "tasks": tasks, "prepare_only": options.prepare_only}), flush=True)
    if options.prepare_only:
        return
    runner.SECRET = os.environ.get(runner.KEY_ENV, "")
    if not runner.SECRET:
        raise RuntimeError("DEEPSEEK_API_KEY is unset")
    sys.path.insert(0, str(runner.TRIAL_DIRECTORY))
    plugin = options.output / "neutral-plugin/.claude-plugin"
    plugin.mkdir(parents=True)
    runner.save(plugin / "plugin.json", {"name": "benchmark-neutral", "version": "1.0.0"})
    wrapper = options.output / "agent-wrapper.sh"
    wrapper.write_text(runner.agent_wrapper_script(options.binary, defer_tool_loading=options.defer_tool_loading))
    wrapper.chmod(0o700)
    from core import Usage, sum_usage
    completed = []
    for item in prepared:
        completed.append(runner.run_task(options, item, judge))
        summary = {"completed": len(completed), "total": len(tasks),
            "first_pass": sum(task["first_pass"] for task in completed),
            "final_pass": sum(task["final_pass"] for task in completed),
            "http_attempts": sum(task["http_attempts"] for task in completed),
            "usage": asdict(sum_usage(tuple(Usage(**task["usage"]) for task in completed)))}
        runner.save(options.output / "results.json", {"metadata": metadata, "summary": summary, "tasks": completed})
    trace_summary = runner.summarize_trace(options.output, options.output / "trace-summary")
    runner.save(options.output / "results.json", {"metadata": metadata, "summary": summary,
                                                "tasks": completed, "trace_summary": trace_summary})
    print(json.dumps({"event": "complete", "output": str(options.output), "summary": summary}), flush=True)


if __name__ == "__main__":
    main()
