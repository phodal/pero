import json
import shutil
from pathlib import Path
import subprocess
import tempfile
import unittest

import replay


class MigrationTests(unittest.TestCase):
    def test_quoted_echo_separator_retains_existing_bare_command_policy(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("Node is needed for the plugin hook expression")
        source = r'''const unsafe = text => /(?:^|[;&|]\s*)(?:={2,}[A-Za-z0-9_-]*|[A-Za-z0-9_-]*={2,})(?=\s|[;&|]|$)/.test(text)
            || /\becho\s+["']?={2,}["']?(?=\s|[;&|]|$)/.test(text);
        const inputs = JSON.parse(process.argv[1]);
        console.log(JSON.stringify(inputs.map(unsafe)));
        '''.encode()
        cases = [
            ('git diff BASE --stat && echo "=== full diff ===" && git diff BASE', False),
            ('cat .gitignore; echo "=== sec grep ==="; grep token labels.py', False),
            ('echo "== greps =="; git status --porcelain', False),
            ("head -20 a; echo '==='; head -5 b", False),
            ('printf "%s\\n" "=== diff ==="', False),
            ('head -20 a; echo ===; head -5 b', True),
            ('git status; ===; git diff', True),
            ('git status && ===heading && git diff', True),
        ]
        updated = replay.transform(source, [{"kind": "quoted-echo-separator"}], Path("."))
        result = subprocess.run([node, "-e", updated.decode(), json.dumps([row[0] for row in cases])],
                                text=True, capture_output=True, check=True, timeout=5)
        self.assertEqual(json.loads(result.stdout), [row[1] for row in cases])
        with self.assertRaises(replay.MigrationError):
            replay.transform(updated, [{"kind": "quoted-echo-separator"}], Path("."))

    def test_content_addressed_replay_is_idempotent_and_preflights_all_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            before = b'{"PreToolUse": []}\n'
            after = replay.transform(before, [{"kind": "wrap-hooks"}], root)
            files = []
            for name in ("first.json", "second.json"):
                (root / name).write_bytes(before)
                files.append({"plugin": "P01", "path": name, "beforeSHA256": replay.digest(before), "afterSHA256": replay.digest(after), "actions": [{"kind": "wrap-hooks"}]})
            plan = {"version": 1, "files": files}
            (root / "second.json").write_text("unexpected source")
            with self.assertRaises(replay.MigrationError):
                replay.replay(plan, {"P01": root})
            self.assertEqual((root / "first.json").read_bytes(), before)
            (root / "second.json").write_bytes(before)
            result = replay.replay(plan, {"P01": root}, check=True)
            self.assertEqual([row[2] for row in result], ["checked", "checked"])
            self.assertEqual((root / "first.json").read_bytes(), before)
            replay.replay(plan, {"P01": root})
            self.assertEqual((root / "first.json").read_bytes(), after)
            result = replay.replay(plan, {"P01": root})
            self.assertEqual([row[2] for row in result], ["already-applied", "already-applied"])
            (root / "first.json").write_bytes(before)
            files[0]["afterSHA256"] = "0" * 64
            with self.assertRaises(replay.MigrationError):
                replay.replay(plan, {"P01": root})
            self.assertEqual((root / "first.json").read_bytes(), before)

    def test_mcp_migration_preserves_opaque_source_configuration(self):
        servers = {"MB-atlassian": {"command": "opaque-program", "args": ["opaque-argument"]}}
        for index in range(4):
            servers["fixture-" + str(index)] = {"type": "http", "timeout": 120, "opaque": {"value": str(index)}}
        data = replay.json_bytes({"mcpServers": servers})
        result = json.loads(replay.transform(data, [{"kind": "mcp-alias-and-timeout-units"}], Path(".")))["mcpServers"]
        self.assertNotIn("MB-atlassian", result)
        self.assertEqual(result["mcp-atlassian"], servers["MB-atlassian"])
        for index in range(4):
            self.assertEqual(result["fixture-" + str(index)], {"type": "http", "timeout": 120000, "opaque": {"value": str(index)}})

    def test_guard_uses_tool_input_and_canonical_workspace_memory(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / "workspace with spaces"
            root.mkdir()
            memory = root / ".ask-buddy"
            memory.mkdir()
            outside = base / "outside"
            outside.mkdir()
            (memory / "escape").symlink_to(outside, target_is_directory=True)
            script = base / "guard with spaces.sh"
            script.write_text(replay.GUARD)
            cases = [
                ("relative memory", {"tool_name": "Write", "tool_input": {"file_path": ".ask-buddy/notes.md"}}, 0),
                ("absolute memory", {"tool_name": "Edit", "tool_input": {"file_path": str(memory / "notes.md")}}, 0),
                ("notebook memory", {"tool_name": "NotebookEdit", "tool_input": {"notebook_path": str(memory / "notes.ipynb")}}, 0),
                ("source", {"tool_input": {"file_path": "src/source.go"}}, 2),
                ("traversal", {"tool_input": {"file_path": ".ask-buddy/../source.go"}}, 2),
                ("symlink escape", {"tool_input": {"file_path": ".ask-buddy/escape/file.md"}}, 2),
                ("outside memory", {"tool_input": {"file_path": str(outside / ".ask-buddy/file.md")}}, 2),
                ("prefix sibling", {"tool_input": {"file_path": ".ask-buddy-other/file.md"}}, 2),
                ("top-level spoof", {"file_path": str(memory / "notes.md"), "tool_input": {"file_path": "src/source.go"}}, 2),
                ("legacy top-level", {"file_path": str(memory / "notes.md")}, 2),
                ("missing target", {"tool_input": {}}, 2),
            ]
            for name, payload, expected in cases:
                with self.subTest(name=name):
                    payload["cwd"] = str(root)
                    outcome = subprocess.run(["bash", str(script)], input=json.dumps(payload), text=True, capture_output=True, cwd=root, timeout=5)
                    self.assertEqual(outcome.returncode, expected)
            outcome = subprocess.run(["bash", str(script)], input="not json", text=True, capture_output=True, cwd=root, timeout=5)
            self.assertEqual(outcome.returncode, 2)
            # Even a symlink replacing the memory directory cannot move the
            # guard's write scope outside the declared workspace.
            other = base / "symlink workspace"
            other.mkdir()
            (other / ".ask-buddy").symlink_to(outside, target_is_directory=True)
            payload = {"cwd": str(other), "tool_input": {"file_path": ".ask-buddy/file.md"}}
            outcome = subprocess.run(["bash", str(script)], input=json.dumps(payload), text=True, capture_output=True, cwd=other, timeout=5)
            self.assertEqual(outcome.returncode, 2)
            self.assertEqual(list(outside.iterdir()), [])
            self.assertFalse((memory / "notes.md").exists())


if __name__ == "__main__":
    unittest.main()
