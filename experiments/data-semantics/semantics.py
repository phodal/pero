"""Pure, local study concepts; not a product permission or natural-language router."""
from dataclasses import dataclass
import math
import re


@dataclass(frozen=True)
class Definition:
    id: str
    version: int
    sql: str
    parameters: tuple[tuple[str, str], ...]
    unit: str
    grain: str
    denominator: str
    join_cardinality: str
    missing: str
    seed_policy: str
    reviewer: str
    review_scope: str

    @classmethod
    def admit(cls, raw):
        if raw['review']['status'] != 'reviewed':
            raise ValueError('Only locally reviewed definitions can execute')
        parameters = tuple(raw['parameters'].items())
        if any(kind not in ('str', 'int', 'number') for _, kind in parameters):
            raise ValueError('Unsupported parameter type')
        if set(re.findall(r':([a-z_]+)', raw['sql'])) != {name for name, _ in parameters}:
            raise ValueError('SQL bindings must match the definition')
        return cls(raw['id'], raw['version'], raw['sql'], parameters,
                   *(raw[key] for key in ('unit', 'grain', 'denominator', 'join_cardinality',
                                         'missing', 'seed_policy')),
                   raw['review']['reviewer'], raw['review']['scope'])


@dataclass(frozen=True)
class QueryIntent:
    question: str
    project: str
    snapshot: str
    operation: str
    definition: str
    parameters: tuple[tuple[str, str | int | float], ...]

    @classmethod
    def admit(cls, raw):
        keys = ('question', 'project', 'snapshot', 'operation', 'definition')
        if any(not isinstance(raw[key], str) for key in keys):
            raise ValueError('Intent identifiers must be strings')
        params = raw['parameters']
        if not isinstance(params, dict) or any(
            not isinstance(key, str) or type(value) not in (str, int, float)
            or (isinstance(value, float) and not math.isfinite(value))
            for key, value in params.items()
        ):
            raise ValueError('Parameters must be finite scalar values')
        return cls(*(raw[key] for key in keys), tuple(params.items()))


@dataclass(frozen=True)
class ReadGrant:
    actor: str
    project: str
    columns: tuple[tuple[str, tuple[str, ...]], ...]

    def permits_read(self, table, column, database):
        # SQLite reports no database for COUNT(*)'s column-less table read.
        return (database == 'main' or (database is None and column == '')) and any(
            table == name and (not column or column in fields) for name, fields in self.columns
        )


@dataclass(frozen=True)
class Decision:
    status: str
    reason: str
    definition: Definition | None = None


@dataclass(frozen=True)
class SemanticSnapshot:
    version: str
    definitions: tuple[Definition, ...]

    def decide(self, intent: QueryIntent, grant: ReadGrant):
        if intent.project != grant.project or intent.operation != 'select':
            return Decision('refused', 'The local study grants SELECT only in its selected project')
        if not intent.snapshot:
            return Decision('clarify', 'Select a fixed data snapshot')
        if intent.snapshot != self.version:
            return Decision('refused', 'The requested snapshot is outside this query context')
        definition = next((item for item in self.definitions if item.id == intent.definition), None)
        if definition is None:
            return Decision('clarify', 'Select an explicit reviewed definition and source')
        supplied = dict(intent.parameters)
        expected = dict(definition.parameters)
        if expected.keys() != supplied.keys():
            return Decision('clarify', 'Supply exactly the parameters required by the definition')
        for name, kind in definition.parameters:
            value = supplied[name]
            valid = (kind == 'str' and type(value) is str or kind == 'int' and type(value) is int
                     or kind == 'number' and type(value) in (int, float))
            if not valid:
                return Decision('clarify', f'Parameter {name} requires {kind}')
        return Decision('answered', 'Manual D plan admitted; no model inference', definition)
