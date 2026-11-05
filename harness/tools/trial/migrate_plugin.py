#!/usr/bin/env python3
"""Install a content-addressed runtime selector into one explicit local package."""

import argparse
import hashlib
import json
from pathlib import Path
import sys

from core import TrialError


LAUNCHER = '''#!/usr/bin/env python3
"""Select the original Claude trial or an explicit Harness ACP adapter."""
import io
import json
from pathlib import Path
import runpy
import sys

def main():
    config = json.load(sys.stdin)
    runtime = config.get("runtime", "claude")
    if runtime == "claude":
        runner = Path(__file__).with_name("run_trial_claude.py")
    elif runtime == "harness":
        value = config.get("harness_runner")
        if not isinstance(value, str) or not Path(value).is_absolute():
            raise ValueError("harness_runner must be an explicit absolute adapter path")
        runner = Path(value).resolve(strict=True)
    else:
        raise ValueError("runtime must be claude or harness")
    sys.path.insert(0, str(runner.parent))
    sys.stdin = io.StringIO(json.dumps(config))
    runpy.run_path(str(runner), run_name="__main__")

if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, TypeError):
        print(json.dumps({"pipeline_complete": False, "error": "trial runtime selection failed"}))
        sys.exit(2)
'''

SKILL_APPENDIX = '''

## Harness trial runtime

The same `scripts/run_trial.py` entry supports an explicit Harness ACP adapter.
Keep `runtime: "claude"` (the default) for the original Claude Agent SDK runner.
For Harness, pass `runtime: "harness"`, an absolute `harness_runner` path to
`harness/tools/trial/run_trial.py`, and explicit `agent_binary`, `endpoint`,
`model`, and `api_key_env`. The credential is read from that environment
variable; never put its value in trial JSON. Retain plugin_path, workspace,
sessions or prompt, success_patterns, session_timeout/idle_timeout and
max_continuations as needed. Optional plugin_models maps required plugin model
aliases to explicit provider model IDs on the same configured endpoint.

Harness trials require `budget: 0` and `max_retries: 0`; use a positive
`max_requests` instead of a USD budget. Unknown pricing is not estimated.
Every success pattern must match and the turn must end normally; cancelled or
failed sessions cannot succeed merely because a file exists. Submitted prompts
are never automatically retried. Continuations stay in the same ACP session.
First-option answers require explicit `unattended_questions: "first-option"`;
the default cancels the question and trial turn. Shell is disabled by default;
enabling unsandboxed commands requires both `enable_shell: true` and
`shell_policy: "allow-unsandboxed"`. Only run trusted local plugin code.

Receipts retain pipeline/session/artifact/journal fields and identify
`runtime: "pero-agent-acp"`. Usage comes from committed provider-reported
records, with missing reports counted explicitly; `cost_usd` remains null.
Top-level duration_ms/success/journal_path/tool_summary projections allow the
existing analyze.py and compare.py tools to consume the receipt directly.
'''


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def migrate(root: Path, plan: dict, check: bool = False) -> str:
    root = root.resolve(strict=True)
    if plan.get("version") != 1 or plan.get("plugin") != "P09":
        raise TrialError("unsupported trial migration plan")
    selected = {}
    for item in plan["files"]:
        relative = Path(item["path"])
        if relative.is_absolute() or ".." in relative.parts:
            raise TrialError("migration path must remain local")
        path = root / relative
        if path.is_symlink() or not path.resolve(strict=True).is_relative_to(root):
            raise TrialError("migration target is outside the selected package")
        selected[item["role"]] = (path, path.read_bytes(), item)
    entry, skill = selected["entry"], selected["skill"]
    backup = entry[0].with_name("run_trial_claude.py")
    current = (digest(entry[1]), digest(skill[1]))
    after = (entry[2]["afterSHA256"], skill[2]["afterSHA256"])
    if current == after:
        if backup.is_symlink() or digest(backup.read_bytes()) != entry[2]["beforeSHA256"]:
            raise TrialError("original Claude runner backup is missing or changed")
        return "already-applied"
    if current != (entry[2]["beforeSHA256"], skill[2]["beforeSHA256"]) or backup.exists():
        raise TrialError("trial migration source does not match its snapshot")
    updated = (LAUNCHER.encode(), skill[1] + SKILL_APPENDIX.encode())
    if tuple(digest(value) for value in updated) != after:
        raise TrialError("trial migration result digest mismatch")
    if not check:
        backup.write_bytes(entry[1])
        backup.chmod(entry[0].stat().st_mode & 0o777)
        entry[0].write_bytes(updated[0])
        skill[0].write_bytes(updated[1])
    return "checked" if check else "applied"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    options = parser.parse_args()
    try:
        plan = json.loads(Path(__file__).with_name("MIGRATION.json").read_text())
        print(migrate(options.root, plan, options.check))
        return 0
    except (TrialError, OSError, ValueError, KeyError, TypeError):
        print("Trial migration refused: source or result digest did not match.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
