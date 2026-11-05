"""External judge acceptance, exercised with actual unittest processes."""
from pathlib import Path
import tempfile
import unittest

from run_benchmark import judge


class JudgeTests(unittest.TestCase):
    def test_unittest_acceptance_requires_nonempty_unskipped_success(self):
        for name, body, passed, counts in [
            ("passed", "class Contract(unittest.TestCase):\n"
             "    def test_value(self): self.assertEqual(VALUE, 1)\n", True, (1, 0, 0, 0)),
            ("failed", "class Contract(unittest.TestCase):\n"
             "    def test_value(self): self.assertEqual(VALUE, 2)\n", False, (1, 1, 0, 0)),
            ("error", "class Contract(unittest.TestCase):\n"
             "    def test_value(self): raise ValueError('check error')\n", False, (1, 0, 1, 0)),
            ("empty", "", False, (0, 0, 0, 0)),
            ("skipped", "@unittest.skip('not executed')\n"
             "class Contract(unittest.TestCase):\n"
             "    def test_value(self): self.assertEqual(VALUE, 1)\n", False, (1, 0, 0, 1)),
        ]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                source = root / "official"
                source.mkdir()
                (source / "contract_test.py").write_text("import unittest\nfrom solution import VALUE\n" + body)
                result = judge(source, {"solution.py": b"VALUE = 1\n"}, ["contract_test.py"], root / "judge")
                self.assertEqual(result["passed"], passed)
                self.assertEqual(tuple(result[k] for k in ("tests", "failures", "errors", "skipped")), counts)
                self.assertEqual(result["exit_code"], int(name in ("failed", "error")))


if __name__ == "__main__":
    unittest.main()
