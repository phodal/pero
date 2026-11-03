#!/usr/bin/env python3
"""Replay a local, content-addressed plugin migration without executing plugins."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import shlex
import sys


class MigrationError(Exception):
    pass


GUARD = '''#!/bin/bash
# ask-buddy read-only guard
# Blocks Write/Edit/NotebookEdit unless targeting .ask-buddy/ directory

python3 -c '
import json
import os
import sys

try:
    data = json.load(sys.stdin)
    tool_input = data.get("tool_input", {})
    file_path = tool_input.get("file_path") or tool_input.get("notebook_path")
    cwd = os.path.realpath(data.get("cwd") or os.getcwd())
    memory = os.path.join(cwd, ".ask-buddy")
    if not isinstance(file_path, str) or not file_path:
        raise ValueError("missing target")
    target = os.path.realpath(os.path.join(cwd, file_path))
    if target != memory and os.path.commonpath([memory, target]) == memory:
        sys.exit(0)
except (ValueError, TypeError, AttributeError, OSError):
    pass

print("ask-buddy 是只读模式，只允许输出到 .ask-buddy/ 目录。如需修改源码请切换到其他工具。", file=sys.stderr)
sys.exit(2)
'
'''


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def transform(data, actions, root):
    """Typed transformations preserve unrelated source data without logging it."""
    for action in actions:
        kind = action["kind"]
        text = data.decode("utf-8")
        if kind == "wrap-hooks":
            value = json.loads(text)
            if "hooks" in value:
                raise MigrationError("hook wrapper precondition failed")
            data = json_bytes({"hooks": value})
        elif kind == "canonical-memory-guard":
            data = GUARD.encode()
        elif kind == "python-hook-exec-form":
            value = json.loads(text)
            for event in action["events"]:
                handler = value["hooks"][event][0]["hooks"][0]
                command = shlex.split(handler["command"])
                if len(command) != 2 or command[0] != "python3" or handler.get("args") != []:
                    raise MigrationError("Python hook precondition failed")
                handler["command"], handler["args"] = command[0], command[1:]
            data = json_bytes(value)
        elif kind == "frontmatter-add":
            fields = action["fields"]
            for key, value in fields.items():
                if key not in ("name", "description") or not isinstance(value, str) or any(c in value for c in "\n\r:#"):
                    raise MigrationError("invalid frontmatter addition")
            added = "".join(key + ": " + value + "\n" for key, value in fields.items())
            if text.startswith("---\n"):
                end = text.find("\n---\n", 4)
                if end == -1 or any(re.search(r"(?m)^" + re.escape(key) + r":", text[4:end]) for key in fields):
                    raise MigrationError("frontmatter precondition failed")
                data = ("---\n" + added + text[4:]).encode()
            else:
                data = ("---\n" + added + "---\n\n" + text).encode()
        elif kind == "agent-parameter-name":
            data = re.sub(r"\bagentType\b", "subagent_type", text).encode()
        elif kind == "explicit-agent-files":
            value = json.loads(text)
            files = sorted((root / "agents").glob("*.md"))
            if value.get("agents") != ["./agents/"] or not files:
                raise MigrationError("agent path precondition failed")
            value["agents"] = ["./agents/" + path.name for path in files]
            data = json_bytes(value)
        elif kind == "skill-session-substitution":
            old = "优先环境变量 `$CLAUDE_SESSION_ID`；没有则用"
            new = "使用 skill 加载时替换的 `${CLAUDE_SESSION_ID}`；若该占位符未展开，则用"
            if text.count(old) != 1:
                raise MigrationError("session substitution precondition failed")
            data = text.replace(old, new).encode()
        elif kind == "mcp-alias-and-timeout-units":
            value = json.loads(text)
            servers = value.get("mcpServers", value)
            if "MB-atlassian" not in servers or "mcp-atlassian" in servers:
                raise MigrationError("MCP alias precondition failed")
            servers = {("mcp-atlassian" if key == "MB-atlassian" else key): server for key, server in servers.items()}
            count = 0
            for server in servers.values():
                if server.get("type") == "http":
                    timeout = server.get("timeout")
                    if not isinstance(timeout, int) or isinstance(timeout, bool) or not 0 < timeout < 1000:
                        raise MigrationError("MCP timeout precondition failed")
                    server["timeout"] = timeout * 1000
                    count += 1
            if count != 4:
                raise MigrationError("MCP server count precondition failed")
            if "mcpServers" in value:
                value["mcpServers"] = servers
            else:
                value = servers
            data = json_bytes(value)
        elif kind == "documented-mcp-alias":
            if text.count("MB-atlassian") != 1:
                raise MigrationError("documented alias precondition failed")
            data = text.replace("MB-atlassian", "mcp-atlassian").encode()
        elif kind == "quoted-echo-separator":
            old = r'''/\becho\s+["']?={2,}["']?(?=\s|[;&|]|$)/'''
            new = r'''/\becho\s+={2,}(?=\s|[;&|]|$)/'''
            if text.count(old) != 1:
                raise MigrationError("quoted echo separator precondition failed")
            data = text.replace(old, new).encode()
        elif kind == "worktree-explicit-repository-paths":
            old = "args.repos.map(resolve)"
            if text.count(old) != 1:
                raise MigrationError("worktree repository path precondition failed")
            data = text.replace(old, "args.repos.map(path => resolve(path))").encode()
        else:
            raise MigrationError("unknown migration action")
    return data


def replay(plan, roots, check=False):
    if plan.get("version") != 1:
        raise MigrationError("unsupported migration version")
    prepared, results = [], []
    # Check the complete selected plan before the first write. Mismatched
    # snapshots never cause a partially applied migration.
    for operation in plan["files"]:
        plugin = operation["plugin"]
        if plugin not in roots:
            raise MigrationError("every selected plugin ID needs an explicit root")
        root = Path(roots[plugin]).resolve(strict=True)
        relative = Path(operation["path"])
        if relative.is_absolute() or ".." in relative.parts:
            raise MigrationError("migration paths must stay inside the plugin")
        path = (root / relative).resolve(strict=True)
        if not path.is_relative_to(root) or not path.is_file():
            raise MigrationError("migration target is not a contained regular file")
        original = path.read_bytes()
        current = digest(original)
        if current == operation["afterSHA256"]:
            results.append((plugin, operation["path"], "already-applied"))
            continue
        if current != operation["beforeSHA256"]:
            raise MigrationError("source digest does not match the migration snapshot")
        updated = transform(original, operation["actions"], root)
        if digest(updated) != operation["afterSHA256"]:
            raise MigrationError("transformed digest does not match the migration snapshot")
        prepared.append((path, updated))
        results.append((plugin, operation["path"], "checked" if check else "applied"))
    if not check:
        for path, updated in prepared:
            path.write_bytes(updated)  # Preserve the existing file mode.
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, default=Path(__file__).with_name("selected-config-v1.json"))
    parser.add_argument("--root", action="append", default=[], metavar="ID=PATH")
    parser.add_argument("--check", action="store_true")
    options = parser.parse_args()
    roots = {}
    for binding in options.root:
        plugin, separator, path = binding.partition("=")
        if not separator or not re.fullmatch(r"P\d{2}", plugin) or not path or plugin in roots:
            raise MigrationError("root bindings require distinct plugin IDs and paths")
        roots[plugin] = path
    plan = json.loads(options.plan.read_text())
    for plugin, path, status in replay(plan, roots, options.check):
        print(plugin + "/" + path + ": " + status)


if __name__ == "__main__":
    try:
        main()
    except (MigrationError, OSError, ValueError, KeyError, TypeError):
        # No raw configuration values, selected absolute paths or traceback.
        print("Migration refused: input, source digest or action precondition did not match.", file=sys.stderr)
        sys.exit(1)
