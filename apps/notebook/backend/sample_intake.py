"""Persisted local source selection boundary. Snapshots never assert physical inventory."""
from dataclasses import dataclass
import re
try:
    from .catalog import _snapshot
except ImportError:
    from catalog import _snapshot


def fields(value, expected):
    if not isinstance(value, dict) or set(value) != set(expected.split()):
        raise ValueError('Invalid sample intake fields')


def text(value, maximum=200):
    if not isinstance(value, str) or len(value) > maximum:
        raise ValueError('Invalid sample intake text')


def identity(value):
    text(value, 128)
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', value):
        raise ValueError('Invalid sample intake identity')


def mode(value):
    if not isinstance(value, str) or value not in ('manual', 'barcode', 'worklist', 'table', 'plate'):
        raise ValueError('Invalid sample intake mode')


def match_field(value):
    if value != '$id':
        identity(value)


@dataclass(frozen=True)
class SampleIntake:
    """Validated source document; data is a frozen selection, not a catalog command."""
    data: dict

    @classmethod
    def parse(cls, data):
        fields(data, 'name mode field schemaId input fileName plateSize bindings')
        text(data['name']); mode(data['mode']); match_field(data['field'])
        if data['schemaId'] != '':
            identity(data['schemaId'])
        text(data['input'], 100000); text(data['fileName'])
        size = data['plateSize']; fields(size, 'rows columns')
        if type(size['rows']) is not int or type(size['columns']) is not int or not 1 <= size['rows'] <= 32 or not 1 <= size['columns'] <= 48:
            raise ValueError('Invalid plate size')
        bindings = data['bindings']
        if not isinstance(bindings, list) or len(bindings) > 200:
            raise ValueError('Invalid source bindings')
        identities, wells = set(), set()
        for binding in bindings:
            fields(binding, 'source snapshot')
            source = binding['source']; fields(source, 'mode input fileName row well field')
            mode(source['mode']); text(source['input']); text(source['fileName']); match_field(source['field']); text(source['well'], 5)
            if not source['input'].strip() or type(source['row']) is not int or not 1 <= source['row'] <= 200:
                raise ValueError('Invalid source input or row')
            well = source['well']
            if source['mode'] == 'plate':
                match = re.fullmatch(r'([A-Z]{1,2})([1-9]\d*)', well)
                if not match:
                    raise ValueError('Invalid plate well')
                row = 0
                for letter in match[1]:
                    row = row * 26 + ord(letter) - 64
                if row > size['rows'] or int(match[2]) > size['columns'] or well in wells:
                    raise ValueError('Outside or duplicate plate well')
                wells.add(well)
            elif well:
                raise ValueError('Only plate sources have wells')
            snapshot = binding['snapshot']; _snapshot(snapshot)
            if len(snapshot['records']) != 1:
                raise ValueError('Select exactly one catalog record')
            record = snapshot['records'][0]
            cell = record['values'].get(source['field'])
            matched = record['id'] == source['input'] if source['field'] == '$id' else cell is not None and cell['type'] == 'text' and cell['value'] == source['input']
            if not matched:
                raise ValueError('Source must exactly match selected record')
            key = (snapshot['catalogId'], record['id'], well)
            if key in identities:
                raise ValueError('Duplicate source binding')
            identities.add(key)
        return cls(data)


def validate_sample_intake_attributes(attrs):
    if not isinstance(attrs, dict) or set(attrs) - {'intake', 'blockId'} or 'intake' not in attrs:
        raise ValueError('Invalid sample intake attributes')
    SampleIntake.parse(attrs['intake'])
