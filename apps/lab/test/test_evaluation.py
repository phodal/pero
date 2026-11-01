import unittest
from domain import EvaluationCriteria, Invalid, validate_protocol, initial_state
from evaluation import Measurement, Observation, evaluate, parse_observation
from test_domain import protocol


class EvaluationTests(unittest.TestCase):
    def test_independent_outcomes_and_no_fabricated_improvement(self):
        criteria = EvaluationCriteria()
        state = validate_protocol(initial_state(), protocol())[-1]
        cases = [(None, 'completed', 'INCONCLUSIVE', None),
                 (.6, 'completed', 'FAIL', .1), (.5, 'completed', 'PASS', 0),
                 (.7, 'completed', 'FAIL', .2), (.5, 'unknown', 'INCONCLUSIVE', 0)]
        for value, execution, verdict, error in cases:
            observation = Observation('synthetic', 'fixed +0.1 illustrative fixture',
                                      (Measurement('B1', value),)) if value is not None else None
            result = evaluate(criteria, observation, state, execution)
            with self.subTest(value=value, execution=execution):
                self.assertEqual(result.verdict, verdict)
                if error is not None:
                    self.assertAlmostEqual(result.absolute_error, error)
                else:
                    self.assertIsNone(result.absolute_error)
                self.assertNotIn('accepted', result.to_dict())

    def test_wrong_volume_fails_even_with_correct_observation(self):
        state = validate_protocol(initial_state(), protocol(25, 25))[-1]
        observation = Observation('imported', 'manual CSV', (Measurement('B1', .5),))
        result = evaluate(EvaluationCriteria(), observation, state, 'completed')
        self.assertEqual(result.verdict, 'FAIL')
        self.assertEqual(result.checks[1].actual, 50)
        self.assertEqual(result.checks[2].verdict, 'PASS')

    def test_measurement_schema_units_and_provenance(self):
        raw = {'origin': 'imported', 'source': 'user CSV',
               'measurements': [{'well': 'B1', 'value': .5, 'unit': 'fraction'}]}
        self.assertEqual(parse_observation(raw).origin, 'imported')
        for change in ({'origin': 'device'}, {'source': ''}, {'PASS': True},
                       {'measurements': []}, {'measurements': raw['measurements'] * 2}):
            with self.subTest(change=change), self.assertRaises(Invalid):
                parse_observation(dict(raw, **change))
        for row in ({'well': 'X1'}, {'value': True}, {'value': float('nan')},
                    {'unit': 'percent'}, {'value': 1.1}, {'extra': 1}):
            with self.subTest(row=row), self.assertRaises(Invalid):
                parse_observation(dict(raw, measurements=[dict(raw['measurements'][0], **row)]))

    def test_missing_target_is_inconclusive_not_zero(self):
        state = validate_protocol(initial_state(), protocol())[-1]
        result = evaluate(EvaluationCriteria(), Observation('imported', 'CSV', (Measurement('A1', .5),)),
                          state, 'completed')
        self.assertEqual(result.verdict, 'INCONCLUSIVE')
        self.assertIsNone(result.absolute_error)
