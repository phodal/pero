"""Typed, version-pinned method inputs. The Notebook spreadsheet owner calculates.

Saving/importing preserves unfinished formulas and dangling references as drafts;
this boundary validates shapes and identity, never invents execution receipts.
"""
from dataclasses import dataclass
from catalog import StructuredColumn, _fields, _id, _integer, _text


@dataclass(frozen=True)
class ParameterReference:
    procedure_id: str
    parameter_id: str
    version: int
    unit: str

    @classmethod
    def parse(cls, value):
        _fields(value, ('procedureId', 'parameterId', 'version', 'unit'))
        return cls(_id(value['procedureId']), _id(value['parameterId']), _integer(value['version']), _text(value['unit']))

    def wire(self):
        return dict(procedureId=self.procedure_id, parameterId=self.parameter_id, version=self.version, unit=self.unit)


@dataclass(frozen=True)
class ParameterLiteral:
    raw: str

    def wire(self):
        return dict(kind='literal', raw=self.raw)


@dataclass(frozen=True)
class ParameterField:
    block_id: str
    table_id: str
    row_id: str
    column_id: str
    schema_id: str
    schema_revision: int
    observed_revision: int
    column: StructuredColumn
    raw: str

    def wire(self):
        return dict(kind='table', blockId=self.block_id, tableId=self.table_id, rowId=self.row_id,
                    columnId=self.column_id, schemaId=self.schema_id, schemaRevision=self.schema_revision,
                    observedRevision=self.observed_revision, column=self.column.wire(), raw=self.raw)


@dataclass(frozen=True)
class ParameterFormula:
    expression: str
    bindings: tuple[ParameterReference, ...]
    unit: str

    def wire(self):
        return dict(kind='formula', expression=self.expression, bindings=[item.wire() for item in self.bindings], unit=self.unit)


def parse_source(value):
    if not isinstance(value, dict):
        raise ValueError('Invalid parameter source')
    if value.get('kind') == 'literal':
        _fields(value, ('kind', 'raw'))
        return ParameterLiteral(_text(value['raw'], 4096))
    if value.get('kind') == 'table':
        _fields(value, ('kind', 'blockId', 'tableId', 'rowId', 'columnId', 'schemaId', 'schemaRevision', 'observedRevision', 'column', 'raw'))
        column = StructuredColumn.parse(value['column'])
        if column.identity != value['columnId']:
            raise ValueError('Parameter field snapshot identity differs')
        return ParameterField(*(_id(value[key]) for key in ('blockId', 'tableId', 'rowId', 'columnId', 'schemaId')),
                              _integer(value['schemaRevision']), _integer(value['observedRevision']), column, _text(value['raw'], 4096))
    if value.get('kind') == 'formula':
        _fields(value, ('kind', 'expression', 'bindings', 'unit'))
        if not isinstance(value['bindings'], list) or len(value['bindings']) > 25:
            raise ValueError('Parameter formula supports at most 25 references')
        return ParameterFormula(_text(value['expression'], 4096), tuple(ParameterReference.parse(item) for item in value['bindings']), _text(value['unit']))
    raise ValueError('Unknown parameter source')


@dataclass(frozen=True)
class ProcedureParameter:
    column: StructuredColumn
    version: int
    step_id: str | None
    source: ParameterLiteral | ParameterField | ParameterFormula

    @classmethod
    def parse(cls, value, identities):
        column_keys = ('id', 'name', 'type', 'required', 'options', 'units')
        _fields(value, (*column_keys, 'version', 'stepId', 'source'))
        column = StructuredColumn.parse({key: value[key] for key in column_keys})
        if column.identity in identities:
            raise ValueError('Duplicate procedure parameter identity')
        identities.add(column.identity)
        return cls(column, _integer(value['version']), None if value['stepId'] is None else _id(value['stepId']), parse_source(value['source']))

    def wire(self):
        return {**self.column.wire(), 'version': self.version, 'stepId': self.step_id, 'source': self.source.wire()}


def parse_parameters(value, identities):
    if not isinstance(value, list) or len(value) > 100:
        raise ValueError('A procedure supports at most 100 parameters')
    return tuple(ProcedureParameter.parse(item, identities) for item in value)
