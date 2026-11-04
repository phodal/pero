#!/usr/bin/env python3
"""Run one plugin trial through an explicitly configured pero-agent-acp binary."""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import uuid

from acp import ACPClient, TrialTimeout, read_usage
from core import ArtifactMatch, CleanupResult, SessionReceipt, SessionSpec, TrialConfig, TrialError, Usage, pipeline_succeeded, session_succeeded, sum_usage


def parse_config(raw: object) -> TrialConfig:
    if not isinstance(raw, dict):
        raise TrialError("trial input must be an object")
    raw = dict(raw)
    for key in ("plugin_path", "agent_binary", "workspace", "context_source"):
        value = raw.get(key, "." if key == "workspace" else None)
        if value is None:
            continue
        if not isinstance(value, str) or not value:
            raise TrialError("trial paths must be nonempty strings")
        supplied = Path(value).expanduser()
        if key == "context_source" and supplied.is_symlink():
            raise TrialError("context_source root must not be a symlink")
        raw[key] = str(supplied.resolve(strict=key in ("plugin_path", "agent_binary", "context_source")))
    config = TrialConfig.parse(raw)
    if not config.plugin.is_dir() or not config.binary.is_file() or not os.access(config.binary, os.X_OK):
        raise TrialError("plugin directory or agent executable is unavailable")
    return config


def artifact_matches(workspace: Path, selected: tuple[str, ...]) -> tuple[ArtifactMatch, ...]:
    result = []
    for pattern in selected:
        matches = []
        for path in workspace.glob(pattern):
            if not path.is_file():
                continue
            relative = path.relative_to(workspace)
            if any(workspace.joinpath(*relative.parts[:index]).is_symlink() for index in range(1, len(relative.parts) + 1)):
                raise TrialError("artifact matches must not traverse symlinks")
            matches.append(relative.as_posix())
        result.append(ArtifactMatch(pattern, tuple(sorted(matches))))
    return tuple(result)


def copy_context(source: Path, workspace: Path) -> None:
    if source.is_symlink() or not source.is_dir():
        raise TrialError("context_source must be a directory")
    entries = tuple(source.rglob("*"))
    if any(path.is_symlink() or not (path.is_file() or path.is_dir()) for path in entries):
        raise TrialError("context_source must contain only regular files and directories; symlinks are refused")
    shutil.copytree(source, workspace / ".context", symlinks=False)


def run_session(config: TrialConfig, spec: SessionSpec, workspace: Path, directory: Path) -> SessionReceipt:
    started = time.monotonic()
    client = ACPClient(config, workspace, directory, spec.name)
    timed_out, fatal, diagnostic, stop = False, False, "", "not_started"
    continuations = 0
    matches: tuple[ArtifactMatch, ...] = ()
    cleanup = CleanupResult(False, None, ())
    try:
        client.start()
        prompt = spec.prompt
        while True:
            response = client.call("session/prompt", {"sessionId": client.session_id, "prompt": [{"type": "text", "text": prompt}]})
            stop = response.get("stopReason", "unknown")
            client.record({"type": "ResultMessage", "sub": stop, "cost": None})
            matches = artifact_matches(workspace, spec.success_patterns)
            fatal = client.question_cancelled or stop != "end_turn"
            if session_succeeded(matches, stop, fatal) or fatal or continuations >= spec.max_continuations:
                break
            continuations += 1
            prompt = "Continue the current task. Required artifacts are still missing: " + ", ".join(item.pattern for item in matches if not item.matches)
    except TrialTimeout:
        timed_out, fatal, diagnostic, stop = True, True, "session or idle timeout; prompt was not retried", "timed_out"
    except TrialError as error:
        fatal, diagnostic, stop = True, str(error), "error"
    except KeyboardInterrupt:
        fatal, diagnostic, stop = True, "trial was cancelled; prompt was not retried", "cancelled"
    except (OSError, ValueError, KeyError):
        fatal, diagnostic, stop = True, "trial failed; inspect the private journal and agent stderr", "error"
    finally:
        try:
            cleanup = client.close()
        except (TrialError, OSError) as error:
            cleanup = CleanupResult(client.process is not None, client.process.returncode if client.process else None,
                                    ("agent cleanup failed: " + str(error),))
        if not cleanup.succeeded:
            diagnostic = "; ".join(filter(None, (diagnostic, *cleanup.failures)))
            if not fatal:
                stop = "error"
            fatal = True
    # Artifacts are observed again after all owned processes have been joined.
    try:
        matches = artifact_matches(workspace, spec.success_patterns)
        usage = read_usage(directory)
    except (TrialError, OSError, ValueError):
        fatal, diagnostic, stop, usage = True, "artifact or usage receipt is invalid", "error", Usage()
    attempts = client.audit_path.read_text().splitlines()
    if any(line != "attempt" for line in attempts):
        fatal, diagnostic, stop = True, "HTTP attempt audit is invalid", "error"
    return SessionReceipt(spec.name, client.session_id, client.process.pid if client.process else 0, client.runtime_version,
                          round((time.monotonic() - started) * 1000, 1),
                          session_succeeded(matches, stop, fatal), continuations, timed_out, client.events,
                          tuple(client.interactions), str(client.journal_path), str(directory / "sessions"), stop, diagnostic,
                          matches, usage, len(attempts), dict(client.tool_summary), cleanup.exit_code, cleanup.failures)


def run_pipeline(config: TrialConfig) -> dict:
    started = time.monotonic()
    trial_id = "trial-" + uuid.uuid4().hex
    workspace = config.base_workspace / "trial-workspaces" / trial_id
    workspace.mkdir(parents=True, mode=0o700)
    records = workspace.parent / (trial_id + "-records")
    records.mkdir(mode=0o700)
    source = config.context_source
    if source is None and (config.base_workspace / ".context").is_dir():
        source = config.base_workspace / ".context"
    if source is not None:
        copy_context(source, workspace)
    receipts = []
    for spec in config.sessions:
        receipt = run_session(config, spec, workspace, records / spec.name)
        receipts.append(receipt)
        if not receipt.success:
            break
    all_patterns = config.required_patterns
    artifact_error = ""
    try:
        matches = artifact_matches(workspace, all_patterns)
    except (TrialError, OSError):
        matches, artifact_error = (), "artifact matching failed; inspect the session receipt"
    artifacts = {}
    for extension in ("*.md", "*.adoc", "*.svg", "*.drawio", "*.json"):
        artifacts[extension] = sum(1 for path in workspace.rglob(extension) if path.is_file() and ".context" not in path.relative_to(workspace).parts and not path.is_symlink())
    complete = pipeline_succeeded(tuple(receipts), len(config.sessions), matches, bool(artifact_error))
    output = {"trial_id": trial_id, "timestamp": datetime.now(timezone.utc).isoformat(), "plugin_path": str(config.plugin),
              "workspace": str(workspace), "model": config.model, "total_duration_ms": round((time.monotonic() - started) * 1000, 1),
              "pipeline_complete": complete, "artifacts": artifacts, "pattern_artifacts": {item.pattern: len(item.matches) for item in matches},
              "sessions": [asdict(item) for item in receipts], "runtime": "pero-agent-acp", "receipt_version": 1,
              "usage": asdict(sum_usage(tuple(item.usage for item in receipts))), "usage_source": "committed provider-reported completion usage",
              "cost_usd": None, "http_attempts": sum(item.http_attempts for item in receipts),
              "unattended_questions": config.questions, "shell_policy": "allow-unsandboxed" if config.enable_shell else "disabled",
              "permission_mode": config.permission_mode, "allow_http": config.allow_http, "disable_streaming": config.disable_streaming, "api_format": config.api_format}
    if artifact_error:
        output["artifact_error"] = artifact_error
    # Existing analysis tools consume session-shaped fields. Project the actual
    # pipeline, including failures and unrun requested sessions, into that shape.
    aggregate = records / "pipeline.jsonl"
    event_count, offset, tools = 0, 0.0, {}
    with aggregate.open("x", encoding="utf-8") as journal:
        aggregate.chmod(0o600)
        for receipt in receipts:
            for line in Path(receipt.journal_path).read_bytes().splitlines():
                event = json.loads(line)
                event_count += 1
                event.update(seq=event_count, elapsed_ms=round(event["elapsed_ms"] + offset, 1), source_session=receipt.session)
                journal.write(json.dumps(event, ensure_ascii=False) + "\n")
            offset += receipt.duration_ms
            for name, count in receipt.tool_summary.items():
                tools[name] = tools.get(name, 0) + count
    output.update(duration_ms=output["total_duration_ms"], success=complete, events=event_count,
                  continuations=sum(item.continuations for item in receipts), journal_path=str(aggregate), tool_summary=tools,
                  interactions=[asdict(interaction) for item in receipts for interaction in item.interactions])
    # The report consumes committed native Sessions after process cleanup. Its
    # diagnostics are additive and do not replace the artifact acceptance verdict.
    reporter = Path(__file__).resolve().parents[1] / "session_report/report.py"
    report_directory = records / "trace-summary"
    try:
        report_result = subprocess.run([sys.executable, str(reporter), str(records), "--output", str(report_directory)],
                                       capture_output=True, text=True)
        output["trace_summary"] = ({"status": "complete", **json.loads(report_result.stdout)} if report_result.returncode == 0
                                   else {"status": "error", "output": str(report_directory), "diagnostic": report_result.stderr[-1000:]})
    except (OSError, ValueError, TypeError) as error:
        output["trace_summary"] = {"status": "error", "output": str(report_directory), "diagnostic": str(error)[-1000:]}
    return output


def main() -> int:
    def interrupted(_number, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupted)
    try:
        config = parse_config(json.load(sys.stdin))
        output = run_pipeline(config)
    except TrialError as error:
        print(json.dumps({"runtime": "pero-agent-acp", "pipeline_complete": False, "error": str(error)}))
        return 2
    except (OSError, ValueError, TypeError):
        print(json.dumps({"runtime": "pero-agent-acp", "pipeline_complete": False, "error": "trial input or execution failed; no prompt was automatically retried"}))
        return 2
    print(json.dumps(output, ensure_ascii=False))
    return 0 if output["pipeline_complete"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
