"""Reviewed query definitions and explicit projections of fixed Data versions."""
from dataclasses import dataclass
from decimal import Decimal
import math
import re


@dataclass(frozen=True)
class ReadGrant:
    actor: str
    project: str
    columns: tuple[tuple[str, tuple[str, ...]], ...]

    def permits_read(self, table, column, database):
        return (database == 'main' or (database is None and column == '')) and any(
            table == name and (not column or column in fields) for name, fields in self.columns)


@dataclass(frozen=True)
class Projection:
    dataset_id: str
    asset_id: str
    table: str
    columns: tuple[tuple[str, str], ...]

    @classmethod
    def parse(cls, raw):
        if not isinstance(raw, dict) or set(raw) != {'datasetId', 'assetId', 'table', 'columns'}:
            raise ValueError('Choose a fixed dataset version, table name and explicit column types')
        if any(not isinstance(raw[key], str) or not raw[key] for key in ('datasetId', 'assetId', 'table')):
            raise ValueError('Dataset, version and table are required')
        if not re.fullmatch(r'[a-z][a-z0-9_]{0,63}', raw['table']):
            raise ValueError('Table names use lowercase letters, digits and underscores')
        columns = raw['columns']
        if not isinstance(columns, dict) or not 1 <= len(columns) <= 256 or any(
                not isinstance(name, str) or not name or len(name) > 256 or kind not in ('text', 'number')
                for name, kind in columns.items()):
            raise ValueError('Select 1–256 columns with text or number types')
        return cls(raw['datasetId'], raw['assetId'], raw['table'], tuple(columns.items()))


@dataclass(frozen=True)
class Recalculation:
    operation: str
    table: str
    column: str
    result_column: str

    @classmethod
    def parse(cls, raw):
        if not isinstance(raw, dict) or set(raw) != {'operation', 'table', 'column', 'resultColumn'}:
            raise ValueError('Independent check needs operation, table, column and resultColumn')
        if raw['operation'] not in ('count', 'sum', 'mean') or any(not isinstance(v, str) for v in raw.values()):
            raise ValueError('Independent checks support whole-table count, sum and mean')
        return cls(raw['operation'], raw['table'], raw['column'], raw['resultColumn'])


    def compare(self, values: tuple[str | int | float | None, ...], record_count: int,
                actual: str | int | float | None, scalar_result: bool):
        if self.operation == 'count':
            expected = Decimal(record_count)
        else:
            present = tuple(Decimal(str(value)) for value in values if value is not None and value != '')
            expected = sum(present, Decimal(0)) if present else None
            if self.operation == 'mean' and present:
                expected /= len(present)
        matched = scalar_result and (actual is None if expected is None else
            type(actual) in (int, float) and abs(Decimal(str(actual)) - expected) <= Decimal('0.000001'))
        return RecalculationResult('matched' if matched else 'mismatch', str(expected) if expected is not None else None)


@dataclass(frozen=True)
class RecalculationResult:
    status: str
    expected: str | None


@dataclass(frozen=True)
class QueryDefinition:
    name: str
    sql: str
    parameters: tuple[tuple[str, str], ...]
    unit: str
    grain: str
    denominator: str
    joins: str
    missing: str
    seed_policy: str
    reviewer: str
    check: Recalculation | None

    @classmethod
    def parse(cls, raw):
        keys = ('name', 'sql', 'unit', 'grain', 'denominator', 'joins', 'missing', 'seedPolicy', 'reviewer')
        if not isinstance(raw, dict) or set(raw) != {*keys, 'parameters', 'reviewed', 'check'}:
            raise ValueError('Supply a complete reviewed query definition')
        if raw['reviewed'] is not True:
            raise ValueError('Review SQL, units, denominator and joins before saving')
        if any(not isinstance(raw[k], str) or not raw[k].strip() or len(raw[k]) > 8000 for k in keys):
            raise ValueError('Every definition field and reviewer must be filled in')
        params = raw['parameters']
        if not isinstance(params, dict) or any(not re.fullmatch('[a-z_]+', key) or kind not in ('str', 'int', 'number') for key, kind in params.items()):
            raise ValueError('Use named str, int or number bindings')
        if set(filter(None, re.findall(r"'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"|--[^\n]*|/\*[\s\S]*?\*/|:([a-z_]+)", raw['sql']))) != set(params):
            raise ValueError('SQL bindings must match the parameter declaration')
        return cls(raw['name'], raw['sql'], tuple(params.items()), *(raw[k] for k in keys[2:]),
                   Recalculation.parse(raw['check']) if raw['check'] is not None else None)

    def bind(self, values):
        if not isinstance(values, dict) or set(values) != dict(self.parameters).keys():
            raise ValueError('Supply exactly the declared parameters')
        for key, kind in self.parameters:
            value = values[key]
            if not (kind == 'str' and type(value) is str or kind == 'int' and type(value) is int
                    or kind == 'number' and type(value) in (int, float)) or isinstance(value, float) and not math.isfinite(value):
                raise ValueError(f'Parameter {key} requires {kind}')
        return tuple(values.items())
