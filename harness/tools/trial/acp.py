"""A stdio ACP adapter. All model execution remains in the configured agent."""

from __future__ import annotations

import json
import os
from pathlib import Path
import queue
import signal
import subprocess
import threading
import time

from core import CleanupResult, Interaction, TrialConfig, TrialError, Usage, sum_usage


class TrialTimeout(TimeoutError):
    pass


class ACPClient:
    def __init__(self, config: TrialConfig, workspace: Path, directory: Path, name: str):
        self.config, self.workspace, self.directory = config, workspace, directory
        self.started = time.monotonic()
        self.last_activity = self.started
        self.sequence = self.events = 0
        self.session_id = ""
        self.runtime_version = ""
        self.interactions: list[Interaction] = []
        self.tools: dict[str, str] = {}
        self.tool_summary: dict[str, int] = {}
        self.frames: queue.Queue = queue.Queue()
        self.closing = False
        self.question_cancelled = False
        self.secret = os.environ.get(config.api_key_env, "")
        if not self.secret:
            raise TrialError("the configured credential environment variable is unset or empty")
        if os.name != "posix":
            raise TrialError("trial process-group cleanup currently requires a Unix host")
        directory.mkdir(mode=0o700)
        self.journal_path = directory / "journal.jsonl"
        self.journal = self.journal_path.open("x", encoding="utf-8")
        self.stderr = (directory / "agent.stderr").open("xb")
        self.journal_path.chmod(0o600)
        (directory / "agent.stderr").chmod(0o600)
        self.audit_path = directory / "http-attempts.log"
        self.audit_path.touch(mode=0o600)
        self.process: subprocess.Popen | None = None
        self.reader: threading.Thread | None = None
        self.session_name = name
        self.record({"marker": "session_start", "runtime": "pero-agent-acp", "name": name})

    def start(self) -> None:
        config = self.config
        arguments = [str(config.binary), "--endpoint", config.endpoint, "--model", config.model,
                     "--api-key-env", config.api_key_env, "--plugin-dir", str(config.plugin), "--workspace", str(self.workspace),
                     "--session-dir", str(self.directory / "sessions"), "--http-attempt-audit", str(self.audit_path),
                     "--max-requests", str(config.max_requests), "--max-tokens", str(config.max_tokens), "--max-retries", "0", "--approval", "ask"]
        if config.enable_shell:
            arguments.append("--enable-shell")
        for route in config.plugin_models:
            arguments.extend(["--plugin-model", route.alias + "=" + route.model])
        self.process = subprocess.Popen(arguments, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.stderr, start_new_session=True)
        self.reader = threading.Thread(target=self._read, name="trial-acp-reader", daemon=True)
        self.reader.start()
        initialized = self.call("initialize", {"protocolVersion": 1, "clientCapabilities": {"_meta": {"pero.userQuestions": 1}}})
        identity = initialized.get("agentInfo", {})
        if identity.get("name") != "pero-agent-acp":
            raise TrialError("trial binary did not identify as pero-agent-acp")
        self.runtime_version = identity.get("version", "")
        if initialized.get("agentCapabilities", {}).get("_meta", {}).get("pero.userQuestions") != 1:
            raise TrialError("agent did not negotiate structured user questions")
        result = self.call("session/new", {"cwd": str(self.workspace), "mcpServers": []})
        self.session_id = result["sessionId"]
        self.call("session/set_config_option", {"sessionId": self.session_id, "configId": "permission",
                                                 "value": "full-access" if config.enable_shell else "workspace-write"})

    def _read(self) -> None:
        try:
            assert self.process and self.process.stdout
            for raw in self.process.stdout:
                if len(raw) > 8 << 20:
                    raise TrialError("ACP frame exceeds the supported limit")
                value = json.loads(raw)
                if not isinstance(value, dict):
                    raise TrialError("ACP frame must be an object")
                self.frames.put(value)
        except (ValueError, OSError) as error:
            self.frames.put(TrialError("agent stdout is not valid ACP JSONL"))
        finally:
            self.frames.put(None)

    def record(self, entry: dict) -> None:
        self.events += 1
        entry = {"seq": self.events, "elapsed_ms": round((time.monotonic() - self.started) * 1000, 1), **entry}
        encoded = json.dumps(entry, ensure_ascii=False)
        self.journal.write(encoded.replace(self.secret, "[credential-redacted]") + "\n")
        self.journal.flush()

    def send(self, value: dict) -> None:
        if not self.process or not self.process.stdin:
            raise TrialError("ACP process is unavailable")
        try:
            self.process.stdin.write((json.dumps(value, ensure_ascii=False) + "\n").encode())
            self.process.stdin.flush()
        except (BrokenPipeError, OSError):
            raise TrialError("ACP process input closed") from None

    def notify(self, method: str, params: dict) -> None:
        self.send({"jsonrpc": "2.0", "method": method, "params": params})

    def call(self, method: str, params: dict, cleanup_timeout: float | None = None) -> dict:
        self.sequence += 1
        request_id = self.sequence
        self.last_activity = time.monotonic()
        self.send({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
        deadline = time.monotonic() + cleanup_timeout if cleanup_timeout else self.started + self.config.session_timeout
        while True:
            now = time.monotonic()
            remaining = deadline - now
            if cleanup_timeout is None and method == "session/prompt":
                remaining = min(remaining, self.last_activity + self.config.idle_timeout - now)
            if remaining <= 0:
                raise TrialTimeout("session or idle timeout expired")
            try:
                frame = self.frames.get(timeout=remaining)
            except queue.Empty:
                raise TrialTimeout("session or idle timeout expired") from None
            if frame is None:
                raise TrialError("agent exited before the ACP response; submitted prompts are not retried")
            if isinstance(frame, Exception):
                raise frame
            self.last_activity = time.monotonic()
            if frame.get("method"):
                self.handle(frame)
            elif frame.get("id") == request_id:
                if "error" in frame:
                    raise TrialError("ACP request failed: " + method)
                result = frame.get("result")
                if not isinstance(result, dict):
                    raise TrialError("ACP response result must be an object")
                return result

    def handle(self, frame: dict) -> None:
        method, params = frame["method"], frame.get("params", {})
        if method == "session/update":
            update = params.get("update", {})
            kind = update.get("sessionUpdate")
            entry: dict = {"type": "ACPUpdate", "update": kind}
            if kind == "tool_call":
                name = update.get("title", "")
                self.tools[update.get("toolCallId", "")] = name
                self.tool_summary[name] = self.tool_summary.get(name, 0) + 1
                entry["type"] = "AssistantMessage"
                entry["blocks"] = [{"t": "tool", "name": name, "input": update.get("rawInput", {})}]
            elif kind == "agent_message_chunk":
                value = update.get("content", {}).get("text", "")
                entry["blocks"] = [{"t": "text", "len": len(value), "preview": value[:200]}]
            self.record(entry)
        elif method == "session/request_permission":
            delegated = params.get("_meta", {}).get("pero.dev/delegated-approval", {})
            call_id = params.get("toolCall", {}).get("toolCallId", "")
            tool = delegated.get("toolName") or self.tools.get(call_id, "")
            permitted = tool in {"Write", "Edit", "Read", "Glob", "Grep"} or tool == "Bash" and self.config.enable_shell
            option = "allow-once" if permitted and not self.closing else "reject-once"
            self.record({"type": "PermissionDecision", "tool": tool, "granted": option == "allow-once"})
            self.reply(frame, {"outcome": {"outcome": "selected", "optionId": option}})
        elif method == "_pero/user_questions/ask":
            questions = params.get("questions", [])
            if self.config.questions == "first-option" and not self.closing:
                answers, labels = [], {}
                for index, question in enumerate(questions):
                    options = question.get("options", [])
                    if not options:
                        raise TrialError("unattended question has no selectable option")
                    answers.append({"questionIndex": index, "selectedOptions": [0]})
                    labels[question.get("question", "")] = options[0]["label"]
                self.interactions.append(Interaction(tuple(labels), labels, round((time.monotonic() - self.started) * 1000, 1), "first-option"))
                self.reply(frame, {"outcome": "answered", "answers": answers})
            else:
                self.question_cancelled = True
                self.interactions.append(Interaction(tuple(question.get("question", "") for question in questions), {},
                                                     round((time.monotonic() - self.started) * 1000, 1), "cancel"))
                self.reply(frame, {"outcome": "cancelled"})
                self.notify("session/cancel", {"sessionId": self.session_id})
        elif "id" in frame:
            self.send({"jsonrpc": "2.0", "id": frame["id"], "error": {"code": -32601, "message": "trial client method unsupported"}})

    def reply(self, frame: dict, result: dict) -> None:
        self.send({"jsonrpc": "2.0", "id": frame["id"], "result": result})

    def close(self) -> CleanupResult:
        self.closing = True
        process = self.process
        failures = []

        def signal_group(number: int) -> None:
            if process is None:
                return
            try:
                os.killpg(process.pid, number)
            except ProcessLookupError:
                pass
            except OSError:
                failures.append("agent process-group signalling failed")

        try:
            if process and process.poll() is None:
                if self.session_id:
                    try:
                        self.notify("session/cancel", {"sessionId": self.session_id})
                        self.call("session/close", {"sessionId": self.session_id}, cleanup_timeout=3)
                    except (TrialError, TrialTimeout, OSError):
                        failures.append("ACP session/close failed or timed out")
                if process.stdin:
                    try:
                        process.stdin.close()
                    except OSError:
                        failures.append("ACP process input cleanup failed")
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    failures.append("agent required forced termination")
                    signal_group(signal.SIGTERM)
                    try:
                        process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        signal_group(signal.SIGKILL)
        except KeyboardInterrupt:
            failures.append("agent cleanup was interrupted")
        except OSError:
            failures.append("agent process cleanup failed")
        finally:
            if process:
                # RPC failures cannot skip the process-group and reader joins.
                signal_group(signal.SIGKILL)
                try:
                    process.wait(timeout=3)
                except (subprocess.TimeoutExpired, OSError):
                    failures.append("agent termination could not be confirmed")
                if self.reader:
                    self.reader.join(timeout=3)
                    if self.reader.is_alive():
                        failures.append("ACP stdout reader did not terminate")
                if process.stdout and (self.reader is None or not self.reader.is_alive()):
                    try:
                        process.stdout.close()
                    except OSError:
                        failures.append("ACP process output cleanup failed")
            for resource, label in ((self.stderr, "private agent stderr"), (self.journal, "trial journal")):
                try:
                    resource.close()
                except OSError:
                    failures.append(label + " cleanup failed")
        return CleanupResult(process is not None, process.returncode if process else None, tuple(dict.fromkeys(failures)))


def read_usage(directory: Path) -> Usage:
    values = []
    for path in (directory / "sessions").glob("*.jsonl"):
        for line in path.read_text().splitlines():
            event = json.loads(line).get("event", {})
            if event.get("type") != "assistant/message":
                continue
            usage = event.get("data", {}).get("usage")
            if usage is None:
                values.append(Usage(unreported_completions=1))
                continue
            keys = ("inputTokens", "outputTokens", "totalTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens")
            numbers = tuple(usage.get(key, None if key == "totalTokens" else 0) for key in keys)
            if any((value is None and index != 2) or value is not None and (type(value) is not int or value < 0) for index, value in enumerate(numbers)):
                raise TrialError("persisted provider usage is invalid")
            values.append(Usage(*numbers, reported_completions=1))
    return sum_usage(tuple(values))
