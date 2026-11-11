"""One block definition owns persistence and any reference capability.

Historical Notebook types keep their existing parser. A new type must bring a
validator. A reference capability is optional and is not a general payload
command.
"""

import re

_definitions = {}
_operations = {}
_TYPE = re.compile(r'[A-Za-z][A-Za-z0-9_-]{0,64}')


class BlockDefinition:
    def __init__(self, type_name, schema_version, *, validate=None, reference=None, historical=False):
        if not isinstance(type_name, str) or not _TYPE.fullmatch(type_name):
            raise ValueError('Invalid block type name')
        if type(schema_version) is not int or schema_version < 1:
            raise ValueError('Invalid block schema version')
        if historical and validate is not None:
            raise ValueError('A historical block keeps its existing parser')
        if not historical and not callable(validate):
            raise ValueError('A new block needs a persistence validator')
        if reference is not None and not callable(reference):
            raise ValueError('A reference capability needs an accept function')
        self.type_name = type_name
        self.schema_version = schema_version
        self.historical = historical
        self._validate = validate
        self.reference = reference

    def validate(self, value):
        if self.historical:
            raise ValueError(f'{self.type_name} is validated by the notebook document parser')
        self._validate(value)


def register_definition(definition):
    if not isinstance(definition, BlockDefinition):
        raise ValueError('Block registration requires a BlockDefinition')
    if definition.type_name in _definitions:
        raise ValueError(f'Duplicate block registration: {definition.type_name}')
    _definitions[definition.type_name] = definition
    return definition


def block(type_name):
    return _definitions.get(type_name)


def extension_type_names():
    """New persisted types. Historical types stay in the document parser set."""
    return sorted(name for name, definition in _definitions.items() if not definition.historical)


def reference_capability(type_name):
    definition = _definitions.get(type_name)
    return None if definition is None else definition.reference


def unregister_definition(type_name):
    _definitions.pop(type_name, None)


def register_operation(name, parse, apply):
    if name in _operations:
        raise ValueError(f'Duplicate operation registration: {name}')
    _operations[name] = (parse, apply)


def unregister_operation(name):
    _operations.pop(name, None)


def parse_registered_operation(value, new_id):
    if not isinstance(value, dict):
        return None
    pair = _operations.get(value.get('op'))
    if pair is None:
        return None
    return pair[0](value, new_id)


def apply_registered_operation(document, operation):
    name = getattr(operation, 'registry_op', None)
    pair = _operations.get(name)
    if pair is None:
        return False
    pair[1](document, operation)
    return True
