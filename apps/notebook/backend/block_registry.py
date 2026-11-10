"""Block and operation registrations. The document parser and agent dispatcher look up names here."""

_blocks = {}
_operations = {}
_proposals = {}


def unregister_block(type_name):
    _blocks.pop(type_name, None)


def unregister_operation(name):
    _operations.pop(name, None)


def register_block(adapter):
    name = adapter.type_name
    if name in _blocks:
        raise ValueError(f'Duplicate block registration: {name}')
    _blocks[name] = adapter
    return adapter


def block(type_name):
    return _blocks.get(type_name)


def register_operation(name, parse, apply):
    if name in _operations:
        raise ValueError(f'Duplicate operation registration: {name}')
    _operations[name] = (parse, apply)


def parse_registered_operation(value, new_id):
    if not isinstance(value, dict):
        return None
    pair = _operations.get(value.get('op'))
    if pair is None:
        return None
    return pair[0](value, new_id)


def register_proposal(type_name, accept):
    if type_name in _proposals:
        raise ValueError(f'Duplicate proposal registration: {type_name}')
    _proposals[type_name] = accept


def proposal_adapter(type_name):
    return _proposals.get(type_name)


def apply_registered_operation(document, operation):
    name = getattr(operation, 'registry_op', None)
    pair = _operations.get(name)
    if pair is None:
        return False
    pair[1](document, operation)
    return True
