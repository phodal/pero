"""Frozen source boundary for inert, loss-aware nbformat 4 interchange."""
from dataclasses import dataclass
import json
import math
import re
from document import fields, block_id


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate notebook JSON key')
        result[key] = value
    return result


def _validate(value, depth=0):
    if depth > 64:
        raise ValueError('Notebook JSON exceeds depth 64')
    if isinstance(value, str):
        value.encode('utf-8')
    elif type(value) in (int, float):
        if not math.isfinite(value) or (int(value) == value and abs(value) > 9007199254740991):
            raise ValueError('Notebook number is not portable')
    elif isinstance(value, list):
        for child in value:
            _validate(child, depth + 1)
    elif isinstance(value, dict):
        for key, child in value.items():
            key.encode('utf-8')
            _validate(child, depth + 1)


def _text(value):
    return isinstance(value, str) or isinstance(value, list) and all(isinstance(s, str) for s in value)


@dataclass(frozen=True)
class IpynbDocumentSource:
    source: str

    def __post_init__(self):
        if not isinstance(self.source, str) or len(self.source.encode('utf-8')) > 1024 * 1024:
            raise ValueError('Notebook exceeds 1 MiB source budget')
        if len(json.dumps(self.source, ensure_ascii=False).encode('utf-8')) > 1536 * 1024:
            raise ValueError('Notebook exceeds escaped persistence budget')
        try:
            raw = json.loads(self.source, object_pairs_hook=_unique)
            _validate(raw)
        except (RecursionError, OverflowError) as error:
            raise ValueError('Notebook JSON exceeds portable limits') from error
        if not isinstance(raw, dict) or raw.get('nbformat') != 4 or type(raw.get('nbformat_minor')) is not int or raw['nbformat_minor'] < 0 or not isinstance(raw.get('metadata'), dict) or not isinstance(raw.get('cells'), list) or len(raw['cells']) > 256:
            raise ValueError('Expected bounded nbformat 4 notebook')
        ids = set()
        for cell in raw['cells']:
            if not isinstance(cell, dict) or cell.get('cell_type') not in ('markdown', 'code', 'raw') or not isinstance(cell.get('metadata'), dict) or not _text(cell.get('source')):
                raise ValueError('Invalid notebook cell')
            if 'id' in cell:
                identity = cell['id']
                if not isinstance(identity, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', identity) or identity in ids:
                    raise ValueError('Invalid or duplicate cell ID')
                ids.add(identity)
            elif raw['nbformat_minor'] >= 5:
                raise ValueError('Cell ID required by nbformat 4.5')
            if 'attachments' in cell and (not isinstance(cell['attachments'], dict) or any(not isinstance(v, dict) for v in cell['attachments'].values())):
                raise ValueError('Invalid attachment bundle')
            if cell['cell_type'] == 'code':
                count = cell.get('execution_count', False)
                if not (count is None or type(count) is int and count >= 0) or not isinstance(cell.get('outputs'), list) or any(not isinstance(v, dict) or not isinstance(v.get('output_type'), str) for v in cell['outputs']):
                    raise ValueError('Invalid recorded code outputs')

    @classmethod
    def parse(cls, attrs):
        fields(attrs, {'blockId', 'schemaVersion', 'source'}, {'templateOrigin'})
        block_id(attrs['blockId'])
        if type(attrs['schemaVersion']) is not int or attrs['schemaVersion'] != 1:
            raise ValueError('Unsupported notebook block version; source was not replaced')
        return cls(attrs['source'])
