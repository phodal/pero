"""Persist bounded Canvas references. Notebook verifies saved source; Host owns App admission."""
from dataclasses import dataclass
import re
import json


@dataclass(frozen=True)
class AppCanvasBinding:
    id: str
    app: str
    panel: str
    view: str | None = None
    declaration: str | None = None
    inputs: dict | None = None
    receipt: dict | None = None

    @classmethod
    def parse(cls, value):
        if value is None:
            return None
        if not isinstance(value, dict) or not {'id', 'app', 'panel'} <= set(value) or set(value) - {'id', 'app', 'panel', 'view', 'declaration', 'inputs', 'receipt'}:
            raise ValueError('Invalid App binding fields')
        if not isinstance(value['id'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', value['id']):
            raise ValueError('Invalid App binding identity')
        for key in ('app', 'panel'):
            if not isinstance(value[key], str) or len(value[key]) > 128 or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', value[key]):
                raise ValueError('Invalid App or panel identifier')
        embedded = any(key in value for key in ('view', 'declaration', 'inputs'))
        if embedded and (not isinstance(value.get('view'), str) or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', value['view']) or len(value['view']) > 64
                         or not isinstance(value.get('declaration'), str) or not re.fullmatch(r'[a-f0-9]{64}', value['declaration'])
                         or not isinstance(value.get('inputs'), dict) or len(json.dumps(value['inputs'], allow_nan=False)) > 16384):
            raise ValueError('Invalid embedded view binding')
        if 'receipt' in value and (not embedded or not isinstance(value['receipt'], dict) or len(json.dumps(value['receipt'], allow_nan=False)) > 65536):
            raise ValueError('Invalid retained App receipt')
        return cls(**value)


@dataclass(frozen=True)
class CanvasSourceCheck:
    entry_id: str
    revision: int
    block_id: str
    binding: dict
    write: bool
    read_only: bool

    @classmethod
    def parse(cls, value):
        if not isinstance(value, dict) or set(value) != {'entryId', 'revision', 'blockId', 'binding', 'write', 'readOnly'}:
            raise ValueError('Invalid Canvas source check')
        if not isinstance(value['entryId'], str) or not re.fullmatch(r'[a-f0-9]{32}', value['entryId']):
            raise ValueError('Invalid Notebook entry identity')
        if type(value['revision']) is not int or value['revision'] < 1:
            raise ValueError('Choose a saved Notebook revision')
        if not isinstance(value['blockId'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', value['blockId']):
            raise ValueError('Invalid Canvas block identity')
        binding = AppCanvasBinding.parse(value['binding'])
        if binding is None or binding.view is None or binding.receipt is not None:
            raise ValueError('Use a declared binding without retained evidence')
        if type(value['write']) is not bool or type(value['readOnly']) is not bool:
            raise ValueError('Invalid Canvas source mode')
        return cls(value['entryId'], value['revision'], value['blockId'], value['binding'], value['write'], value['readOnly'])


def verify_source(entries, value):
    check = CanvasSourceCheck.parse(value)
    latest = entries.read(check.entry_id)
    # readOnly can restrict a request; it never grants authority. Only the Host's
    # private confirmation permits a write after this saved-source check.
    if check.write and (check.read_only or latest.revision != check.revision):
        raise ValueError('Only the current editable saved Notebook revision may run an action')
    saved = latest if latest.revision == check.revision else entries.read(check.entry_id, check.revision)
    block = saved.document.block(check.block_id)
    if block is None or block['type'] != 'appCanvas':
        raise ValueError('The saved Canvas binding is unavailable')
    actual = block['attrs'].get('binding')
    if not isinstance(actual, dict) or {key: item for key, item in actual.items() if key != 'receipt'} != check.binding:
        raise ValueError('Save the current Canvas binding before mounting or running an action')
    return {'valid': True}
