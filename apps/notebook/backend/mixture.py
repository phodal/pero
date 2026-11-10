"""Boundary validation for recorded mixtures, never an inventory/execution owner."""
from dataclasses import dataclass
from datetime import datetime
import math
import re

UNITS = {'g': ('mass', 1), 'mg': ('mass', .001), 'µg': ('mass', .000001),
         'L': ('volume', 1), 'mL': ('volume', .001), 'µL': ('volume', .000001),
         'mol': ('amount', 1), 'mmol': ('amount', .001), 'µmol': ('amount', .000001)}


def fields(value, names):
    if not isinstance(value, dict) or set(value) != set(names.split()):
        raise ValueError('Invalid mixture fields')
    return value


def text(value, maximum=200, required=False):
    if not isinstance(value, str) or len(value) > maximum or (required and not value.strip()):
        raise ValueError('Invalid mixture text')
    return value


def identity(value):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', text(value, 128)):
        raise ValueError('Invalid mixture identity')


@dataclass(frozen=True)
class Quantity:
    value: float | None
    unit: str

    @classmethod
    def parse(cls, value):
        q = fields(value, 'value unit')
        if not isinstance(q['unit'], str) or q['unit'] not in UNITS:
            raise ValueError('Unsupported quantity unit')
        n = q['value']
        if n is not None and (type(n) not in (int, float) or not math.isfinite(n) or not 0 <= n <= 1e12):
            raise ValueError('Invalid mixture quantity')
        return cls(n, q['unit'])

    def convert(self, unit):
        if UNITS[self.unit][0] != UNITS[unit][0]:
            raise ValueError('Incompatible quantity dimensions')
        return None if self.value is None else self.value * UNITS[self.unit][1] / UNITS[unit][1]


def parse_recipe(value, *, complete=False):
    r = fields(value, 'name output notes target additiveVolumes ingredients')
    text(r['name'], required=complete)
    text(r['output'])
    text(r['notes'], 4000)
    target = Quantity.parse(r['target'])
    if type(r['additiveVolumes']) is not bool or not isinstance(r['ingredients'], list) or len(r['ingredients']) > 100:
        raise ValueError('Invalid mixture recipe')
    if complete and (not r['ingredients'] or target.value is None or target.value <= 0):
        raise ValueError('A positive target and ingredients are required')
    ids, qs, quantities = set(), 0, []
    for item in r['ingredients']:
        i = fields(item, 'id reference source mode target')
        identity(i['id'])
        if i['id'] in ids:
            raise ValueError('Duplicate ingredient identity')
        ids.add(i['id'])
        text(i['reference'], required=complete)
        text(i['source'], 1000)
        q = Quantity.parse(i['target'])
        if i['mode'] == 'qs':
            qs += 1
            if q.value is not None or UNITS[q.unit][0] != 'volume' or UNITS[target.unit][0] != 'volume':
                raise ValueError('QS requires an unknown volume target')
        elif i['mode'] == 'quantity':
            if complete and (q.value is None or q.value <= 0):
                raise ValueError('A positive planned quantity is required')
            quantities.append(q)
        else:
            raise ValueError('Invalid ingredient mode')
    if qs > 1:
        raise ValueError('Only one QS ingredient is supported')
    if complete and qs and r['additiveVolumes'] and target.value is not None:
        values = [q.convert(target.unit) for q in quantities]
        if all(n is not None for n in values) and sum(values) > target.value + max(1, target.value) * 1e-9:
            raise ValueError('Ingredients exceed final QS target')
    return r


def parse_actual(value, recipe, complete=False):
    if not isinstance(value, dict):
        raise ValueError('Invalid measurements')
    ingredients = {i['id']: i for i in recipe['ingredients']}
    if value.keys() - ingredients.keys():
        raise ValueError('Unknown measured ingredient')
    for key, item in value.items():
        q = Quantity.parse(item)
        q.convert(ingredients[key]['target']['unit'])
        if complete and q.value is None:
            raise ValueError('Actual measurement is unknown')
    if complete and value.keys() != ingredients.keys():
        raise ValueError('Enter actual quantities for every ingredient')


def parse_mixture_preparation(value):
    s = fields(value, 'version draft recipes measurements records')
    if type(s['version']) is not int or s['version'] != 1:
        raise ValueError('Invalid mixture version')
    draft = parse_recipe(s['draft'])
    for key in ('recipes', 'records'):
        if not isinstance(s[key], list) or len(s[key]) > 100:
            raise ValueError('Invalid mixture history')
    recipes = {}
    for number, item in enumerate(s['recipes'], 1):
        r = fields(item, 'revision recipe')
        if type(r['revision']) is not int or r['revision'] != number:
            raise ValueError('Invalid recipe revision')
        recipes[number] = parse_recipe(r['recipe'], complete=True)
    ids = set()
    for item in s['records']:
        r = fields(item, 'id recipeRevision recipe operator recordedAt actual output notes')
        identity(r['id'])
        if r['id'] in ids:
            raise ValueError('Duplicate preparation record')
        ids.add(r['id'])
        if type(r['recipeRevision']) is not int or r['recipeRevision'] not in recipes or r['recipe'] != recipes[r['recipeRevision']]:
            raise ValueError('Preparation must preserve source recipe revision')
        text(r['operator'], required=True)
        text(r['output'])
        text(r['notes'], 4000)
        timestamp = text(r['recordedAt'], 40)
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z', timestamp):
            raise ValueError('UTC recording time is required')
        datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        parse_actual(r['actual'], r['recipe'], True)
    parse_actual(s['measurements'], draft)
    return value


def parse_mixture_attributes(value):
    # Imported lazily so document.py can delegate here without a cycle.
    from document import fields as document_fields, block_id, string
    document_fields(value, {'blockId', 'label', 'mixture'}, {'templateOrigin'})
    block_id(value['blockId'])
    string(value['label'], 'mixture label', 200)
    parse_mixture_preparation(value['mixture'])
    return value
