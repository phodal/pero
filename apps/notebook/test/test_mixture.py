import copy
import pathlib
import sys
import unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'backend'))
from mixture import Quantity, parse_mixture_preparation


def preparation():
    recipe = dict(name='Buffer', output='', notes='', target=dict(value=100, unit='mL'), additiveVolumes=True,
                  ingredients=[dict(id='a', reference='stock', source='bottle', mode='quantity', target=dict(value=.02, unit='L')),
                               dict(id='b', reference='water', source='tap', mode='qs', target=dict(value=None, unit='mL'))])
    return dict(version=1, draft=recipe, recipes=[dict(revision=1, recipe=copy.deepcopy(recipe))], measurements={}, records=[])


class MixtureTest(unittest.TestCase):
    def test_dimensions_and_bounds(self):
        self.assertEqual(Quantity.parse(dict(value=2500, unit='mg')).convert('g'), 2.5)
        self.assertIsNone(Quantity.parse(dict(value=None, unit='mL')).convert('L'))
        for value in (-1, float('nan'), float('inf'), True, '3', 1e13):
            with self.assertRaises(ValueError):
                Quantity.parse(dict(value=value, unit='g'))
        with self.assertRaises(ValueError):
            Quantity.parse(dict(value=1, unit='g')).convert('mL')

    def test_qs_and_record_snapshot(self):
        state = preparation()
        self.assertEqual(parse_mixture_preparation(state), state)
        for target in (dict(value=1, unit='L'), dict(value=1, unit='g')):
            invalid = copy.deepcopy(state)
            invalid['recipes'][0]['recipe']['ingredients'][0]['target'] = target
            with self.assertRaises(ValueError):
                parse_mixture_preparation(invalid)
        record = dict(id='record-1', recipeRevision=1, recipe=copy.deepcopy(state['draft']), operator='Researcher',
                      recordedAt='2026-11-09T12:00:00.000Z', actual={'a': dict(value=21, unit='mL'), 'b': dict(value=79, unit='mL')}, output='batch-1', notes='')
        state['records'] = [record]
        state['draft']['notes'] = 'Later draft'
        self.assertEqual(parse_mixture_preparation(state), state)
        record['actual']['a']['value'] = None
        with self.assertRaises(ValueError):
            parse_mixture_preparation(state)
        record['actual']['a']['value'] = 21
        record['recipe']['name'] = 'Tampered'
        with self.assertRaises(ValueError):
            parse_mixture_preparation(state)
