import tempfile
import unittest
from pathlib import Path

from analyze import PairedMeasurement, read_measurements, summarize


class PairedAnalysisTests(unittest.TestCase):
    def test_measurement_boundary(self):
        header = 'sample_id,before,after,unit\n'
        for body, failure in [
            ('a,10,13,mg/L\nb,12,,mg/L\n', None),
            ('a,10,13,mg/L\na,12,15,mg/L\n', 'duplicate'),
            ('a,nan,13,mg/L\n', 'Nonfinite'),
            ('a,10,inf,mg/L\n', 'Nonfinite'),
            ('a,10,13,g/L\n', 'mg/L'),
        ]:
            with self.subTest(body=body), tempfile.TemporaryDirectory() as directory:
                source = Path(directory) / 'input.csv'
                source.write_text(header + body)
                if failure:
                    with self.assertRaisesRegex(ValueError, failure):
                        read_measurements(source)
                else:
                    result = summarize(read_measurements(source))
                    self.assertEqual(result['mean_change'], 3)
                    self.assertEqual(result['missing_ids'], ['b'])

    def test_complete_pair_contract(self):
        for rows, expected in [
            ((PairedMeasurement('a', 10, 13), PairedMeasurement('b', 15, 20)), 4),
            ((PairedMeasurement('a', 0, 0),), 0),
            ((PairedMeasurement('a', 10, None),), None),
            ((), None),
        ]:
            with self.subTest(rows=rows):
                if expected is None:
                    with self.assertRaisesRegex(ValueError, 'No complete pairs'):
                        summarize(rows)
                else:
                    self.assertEqual(summarize(rows)['mean_change'], expected)
