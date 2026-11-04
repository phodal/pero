"""Logical datasets, immutable version references and saved inspection views. No I/O."""
from dataclasses import asdict, dataclass, replace
from decimal import Decimal
import re

PARSER_VERSION = 'pero-data/1'
MAX_COLUMNS = 32
MAX_FIELDS = 256
MAX_ROWS = 100_000
PREVIEW_BYTES = 10 * 1024 * 1024


def text(value, label, maximum=300):
    if not isinstance(value, str) or len(value) > maximum or any(ord(c) < 32 for c in value):
        raise ValueError(f'Invalid {label}')
    return value.strip()


def fields(value, allowed):
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise ValueError('Unknown request field')


def identity(value, label, prefix=''):
    if not isinstance(value, str) or not re.fullmatch(re.escape(prefix) + r'[a-f0-9]{32}', value):
        raise ValueError(f'Invalid {label}')
    return value


@dataclass(frozen=True)
class DatasetEdit:
    datasetId: str
    name: str
    projectRef: str
    archived: bool

    @classmethod
    def parse(cls, value):
        fields(value, ('datasetId', 'name', 'projectRef', 'archived'))
        name = text(value.get('name'), 'dataset name', 200)
        if not name or type(value.get('archived')) is not bool:
            raise ValueError('Dataset name and archive state are required')
        return cls(identity(value.get('datasetId'), 'dataset', 'ds-'), name,
                   text(value.get('projectRef', ''), 'project reference', 200), value['archived'])


@dataclass(frozen=True)
class Dataset:
    id: str
    name: str
    kind: str
    versions: tuple[str, ...]
    projectRef: str = ''
    archived: bool = False

    @classmethod
    def for_asset(cls, asset_id, name, kind, project_ref=''):
        return cls('ds-' + asset_id, name, kind, (asset_id,), project_ref)

    @classmethod
    def restore(cls, value):
        return cls(**(value | {'versions': tuple(value['versions'])}))

    def require_version(self, asset_id):
        if asset_id not in self.versions:
            raise ValueError('The version does not belong to this dataset')

    def append(self, asset_id, kind):
        if self.archived:
            raise ValueError('Restore the dataset before adding a version')
        if kind != self.kind:
            raise ValueError('A version must keep its dataset or model kind')
        return replace(self, versions=(*self.versions, asset_id))

    def edit(self, request: DatasetEdit):
        return replace(self, name=request.name, projectRef=request.projectRef, archived=request.archived)


OPERATORS = ('contains', 'eq', 'gte', 'lte', 'missing', 'null')
AGGREGATIONS = ('sum', 'count')


def column_names(value):
    columns = value.get('columns', [])
    if not isinstance(columns, list) or len(columns) > MAX_COLUMNS or not all(isinstance(c, str) for c in columns):
        raise ValueError('Choose up to 32 columns')
    if len(set(columns)) != len(columns):
        raise ValueError('Columns must not repeat')
    # Field names are literal: unlike user-facing labels, whitespace is significant.
    if any(not c or len(c) > 300 for c in columns):
        raise ValueError('Invalid column name')
    return tuple(columns)


def unit_labels(value):
    units = value.get('units', {})
    if not isinstance(units, dict) or len(units) > MAX_FIELDS:
        raise ValueError('Invalid field units')
    return tuple((key, text(unit, 'unit', 60)) for key, unit in units.items())


def literal_name(value, label):
    if not isinstance(value, str) or not value or len(value) > 300:
        raise ValueError(f'Invalid {label}')
    return value


@dataclass(frozen=True)
class FilterChoice:
    field: str
    operator: str
    value: str


@dataclass(frozen=True)
class SortChoice:
    field: str
    descending: bool


@dataclass(frozen=True)
class ChartChoice:
    category: str
    measure: str
    aggregation: str


@dataclass(frozen=True)
class ViewSpec:
    columns: tuple[str, ...] = ()
    filter: FilterChoice | None = None
    sort: SortChoice | None = None
    selection: tuple[int, ...] = ()
    chart: ChartChoice | None = None
    units: tuple[tuple[str, str], ...] = ()

    @classmethod
    def parse(cls, value):
        legacy = {'columns', 'filterField', 'contains', 'units'}
        modern = {'columns', 'filter', 'sort', 'selection', 'chart', 'units'}
        if not isinstance(value, dict) or set(value) - (legacy | modern):
            raise ValueError('Unknown request field')
        if {'filterField', 'contains'} & set(value) and {'filter', 'sort', 'selection', 'chart'} & set(value):
            raise ValueError('Unknown request field')
        if {'filter', 'sort', 'selection', 'chart'} & set(value):
            return cls._modern(value)
        return cls._legacy(value)

    @classmethod
    def _legacy(cls, value):
        # Older saved views stored one contains-filter. Read them as the richer view.
        field = value.get('filterField', '')
        if not isinstance(field, str) or len(field) > 300:
            raise ValueError('Invalid filter field')
        contains = value.get('contains', '')
        if not isinstance(contains, str) or len(contains) > 300:
            raise ValueError('Filter text is too long')
        if contains and not field:
            raise ValueError('Choose a field for the filter')
        chosen = FilterChoice(field, 'contains', contains) if field else None
        return cls(column_names(value), chosen, None, (), None, unit_labels(value))

    @classmethod
    def _modern(cls, value):
        raw_filter, raw_sort, raw_chart = value.get('filter'), value.get('sort'), value.get('chart')
        chosen = None
        if raw_filter is not None:
            if not isinstance(raw_filter, dict) or set(raw_filter) != {'field', 'operator', 'value'}:
                raise ValueError('Choose a field and a valid filter value')
            operator, text_value = raw_filter['operator'], raw_filter['value']
            if operator not in OPERATORS or not isinstance(text_value, str) or len(text_value) > 4096:
                raise ValueError('Choose a field and a valid filter value')
            if operator in ('gte', 'lte'):
                try:
                    threshold = Decimal(text_value)
                except ArithmeticError:
                    raise ValueError('A numeric filter needs a finite decimal value') from None
                if not threshold.is_finite():
                    raise ValueError('A numeric filter needs a finite decimal value')
            chosen = FilterChoice(literal_name(raw_filter['field'], 'filter field'), operator, text_value)
        sort = None
        if raw_sort is not None:
            if not isinstance(raw_sort, dict) or set(raw_sort) != {'field', 'descending'} or type(raw_sort['descending']) is not bool:
                raise ValueError('Choose a valid sort field and order')
            sort = SortChoice(literal_name(raw_sort['field'], 'sort field'), raw_sort['descending'])
        selected = value.get('selection', [])
        if (not isinstance(selected, list) or len(selected) > 1000 or len(set(selected)) != len(selected)
                or any(type(index) is not int or index < 0 for index in selected)):
            raise ValueError('Choose up to 1,000 distinct record identities')
        chart = None
        if raw_chart is not None:
            if (not isinstance(raw_chart, dict) or set(raw_chart) != {'category', 'measure', 'aggregation'}
                    or raw_chart['aggregation'] not in AGGREGATIONS):
                raise ValueError('Choose valid chart fields')
            chart = ChartChoice(literal_name(raw_chart['category'], 'chart field'),
                                literal_name(raw_chart['measure'], 'chart field'), raw_chart['aggregation'])
        return cls(column_names(value), chosen, sort, tuple(selected), chart, unit_labels(value))

    def admitted_columns(self, names):
        chosen = self.columns or tuple(names[:MAX_COLUMNS])
        referenced = set(chosen) | {name for name, _ in self.units}
        if self.filter:
            referenced.add(self.filter.field)
        if self.sort:
            referenced.add(self.sort.field)
        if self.chart:
            referenced.update((self.chart.category, self.chart.measure))
        if not referenced.issubset(names):
            raise ValueError('The view references a field absent from this version')
        return chosen

    def query_body(self, columns, offset, limit):
        body = {'columns': list(columns), 'selection': list(self.selection), 'offset': offset, 'limit': limit}
        if self.filter:
            body['filter'] = {'field': self.filter.field, 'operator': self.filter.operator, 'value': self.filter.value}
        if self.sort:
            body['sort'] = {'field': self.sort.field, 'descending': self.sort.descending}
        if self.chart:
            body['chart'] = {'category': self.chart.category, 'measure': self.chart.measure, 'aggregation': self.chart.aggregation}
        return body

    def public(self):
        return dict(
            columns=list(self.columns),
            filter=None if self.filter is None else dict(field=self.filter.field, operator=self.filter.operator, value=self.filter.value),
            sort=None if self.sort is None else dict(field=self.sort.field, descending=self.sort.descending),
            selection=list(self.selection),
            chart=None if self.chart is None else dict(category=self.chart.category, measure=self.chart.measure, aggregation=self.chart.aggregation),
            units=dict(self.units))


@dataclass(frozen=True)
class PreviewRequest:
    datasetId: str
    assetId: str
    view: ViewSpec
    offset: int = 0
    limit: int = 50
    parserVersion: str = PARSER_VERSION

    @classmethod
    def parse(cls, value):
        fields(value, ('datasetId', 'assetId', 'view', 'offset', 'limit', 'parserVersion'))
        offset, limit = value.get('offset', 0), value.get('limit', 50)
        if type(offset) is not int or not 0 <= offset <= MAX_ROWS or type(limit) is not int or not 1 <= limit <= 200:
            raise ValueError('Use a nonnegative offset and a page size of 1–200')
        parser = value.get('parserVersion', PARSER_VERSION)
        if parser != PARSER_VERSION:
            raise ValueError('This saved parser version is unavailable; the saved report is unchanged')
        return cls(identity(value.get('datasetId'), 'dataset', 'ds-'),
                   identity(value.get('assetId'), 'asset'), ViewSpec.parse(value.get('view', {})),
                   offset, limit, parser)


@dataclass(frozen=True)
class FieldProfile:
    name: str
    kinds: tuple[str, ...]
    missing: int
    nulls: int
    empty: int


@dataclass(frozen=True)
class Duplicate:
    row: int
    duplicateOf: int
    sourceLine: int | None


@dataclass(frozen=True)
class QualityReport:
    parserVersion: str
    scope: str
    rowCount: int
    fields: tuple[FieldProfile, ...]
    missing: int
    nulls: int
    empty: int
    duplicateRows: int
    duplicates: tuple[Duplicate, ...]
    blankLines: int = 0

    @classmethod
    def restore(cls, value):
        return cls(**(value | {
            'fields': tuple(FieldProfile(**(f | {'kinds': tuple(f['kinds'])})) for f in value['fields']),
            'duplicates': tuple(Duplicate(**row) for row in value['duplicates']),
        }))


@dataclass(frozen=True)
class SaveView:
    name: str
    preview: PreviewRequest

    @classmethod
    def parse(cls, value):
        fields(value, ('name', 'preview'))
        name = text(value.get('name'), 'view name', 120)
        if not name:
            raise ValueError('Name the saved view')
        return cls(name, PreviewRequest.parse(value.get('preview')))


@dataclass(frozen=True)
class SavedView:
    id: str
    name: str
    datasetId: str
    assetId: str
    sha256: str
    view: ViewSpec
    report: QualityReport
    createdAt: str

    @classmethod
    def restore(cls, value):
        return cls(**(value | {'view': ViewSpec.parse(value['view']),
                              'report': QualityReport.restore(value['report'])}))

    def public(self):
        return asdict(self) | {'view': self.view.public()}
