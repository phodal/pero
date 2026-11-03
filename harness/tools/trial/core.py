"""Typed values and completion rules for one unattended ACP trial."""

from __future__ import annotations

from dataclasses import dataclass
import math
from pathlib import Path
import re
from urllib.parse import urlparse


class TrialError(ValueError):
    """An explicit trial configuration or protocol failure."""


def text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip() or "\x00" in value:
        raise TrialError(label + " must be a nonempty string")
    return value


def integer(value: object, label: str, minimum: int, maximum: int) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise TrialError(label + " is outside its supported integer range")
    return value


def seconds(value: object, label: str) -> float:
    if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
        raise TrialError(label + " must be finite and positive")
    return float(value)


def patterns(value: object) -> tuple[str, ...]:
    if not isinstance(value, list) or not value:
        raise TrialError("at least one success artifact pattern is required")
    result = []
    for item in value:
        item = text(item, "success pattern")
        if Path(item).is_absolute() or ".." in Path(item).parts or "\\" in item:
            raise TrialError("success patterns must stay inside the trial workspace")
        result.append(item)
    return tuple(result)


@dataclass(frozen=True)
class SessionSpec:
    name: str
    prompt: str
    success_patterns: tuple[str, ...]
    max_continuations: int

    @staticmethod
    def parse(raw: object) -> SessionSpec:
        if not isinstance(raw, dict) or set(raw) - {"name", "prompt", "success_artifact", "success_patterns", "max_continuations"}:
            raise TrialError("invalid session fields")
        name = text(raw.get("name"), "session name")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", name):
            raise TrialError("session name must be a plain identifier")
        if "success_artifact" in raw and "success_patterns" in raw:
            raise TrialError("use success_artifact or success_patterns, not both")
        selected = raw.get("success_patterns")
        if selected is None:
            selected = [raw.get("success_artifact")]
        return SessionSpec(name, text(raw.get("prompt"), "prompt"), patterns(selected),
                           integer(raw.get("max_continuations", 30), "max_continuations", 0, 1000))


@dataclass(frozen=True)
class ModelRoute:
    alias: str
    model: str


@dataclass(frozen=True)
class TrialConfig:
    plugin: Path
    base_workspace: Path
    binary: Path
    endpoint: str
    model: str
    api_key_env: str
    plugin_models: tuple[ModelRoute, ...]
    sessions: tuple[SessionSpec, ...]
    final_patterns: tuple[str, ...]
    session_timeout: float
    idle_timeout: float
    max_requests: int
    max_tokens: int
    questions: str
    enable_shell: bool
    context_source: Path | None
    permission_mode: str

    @staticmethod
    def parse(raw: object) -> TrialConfig:
        allowed = {"runtime", "harness_runner", "plugin_path", "workspace", "agent_binary", "endpoint", "model", "api_key_env",
                   "sessions", "prompt", "success_patterns", "max_continuations", "session_timeout", "timeout", "idle_timeout",
                   "max_requests", "max_tokens", "budget", "max_retries", "unattended_questions", "enable_shell", "shell_policy", "context_source", "plugin_models", "permission_mode"}
        if not isinstance(raw, dict) or set(raw) - allowed:
            raise TrialError("unknown or invalid trial fields")
        if raw.get("runtime", "harness") != "harness":
            raise TrialError("this adapter only runs the harness runtime")
        if type(raw.get("budget", 0)) not in (int, float) or raw.get("budget", 0) != 0:
            raise TrialError("USD budget is unsupported; use max_requests instead")
        if type(raw.get("max_retries", 0)) is not int or raw.get("max_retries", 0) != 0:
            raise TrialError("trial retries are unsupported because submitted prompts may have effects")
        if "session_timeout" in raw and "timeout" in raw:
            raise TrialError("use session_timeout or timeout, not both")
        endpoint = text(raw.get("endpoint"), "endpoint")
        parsed = urlparse(endpoint)
        if parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.hostname:
            raise TrialError("endpoint must not contain credentials, query or fragment")
        if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1", "::1")):
            raise TrialError("endpoint requires HTTPS or loopback HTTP")
        key = text(raw.get("api_key_env"), "api_key_env")
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise TrialError("api_key_env must name an environment variable")
        routes = raw.get("plugin_models", {})
        if not isinstance(routes, dict) or len(routes) > 32:
            raise TrialError("plugin_models must map at most 32 explicit aliases to model IDs")
        models = tuple(ModelRoute(text(alias, "plugin model alias"), text(model, "plugin model ID")) for alias, model in routes.items())
        if any("=" in route.alias or "=" in route.model for route in models):
            raise TrialError("plugin model routes must not contain an equals sign")
        plugin = Path(text(raw.get("plugin_path"), "plugin_path"))
        binary = Path(text(raw.get("agent_binary"), "agent_binary"))
        workspace = Path(text(raw.get("workspace"), "workspace"))
        if not all(path.is_absolute() for path in (plugin, binary, workspace)):
            raise TrialError("plugin, agent and workspace paths must be normalized absolute paths")
        if "sessions" in raw:
            if "prompt" in raw or "max_continuations" in raw:
                raise TrialError("sessions cannot be combined with single-session prompt settings")
            supplied = raw["sessions"]
            if not isinstance(supplied, list) or not supplied or len(supplied) > 64:
                raise TrialError("sessions must contain 1..64 entries")
            final_patterns = patterns(raw["success_patterns"]) if "success_patterns" in raw else ()
        else:
            supplied = [{"name": "main", "prompt": raw.get("prompt"), "success_patterns": raw.get("success_patterns"),
                         "max_continuations": raw.get("max_continuations", 50)}]
            final_patterns = ()
        sessions = tuple(SessionSpec.parse(item) for item in supplied)
        if len({item.name for item in sessions}) != len(sessions):
            raise TrialError("session names must be unique")
        questions = raw.get("unattended_questions", "cancel")
        if questions not in ("cancel", "first-option"):
            raise TrialError("unattended_questions must be cancel or first-option")
        enable_shell = raw.get("enable_shell", False)
        if type(enable_shell) is not bool or (enable_shell and raw.get("shell_policy") != "allow-unsandboxed"):
            raise TrialError("enabling shell requires explicit shell_policy allow-unsandboxed")
        if not enable_shell and "shell_policy" in raw:
            raise TrialError("shell_policy requires enable_shell")
        permission = raw.get("permission_mode", "full-access" if enable_shell else "workspace-write")
        if not isinstance(permission, str) or permission not in {"read-only", "workspace-write", "full-access", "auto-review"}:
            raise TrialError("permission_mode must select an existing ACP permission mode")
        context = raw.get("context_source")
        return TrialConfig(plugin, workspace, binary, endpoint,
                           text(raw.get("model"), "model"), key, models, sessions, final_patterns,
                           seconds(raw.get("session_timeout", raw.get("timeout", 3600)), "session_timeout"),
                           seconds(raw.get("idle_timeout", 600), "idle_timeout"),
                           integer(raw.get("max_requests", 64), "max_requests", 1, 100000),
                           integer(raw.get("max_tokens", 4096), "max_tokens", 1, 1048576), questions, enable_shell,
                           Path(text(context, "context_source")) if context is not None else None, permission)

    @property
    def required_patterns(self) -> tuple[str, ...]:
        selected = [pattern for session in self.sessions for pattern in session.success_patterns]
        return tuple(dict.fromkeys((*selected, *self.final_patterns)))


@dataclass(frozen=True)
class ArtifactMatch:
    pattern: str
    matches: tuple[str, ...]


def session_succeeded(matches: tuple[ArtifactMatch, ...], stop: str, fatal: bool) -> bool:
    return not fatal and stop == "end_turn" and bool(matches) and all(item.matches for item in matches)


@dataclass(frozen=True)
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int | None = None
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    reasoning_tokens: int = 0
    reported_completions: int = 0
    unreported_completions: int = 0


def sum_usage(values: tuple[Usage, ...]) -> Usage:
    totals = []
    for field in Usage.__dataclass_fields__:
        observations = tuple(getattr(value, field) for value in values)
        totals.append(None if field == "total_tokens" and (not observations or None in observations) else sum(observations))
    return Usage(*totals)


@dataclass(frozen=True)
class Interaction:
    questions: tuple[str, ...]
    answers: dict[str, str]
    elapsed_ms: float
    policy: str


@dataclass(frozen=True)
class SessionReceipt:
    session: str
    session_id: str
    agent_pid: int
    runtime_version: str
    duration_ms: float
    success: bool
    continuations: int
    timed_out: bool
    events: int
    interactions: tuple[Interaction, ...]
    journal_path: str
    session_directory: str
    stop_reason: str
    diagnostic: str
    artifact_matches: tuple[ArtifactMatch, ...]
    usage: Usage
    http_attempts: int
    tool_summary: dict[str, int]
    agent_exit_code: int | None = None
    cleanup_failures: tuple[str, ...] = ()


@dataclass(frozen=True)
class CleanupResult:
    process_started: bool
    exit_code: int | None
    errors: tuple[str, ...]

    @property
    def failures(self) -> tuple[str, ...]:
        errors = self.errors
        if self.process_started and self.exit_code != 0:
            message = "agent termination is unconfirmed" if self.exit_code is None else "agent exited with code " + str(self.exit_code)
            errors += (message + "; inspect private agent.stderr",)
        return errors

    @property
    def succeeded(self) -> bool:
        return not self.failures


def pipeline_succeeded(receipts: tuple[SessionReceipt, ...], requested_sessions: int,
                       matches: tuple[ArtifactMatch, ...], fatal: bool = False) -> bool:
    incomplete = len(receipts) != requested_sessions or not all(item.success for item in receipts)
    return bool(receipts) and session_succeeded(matches, "end_turn", fatal or incomplete)
