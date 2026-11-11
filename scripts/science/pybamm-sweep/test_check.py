from dataclasses import replace
import json
import math
import unittest

from contract import Result
from bundle import ROOT, load_identity
from check import check, read_results


class ConsistencyTests(unittest.TestCase):
    def test_reference_and_corruptions(self):
        identity = load_identity()
        reference = next(iter(read_results(ROOT / 'reference.jsonl').values()))
        for label, result, error in [
            ('unchanged', reference, ''),
            ('missing sample', replace(reference, voltage_v=reference.voltage_v[:-1]), 'missing samples'),
            ('wrong input', replace(reference, experiment=identity.method.experiments[1]), 'input mismatch'),
            ('wrong method', replace(reference, method_sha256='0' * 64), 'method mismatch'),
            ('wrong environment', replace(reference, environment=replace(reference.environment, python='3.13.0')), 'environment mismatch'),
            ('early cutoff', replace(reference, termination='event: Minimum voltage'), 'incomplete time'),
            ('wrong voltage', replace(reference, voltage_v=tuple(v + 0.001 for v in reference.voltage_v)), 'voltage differs'),
            ('wrong current', replace(reference, current_a=tuple(0 for _ in reference.current_a)), 'constant current'),
            ('wrong charge', replace(reference, discharge_capacity_ah=tuple(0 for _ in reference.time_s)), 'charge balance'),
        ]:
            with self.subTest(label=label):
                errors = check(result, reference, identity)
                if error:
                    self.assertIn(error, '; '.join(errors))
                else:
                    self.assertEqual(errors, ())

    def test_nonfinite_wire_values(self):
        raw = json.loads((ROOT / 'reference.jsonl').read_text().splitlines()[0])
        for value in (math.nan, math.inf, True, '4.0'):
            with self.subTest(value=value):
                raw['voltage_v'][0] = value
                with self.assertRaises(ValueError):
                    Result.parse(raw)


if __name__ == '__main__':
    unittest.main()
