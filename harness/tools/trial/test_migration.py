import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from core import TrialError
from migrate_plugin import LAUNCHER, SKILL_APPENDIX, digest, migrate


def migration_fixture(root):
    entry, skill = root / "scripts/run_trial.py", root / "skills/plugin-tuning/SKILL.md"
    entry.parent.mkdir(parents=True)
    skill.parent.mkdir(parents=True)
    entry.write_text("print('original-claude-runner')\n")
    skill.write_text("# Trial instructions\n")
    plan = {"version": 1, "plugin": "P09", "files": []}
    for role, path, updated in (("entry", entry, LAUNCHER.encode()), ("skill", skill, skill.read_bytes() + SKILL_APPENDIX.encode())):
        plan["files"].append({"role": role, "path": path.relative_to(root).as_posix(),
                              "beforeSHA256": digest(path.read_bytes()), "afterSHA256": digest(updated)})
    return plan


class TrialMigration(unittest.TestCase):
    def test_complete_preflight_and_original_runner_preservation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            plan = migration_fixture(root)
            entry = root / "scripts/run_trial.py"
            original = entry.read_bytes()
            plan["files"][1]["beforeSHA256"] = "0" * 64
            with self.assertRaises(TrialError):
                migrate(root, plan)
            self.assertEqual(entry.read_bytes(), original)
            self.assertFalse(entry.with_name("run_trial_claude.py").exists())
            plan["files"][1]["beforeSHA256"] = digest((root / "skills/plugin-tuning/SKILL.md").read_bytes())
            self.assertEqual(migrate(root, plan, check=True), "checked")
            self.assertEqual(entry.read_bytes(), original)
            self.assertEqual(migrate(root, plan), "applied")
            self.assertEqual(migrate(root, plan), "already-applied")
            self.assertEqual(entry.with_name("run_trial_claude.py").read_bytes(), original)
            legacy = subprocess.run([sys.executable, str(entry)], input="{}", capture_output=True, text=True, check=True)
            self.assertEqual(legacy.stdout.strip(), "original-claude-runner")
            selected = subprocess.run([sys.executable, str(entry)], input=json.dumps({"runtime": "harness", "harness_runner": "relative.py"}), capture_output=True, text=True)
            self.assertEqual(selected.returncode, 2)
            self.assertFalse(json.loads(selected.stdout)["pipeline_complete"])


if __name__ == "__main__":
    unittest.main()
