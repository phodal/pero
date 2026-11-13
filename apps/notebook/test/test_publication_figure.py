"""Data semantics for the explicit example; rendering is checked by its real CLI."""
import importlib.util
from fractions import Fraction
from pathlib import Path
import sys
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'examples/publication/generate_figure.py'
spec = importlib.util.spec_from_file_location('publication_figure_example', SCRIPT)
example = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = example
spec.loader.exec_module(example)


class PublicationFigureDataTests(unittest.TestCase):
    def test_reviewed_data_and_edited_variant_remain_distinct(self):
        source = example.DATA.read_bytes()
        original = example.FigureDataset.parse(source)
        self.assertEqual(original.status, 'reviewed-transcription')
        self.assertEqual([len(group.lengths_cm) for group in original.series], [50, 50])
        self.assertEqual(sum(group.sum_squares_cm2 for group in original.series), Fraction(95717, 5000))
        edited = example.FigureDataset.parse(source.replace(b'setosa,1,5.1', b'setosa,1,5.2'))
        self.assertEqual(edited.status, 'edited-input-variant')
        self.assertNotEqual(edited.sha256, original.sha256)
        self.assertNotEqual(edited.series[0].sum_squares_cm2, original.series[0].sum_squares_cm2)
        self.assertEqual(edited.series[1], original.series[1])

    def test_missing_duplicate_or_nonfinite_observations_are_not_silently_dropped(self):
        source = example.DATA.read_bytes()
        cases = [source.replace(b'setosa,1,5.1\n', b''),
                 source.replace(b'setosa,2,4.9', b'setosa,1,4.9'),
                 source.replace(b'setosa,1,5.1', b'setosa,1,nan'),
                 source.replace(b'setosa,1,5.1', b'setosa,1,0'),
                 source.replace(b'setosa,1,5.1', b'setosa,1,inf'),
                 source.replace(b'setosa,1,5.1', b'setosa,1'),
                 source.replace(b'setosa,1,5.1', b'setosa,1,5.1,extra')]
        for data in cases:
            with self.subTest(data=data[:70]), self.assertRaises(ValueError):
                example.FigureDataset.parse(data)


if __name__ == '__main__':
    unittest.main()
