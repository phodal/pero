"""Geometry and admission checks, without OCR engines or file I/O."""
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from paper_agent.axis_calibration import AxisCalibration
from paper_agent.model import Invalid


def axis(values=(0, 1, 2), pixels=(0, 100, 200), **changes):
    return dict(ticks=[dict(pixel=p, rawText=str(v), value=v) for p, v in zip(pixels, values)],
                unitConfirmed=True, multiplierConfirmed=True, transcriptionConfirmed=True, pixel=50, **changes)


class AxisCalibrationTest(unittest.TestCase):
    def test_geometry_table(self):
        cases = [
            ('linear', axis(), 'linear', .5),
            ('unequal ticks', axis((0, 1, 3), (0, 100, 300)), 'linear', .5),
            ('reversed pixels', axis((0, 1, 2), (200, 100, 0)), 'linear', 1.5),
            ('negative linear', axis((-2, -1, 0)), 'linear', -1.5),
            ('positive logarithm', axis((1, 10, 100)), 'log', 10 ** .5),
            ('explicit two ticks', axis((0, 2), (0, 200), scale='linear', scaleConfirmed=True), 'linear', .5),
            ('multiplier', axis(multiplier=.001), 'linear', .0005),
        ]
        for name, payload, scale, expected in cases:
            with self.subTest(name=name):
                result = AxisCalibration.parse(payload)
                self.assertEqual(result.issues, ())
                self.assertEqual(result.selected_scale, scale)
                self.assertAlmostEqual(result.point_value(), expected)

    def test_blocking_table(self):
        cases = [
            (axis((1, 10), (0, 200)), 'insufficient_ticks'),
            (axis((1, 10), (0, 200), scale='log'), 'insufficient_ticks'),
            (axis((0, 1, 2), (0, 100, 100)), 'tick_geometry_degenerate'),
            (axis((0, 1, 2), (0, 1, 2)), 'tick_geometry_degenerate'),
            (axis((0, 2, 1)), 'tick_values_not_monotonic'),
            (axis((0, 1, 2), (0, 100, 300)), 'axis_geometry_inconsistent'),
            (axis((0, 1, 2), scale='log', scaleConfirmed=True), 'declared_scale_inconsistent'),
            (dict(axis(), pixel=-1), 'point_outside_axis'),
            (dict(axis(), unitConfirmed=False), 'axis_unit_unconfirmed'),
            (dict(axis(), multiplierConfirmed=False), 'axis_multiplier_unconfirmed'),
            (dict(axis(), transcriptionConfirmed=False), 'tick_transcription_unconfirmed'),
            (axis((100, 101, 102)), 'ambiguous_scale'),
        ]
        for payload, issue in cases:
            with self.subTest(issue=issue):
                result = AxisCalibration.parse(payload)
                self.assertIn(issue, result.issues)
                with self.assertRaises(Invalid):
                    result.point_value()

    def test_missing_sign_and_decimal_are_never_repaired(self):
        for raw, value in [('3', -3), ('1', .01), ('1,000', 1000)]:
            payload = axis()
            payload['ticks'][1].update(rawText=raw, value=value)
            result = AxisCalibration.parse(payload)
            self.assertIn('tick_transcription_mismatch', result.issues)
            self.assertEqual(result.ticks[1].raw_text, raw)
            self.assertEqual(result.ticks[1].value, value)

    def test_systematic_decimal_error_requires_transcription_check(self):
        result = AxisCalibration.parse(dict(axis((1, 2, 3)), transcriptionConfirmed=False))
        self.assertEqual(result.selected_scale, 'linear')
        self.assertIn('tick_transcription_unconfirmed', result.issues)

    def test_extreme_finite_ticks_fail_closed_without_overflow(self):
        result = AxisCalibration.parse(axis((-1e308, 0, 1e308)))
        if not result.issues:
            self.assertAlmostEqual(result.point_value() / 1e308, -.5)
        else:
            with self.assertRaises(Invalid):
                result.point_value()

    def test_invalid_input_table(self):
        for changes in [dict(multiplier=0), dict(multiplier=float('nan')), dict(pixel=True), dict(pixel=10 ** 400),
                        dict(scale='symlog'), dict(scaleConfirmed='yes'), dict(ticks=None)]:
            with self.subTest(changes=changes), self.assertRaises(Invalid):
                AxisCalibration.parse(dict(axis(), **changes))
