"""Model answer admission preserves errors instead of silently dropping attempts."""
import unittest
from evaluate import Answer


class Answers(unittest.TestCase):
    def test_answer_boundary(self):
        base = dict(status='answered', sql='SELECT :n', parameters={'n': 1}, reason='Local test')
        for value, accepted in [(base, True), (base | {'status': 'clarify', 'sql': ''}, True),
                (base | {'status': 'refused', 'sql': ''}, True), (base | {'status': 'clarify'}, False),
                (base | {'status': 'success'}, False), (base | {'parameters': {'n': True}}, False),
                (base | {'permissions': 'admin'}, False)]:
            with self.subTest(value=value):
                if accepted:
                    Answer.parse(value)
                else:
                    with self.assertRaises(ValueError):
                        Answer.parse(value)
