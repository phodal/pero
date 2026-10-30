"""Immutable JSON datasets and exact query results. No I/O or Agent runtime."""
from __future__ import annotations
from dataclasses import dataclass, field
from decimal import Decimal, localcontext
from enum import Enum
from hashlib import sha256
import json


class Invalid(ValueError):
    pass


class Kind(str, Enum):
    STRING = "string"
    NUMBER = "number"
    BOOLEAN = "boolean"
    NULL = "null"
    OBJECT = "object"
    ARRAY = "array"


@dataclass(frozen=True)
class Cell:
    kind: Kind
    token: str
    display: str
    number: Decimal | None = None

    @classmethod
    def admit(cls, value):
        if isinstance(value, Cell):
            return value
        if value is None:
            return cls(Kind.NULL, "null", "null")
        if isinstance(value, bool):
            return cls(Kind.BOOLEAN, "true" if value else "false", str(value).lower())
        if isinstance(value, str):
            return cls(Kind.STRING, json.dumps(value, ensure_ascii=False), value)
        if isinstance(value, list):
            token = "[" + ",".join(cls.admit(item).token for item in value) + "]"
            return cls(Kind.ARRAY, token, token)
        raise Invalid("Unsupported JSON value")


@dataclass(frozen=True)
class Record:
    ordinal: int
    pointer: str
    line: int | None
    cells: tuple[tuple[str, Cell], ...]

    def cell(self, field: str) -> Cell | None:
        return next((cell for name, cell in self.cells if name == field), None)


@dataclass(frozen=True)
class Field:
    name: str
    kinds: tuple[Kind, ...]
    missing: int
    nulls: int


@dataclass(frozen=True)
class Dataset:
    id: str
    name: str
    source: str
    json_lines: bool
    records: tuple[Record, ...]
    fields: tuple[Field, ...]

    @classmethod
    def parse(cls, source: str, name: str, json_lines: bool = False):
        if not source or len(source.encode("utf-8")) > 16 * 1024 * 1024:
            raise Invalid("Choose a JSON document between 1 byte and 16 MiB")
        if not name or len(name) > 256:
            raise Invalid("Dataset name must contain 1–256 characters")

        # This is the sole admission of external JSON. Object pairs retain order
        # and reject ambiguous duplicate keys. Numbers never pass through float.
        @dataclass(frozen=True)
        class Object:
            cells: tuple[tuple[str, Cell], ...]

        def object_pairs(pairs):
            names = [name for name, _ in pairs]
            if len(set(names)) != len(names):
                raise Invalid("Duplicate JSON object keys are ambiguous")
            return Object(tuple((name, admit(value)) for name, value in pairs))

        def admit(value):
            if isinstance(value, Object):
                token = "{" + ",".join(json.dumps(name, ensure_ascii=False) + ":" + cell.token for name, cell in value.cells) + "}"
                return Cell(Kind.OBJECT, token, token)
            if isinstance(value, list):
                token = "[" + ",".join(admit(item).token for item in value) + "]"
                return Cell(Kind.ARRAY, token, token)
            return Cell.admit(value)

        def number(token):
            try:
                value = Decimal(token)
            except ArithmeticError:
                raise Invalid("The numeric exponent is too large") from None
            if not value.is_finite():
                raise Invalid("Numbers must be finite")
            return Cell(Kind.NUMBER, token, token, value)

        def constant(_token):
            raise Invalid("NaN and Infinity are not JSON numbers")

        def read(text):
            return json.loads(text, parse_int=number, parse_float=number,
                              parse_constant=constant, object_pairs_hook=object_pairs)

        try:
            if json_lines:
                entries = [(read(line), "", index + 1) for index, line in enumerate(source.split('\n')) if line.strip()]
            else:
                root = read(source)
                if isinstance(root, list):
                    entries = [(row, "/" + str(index), None) for index, row in enumerate(root)]
                elif isinstance(root, Object):
                    entries = [(root, "", None)]
                else:
                    raise Invalid("A dataset is an array of records, a record, or JSON Lines records")
            if len(entries) > 100_000:
                raise Invalid("This dataset exceeds 100,000 records")
            records = []
            kinds: dict[str, set[Kind]] = {}
            counts: dict[str, int] = {}
            nulls: dict[str, int] = {}
            for index, (entry, pointer, line) in enumerate(entries):
                if not isinstance(entry, Object):
                    raise Invalid("Every dataset row must be a JSON object")
                records.append(Record(index, pointer, line, entry.cells))
                for field, cell in entry.cells:
                    kinds.setdefault(field, set()).add(cell.kind)
                    counts[field] = counts.get(field, 0) + 1
                    nulls[field] = nulls.get(field, 0) + int(cell.kind == Kind.NULL)
            fields = tuple(Field(name, tuple(sorted(values)), len(records) - counts[name], nulls[name]) for name, values in kinds.items())
            identity = sha256(("jsonl\n" if json_lines else "json\n").encode() + source.encode()).hexdigest()
            return cls(identity, name, source, json_lines, tuple(records), fields)
        except (json.JSONDecodeError, RecursionError, UnicodeError) as error:
            raise Invalid("Invalid JSON: " + str(error)) from None


@dataclass(frozen=True)
class Filter:
    field: str
    operator: str
    value: str
    threshold: Decimal | None = field(init=False, default=None)

    def __post_init__(self):
        if self.operator not in ("contains", "eq", "gte", "lte", "missing", "null"):
            raise Invalid("Unsupported filter operator")
        if self.operator in ("gte", "lte"):
            try:
                threshold = Decimal(self.value)
            except ArithmeticError:
                raise Invalid("A numeric filter needs a finite decimal value") from None
            if not threshold.is_finite():
                raise Invalid("A numeric filter needs a finite decimal value")
            object.__setattr__(self, "threshold", threshold)

    def matches(self, record: Record) -> bool:
        cell = record.cell(self.field)
        if self.operator == "missing":
            return cell is None
        if self.operator == "null":
            return cell is not None and cell.kind == Kind.NULL
        if cell is None:
            return False
        if self.operator == "contains":
            return self.value.casefold() in cell.display.casefold()
        if self.operator in ("gte", "lte"):
            return cell.number is not None and (cell.number >= self.threshold if self.operator == "gte" else cell.number <= self.threshold)
        return cell.display == self.value


@dataclass(frozen=True)
class Query:
    filter: Filter | None = None
    sort: str | None = None
    descending: bool = False

    def apply(self, dataset: Dataset) -> tuple[Record, ...]:
        rows = [row for row in dataset.records if self.filter is None or self.filter.matches(row)]
        if self.sort is not None:
            field = self.sort
            values, absent = [], []
            for row in rows:
                cell = row.cell(field)
                (absent if cell is None or cell.kind == Kind.NULL else values).append(row)
            def key(row):
                cell = row.cell(field)
                return (0, cell.number) if cell.number is not None else (1, cell.kind.value, cell.display.casefold())
            rows = sorted(values, key=key, reverse=self.descending) + absent
        return tuple(rows)


@dataclass(frozen=True)
class Selection:
    ordinals: tuple[int, ...] = ()

    def apply(self, rows: tuple[Record, ...]) -> tuple[Record, ...]:
        if not self.ordinals:
            return rows
        wanted = set(self.ordinals)
        result = tuple(row for row in rows if row.ordinal in wanted)
        if len(result) != len(wanted):
            raise Invalid("The selected records no longer belong to this query; clear the selection")
        return result


@dataclass(frozen=True)
class ChartSpec:
    category: str
    measure: str
    aggregation: str

    def __post_init__(self):
        if self.aggregation not in ("sum", "count"):
            raise Invalid("Chart aggregation must be sum or count")


@dataclass(frozen=True)
class ChartPoint:
    label: str | None
    exact: str
    ratio: float
    count: int


@dataclass(frozen=True)
class Chart:
    spec: ChartSpec
    points: tuple[ChartPoint, ...]
    omitted_groups: int
    excluded_values: int

    @classmethod
    def calculate(cls, rows: tuple[Record, ...], spec: ChartSpec):
        groups: dict[tuple[Kind, str] | None, tuple[Decimal, int]] = {}
        excluded = 0
        # Exact additions need enough significant digits for the full exponent
        # span. Only normalized plot coordinates are converted to float.
        eligible = [row.cell(spec.measure).number for row in rows if row.cell(spec.measure) is not None and row.cell(spec.measure).number is not None]
        eligible = [value for value in eligible if abs(value.adjusted()) <= 4096 and abs(value.as_tuple().exponent) <= 4096]
        precision = max((value.adjusted() for value in eligible), default=0) - min((value.as_tuple().exponent for value in eligible), default=0)
        with localcontext() as context:
            context.prec = max(28, precision + len(str(len(rows))) + 2)
            for row in rows:
                category, value = row.cell(spec.category), row.cell(spec.measure)
                key = (category.kind, category.display) if category is not None and category.kind != Kind.NULL else None
                if spec.aggregation != "count" and (value is None or value.number is None or abs(value.number.adjusted()) > 4096 or abs(value.number.as_tuple().exponent) > 4096):
                    excluded += 1
                    continue
                total, count = groups.get(key, (Decimal(0), 0))
                groups[key] = total + (Decimal(1) if spec.aggregation == "count" else value.number), count + 1
            values = [(key, total, count) for key, (total, count) in groups.items()]
            values.sort(key=lambda item: (abs(item[1]), str(item[0])), reverse=True)
            ceiling = max((abs(value) for _, value, _ in values), default=Decimal(1)) or Decimal(1)
            return cls(spec, tuple(ChartPoint(key[1] if key is not None else None, str(value), float(value / ceiling), count)
                                  for key, value, count in values[:50]), max(0, len(values) - 50), excluded)


def export_records(rows: tuple[Record, ...]) -> str:
    return "[\n" + ",\n".join("{" + ",".join(json.dumps(name, ensure_ascii=False) + ":" + cell.token for name, cell in row.cells) + "}" for row in rows) + "\n]"
