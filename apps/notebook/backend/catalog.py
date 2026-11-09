"""Notebook's own typed local catalog. Draft saving never registers a record.

The catalog is not a connection to Benchling, Host inventory, or any external registry.
Only explicit submissions create immutable record versions and an atomic receipt.
"""
from contextlib import closing
from dataclasses import dataclass
from datetime import date, datetime, timezone
from hashlib import sha256
import json
import math
import re
import sqlite3
from uuid import uuid4


IDENTITY = re.compile(r'[A-Za-z0-9_-]{1,128}')
DECIMAL = re.compile(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?', re.ASCII)
TYPES = {'text', 'decimal', 'quantity', 'boolean', 'date', 'object', 'missing'}
SOURCE = 'notebook-local-catalog'


class SubmissionConflict(ValueError):
    """A submission ID is already bound to a different immutable input."""


class SchemaConflict(ValueError):
    """A registered schema revision already has a different definition."""


def _fields(value, names, optional=()):
    if not isinstance(value, dict) or not set(names) <= value.keys() or value.keys() - set(names) - set(optional):
        raise ValueError('Invalid catalog object fields')
    return value


def _text(value, maximum=200, required=False):
    if not isinstance(value, str) or len(value) > maximum or (required and not value.strip()):
        raise ValueError('Invalid catalog text')
    return value


def _id(value):
    if not isinstance(value, str) or not IDENTITY.fullmatch(value):
        raise ValueError('Invalid catalog ID')
    return value


def _integer(value, minimum=1, maximum=2147483647):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError('Invalid catalog integer')
    return value


def _choices(value):
    if not isinstance(value, list) or len(value) > 100:
        raise ValueError('Invalid catalog options')
    result = tuple(_text(item, required=True) for item in value)
    if len(set(result)) != len(result) or any(item.strip() != item for item in result):
        raise ValueError('Options must be distinct and trimmed')
    return result


def _decimal(value):
    return bool(DECIMAL.fullmatch(value)) and math.isfinite(float(value))


def _json(value, depth=0):
    if depth > 16:
        return False
    if value is None or type(value) in (str, bool):
        return True
    if type(value) in (int, float):
        try:
            return math.isfinite(value)
        except OverflowError:
            return False
    if isinstance(value, list):
        return all(_json(item, depth + 1) for item in value)
    return isinstance(value, dict) and all(_json(item, depth + 1) for item in value.values())


def _date(value):
    if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value):
        return False
    try:
        date.fromisoformat(value)
        return True
    except ValueError:
        return False


def _timestamp(value):
    _text(value, 40)
    if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|\+00:00)', value):
        raise ValueError('Invalid catalog timestamp')
    datetime.fromisoformat(value.replace('Z', '+00:00'))


def _serialized(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


@dataclass(frozen=True)
class TypedCell:
    kind: str
    value: str | bool | None = None
    unit: str = ''

    def wire(self):
        if self.kind == 'missing':
            return {'type': self.kind}
        result = {'type': self.kind, 'value': json.loads(self.value) if self.kind == 'object' else self.value}
        if self.kind == 'quantity':
            result['unit'] = self.unit
        return result


@dataclass(frozen=True)
class StructuredColumn:
    identity: str
    name: str
    kind: str
    required: bool
    options: tuple[str, ...]
    units: tuple[str, ...]

    @classmethod
    def parse(cls, value):
        _fields(value, ('id', 'name', 'type', 'required', 'options', 'units'))
        if not isinstance(value['type'], str) or value['type'] not in TYPES or type(value['required']) is not bool:
            raise ValueError('Invalid column type or requirement')
        return cls(_id(value['id']), _text(value['name']), value['type'], value['required'], _choices(value['options']), _choices(value['units']))

    def wire(self):
        return {'id': self.identity, 'name': self.name, 'type': self.kind, 'required': self.required, 'options': list(self.options), 'units': list(self.units)}

    def validate(self):
        if not self.name.strip():
            raise ValueError('Column names are required')
        if (self.kind != 'text' and self.options) or (not self.units if self.kind == 'quantity' else bool(self.units)) or (self.kind == 'missing' and self.required):
            raise ValueError('Only text supports options; quantities require allowed units; missing cannot be required')

    def parse_cell(self, raw):
        value = raw.strip()
        if not value:
            if self.required:
                raise ValueError('A value is required')
            return TypedCell('missing')
        if self.kind == 'missing':
            raise ValueError('This column accepts only missing values')
        if self.options and value not in self.options:
            raise ValueError('Choose one of the controlled options')
        if self.kind == 'text':
            return TypedCell('text', raw)
        if self.kind == 'decimal' and _decimal(value):
            return TypedCell('decimal', value)
        if self.kind == 'quantity':
            match = re.fullmatch(r'(\S+)\s+(.+)', value)
            if not match or not _decimal(match[1]):
                raise ValueError('Enter a decimal and unit, for example 2.5 mg')
            if match[2] not in self.units:
                raise ValueError('Use one of the allowed units')
            return TypedCell('quantity', match[1], match[2])
        if self.kind == 'boolean' and value in ('true', 'false'):
            return TypedCell('boolean', value == 'true')
        if self.kind == 'date' and _date(value):
            return TypedCell('date', value)
        if self.kind == 'object':
            try:
                parsed = json.loads(value)
            except (ValueError, RecursionError) as error:
                raise ValueError('Enter a JSON object') from error
            if isinstance(parsed, dict) and _json(parsed):
                return TypedCell('object', _serialized(parsed))
        raise ValueError(f'Invalid {self.kind} value')


@dataclass(frozen=True)
class StructuredRow:
    identity: str
    cells: tuple[tuple[str, str], ...]

    def wire(self):
        return {'id': self.identity, 'cells': dict(self.cells)}


@dataclass(frozen=True)
class StructuredTableDraft:
    identity: str
    name: str
    schema_id: str
    schema_revision: int
    columns: tuple[StructuredColumn, ...]
    rows: tuple[StructuredRow, ...]

    @classmethod
    def parse(cls, value):
        _fields(value, ('id', 'name', 'schema', 'rows'))
        schema = _fields(value['schema'], ('id', 'revision', 'columns'))
        if not isinstance(schema['columns'], list) or not 1 <= len(schema['columns']) <= 50:
            raise ValueError('A table needs 1–50 columns')
        columns = tuple(StructuredColumn.parse(column) for column in schema['columns'])
        column_ids = {column.identity for column in columns}
        if len(column_ids) != len(columns):
            raise ValueError('Duplicate column ID')
        if not isinstance(value['rows'], list) or len(value['rows']) > 200:
            raise ValueError('A table supports up to 200 rows')
        rows = []
        for row in value['rows']:
            _fields(row, ('id', 'cells'))
            if not isinstance(row['cells'], dict) or row['cells'].keys() - column_ids:
                raise ValueError('Unknown column in row')
            rows.append(StructuredRow(_id(row['id']), tuple((key, _text(cell, 4096)) for key, cell in row['cells'].items())))
        if len({row.identity for row in rows}) != len(rows):
            raise ValueError('Duplicate row ID')
        return cls(_id(value['id']), _text(value['name']), _id(schema['id']), _integer(schema['revision']), columns, tuple(rows))

    def wire(self):
        return {'id': self.identity, 'name': self.name, 'schema': {'id': self.schema_id, 'revision': self.schema_revision,
                'columns': [column.wire() for column in self.columns]}, 'rows': [row.wire() for row in self.rows]}

    def typed_rows(self):
        if not self.name.strip() or not self.rows:
            raise ValueError('Name the table and add at least one row before submitting')
        names = [column.name.strip().lower() for column in self.columns]
        if len(set(names)) != len(names):
            raise ValueError('Column names must be distinct')
        for column in self.columns:
            column.validate()
        result = []
        for row in self.rows:
            raw = dict(row.cells)
            cells = []
            for column in self.columns:
                try:
                    cells.append((column.identity, column.parse_cell(raw.get(column.identity, ''))))
                except ValueError as error:
                    raise ValueError(f'Row {row.identity}, column {column.name}: {error}') from error
            result.append((row.identity, tuple(cells)))
        return tuple(result)


@dataclass(frozen=True)
class CatalogQuery:
    schema_id: str = ''
    text: str = ''
    limit: int = 100

    @classmethod
    def parse(cls, value):
        _fields(value, ('schemaId', 'text', 'limit'))
        return cls(_id(value['schemaId']) if value['schemaId'] else _text(value['schemaId']), _text(value['text']), _integer(value['limit'], maximum=200))

    def wire(self):
        return {'schemaId': self.schema_id, 'text': self.text, 'limit': self.limit}


def _receipt(value):
    _fields(value, ('source', 'catalogId', 'submissionId', 'inputHash', 'tableId', 'schemaId', 'schemaRevision', 'registeredAt', 'records'))
    if value['source'] != SOURCE or not isinstance(value['inputHash'], str) or not re.fullmatch('[a-f0-9]{64}', value['inputHash']):
        raise ValueError('Invalid catalog receipt provenance')
    for key in ('catalogId', 'submissionId', 'tableId', 'schemaId'):
        _id(value[key])
    _integer(value['schemaRevision'])
    _timestamp(value['registeredAt'])
    if not isinstance(value['records'], list) or not 1 <= len(value['records']) <= 200:
        raise ValueError('Invalid registered records')
    for record in value['records']:
        _fields(record, ('rowId', 'recordId', 'version'))
        _id(record['rowId'])
        _id(record['recordId'])
        _integer(record['version'])
    if any(len({row[key] for row in value['records']}) != len(value['records']) for key in ('rowId', 'recordId')):
        raise ValueError('Duplicate registered row or record')


def _typed_value(value):
    if not isinstance(value, dict) or not isinstance(value.get('type'), str) or value['type'] not in TYPES:
        raise ValueError('Invalid catalog typed value')
    kind = value['type']
    _fields(value, ('type',) if kind == 'missing' else ('type', 'value', 'unit') if kind == 'quantity' else ('type', 'value'))
    if kind == 'missing':
        return
    raw = value['value']
    if kind == 'boolean':
        if type(raw) is not bool:
            raise ValueError('Invalid catalog boolean')
    elif kind == 'object':
        if not isinstance(raw, dict) or not _json(raw) or len(_serialized(raw)) > 4096:
            raise ValueError('Invalid catalog object')
    else:
        _text(raw, 4096)
        if (kind in ('decimal', 'quantity') and not _decimal(raw)) or (kind == 'date' and not _date(raw)):
            raise ValueError('Invalid catalog scalar')
        if kind == 'quantity':
            _text(value['unit'], required=True)


def _snapshot(value):
    _fields(value, ('source', 'catalogId', 'query', 'refreshedAt', 'total', 'records'))
    query = CatalogQuery.parse(value['query'])
    _id(value['catalogId'])
    _timestamp(value['refreshedAt'])
    total = _integer(value['total'], minimum=0)
    if value['source'] != SOURCE or not isinstance(value['records'], list) or len(value['records']) > min(query.limit, total):
        raise ValueError('Invalid catalog snapshot')
    identities = set()
    for record in value['records']:
        _fields(record, ('id', 'version', 'schemaId', 'schemaRevision', 'tableId', 'rowId', 'name', 'registeredAt', 'values', 'columns'))
        for key in ('id', 'schemaId', 'tableId', 'rowId'):
            _id(record[key])
        if record['id'] in identities:
            raise ValueError('Duplicate catalog record')
        identities.add(record['id'])
        _integer(record['version'])
        _integer(record['schemaRevision'])
        _text(record['name'])
        _timestamp(record['registeredAt'])
        if not isinstance(record['columns'], list) or not 1 <= len(record['columns']) <= 50:
            raise ValueError('Invalid catalog columns')
        columns = tuple(StructuredColumn.parse(column) for column in record['columns'])
        ids = {column.identity for column in columns}
        if len(ids) != len(columns) or not isinstance(record['values'], dict) or record['values'].keys() != ids:
            raise ValueError('Invalid catalog values')
        for column in columns:
            column.validate()
            cell = record['values'][column.identity]
            _typed_value(cell)
            if cell['type'] == 'missing':
                if column.required:
                    raise ValueError('Required catalog value is missing')
            elif cell['type'] != column.kind or (column.kind == 'quantity' and cell['unit'] not in column.units) or (column.options and cell['value'].strip() not in column.options):
                raise ValueError('Catalog value does not match its schema')


def validate_attribute(kind, attrs):
    """Document-boundary validation. Invalid semantic input stays an editable draft."""
    if kind == 'lookupTable':
        _fields(attrs, ('query', 'snapshot'), ('blockId',))
        CatalogQuery.parse(attrs['query'])
        if attrs['snapshot'] is not None:
            _snapshot(attrs['snapshot'])
    elif kind in ('inputTable', 'registrationTable'):
        _fields(attrs, ('table', 'receipts'), ('blockId',))
        StructuredTableDraft.parse(attrs['table'])
        if not isinstance(attrs['receipts'], list) or len(attrs['receipts']) > 100:
            raise ValueError('Invalid catalog receipts')
        for receipt in attrs['receipts']:
            _receipt(receipt)
        if len({(receipt['catalogId'], receipt['submissionId']) for receipt in attrs['receipts']}) != len(attrs['receipts']):
            raise ValueError('Duplicate submission receipt')
    else:
        raise ValueError('Unknown structured table kind')


class CatalogStore:
    """The imperative owner of SQLite catalog writes and clock/record identities."""
    def __init__(self, path):
        self.path = path
        with closing(self._connect()) as connection, connection:
            connection.executescript('''
                CREATE TABLE IF NOT EXISTS catalog_identity (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), id TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS catalog_schemas (
                    id TEXT NOT NULL, revision INTEGER NOT NULL, columns TEXT NOT NULL, PRIMARY KEY (id, revision));
                CREATE TABLE IF NOT EXISTS catalog_rows (
                    table_id TEXT NOT NULL, row_id TEXT NOT NULL, id TEXT NOT NULL UNIQUE, version INTEGER NOT NULL,
                    PRIMARY KEY (table_id, row_id));
                CREATE TABLE IF NOT EXISTS catalog_versions (
                    record_id TEXT NOT NULL, version INTEGER NOT NULL, schema_id TEXT NOT NULL, data TEXT NOT NULL,
                    search_text TEXT NOT NULL, registered_at TEXT NOT NULL, PRIMARY KEY (record_id, version));
                CREATE TABLE IF NOT EXISTS catalog_submissions (
                    id TEXT PRIMARY KEY, input_hash TEXT NOT NULL, input TEXT NOT NULL, receipt TEXT NOT NULL);
            ''')
            connection.execute('INSERT OR IGNORE INTO catalog_identity VALUES (1, ?)', (uuid4().hex,))
            self.identity = connection.execute('SELECT id FROM catalog_identity WHERE singleton = 1').fetchone()[0]

    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    def register(self, payload):
        _fields(payload, ('submissionId', 'table'))
        submission_id = _id(payload['submissionId'])
        table = StructuredTableDraft.parse(payload['table'])
        typed_rows = table.typed_rows()
        raw = _serialized(table.wire())
        input_hash = sha256(raw.encode()).hexdigest()
        columns = _serialized([column.wire() for column in table.columns])
        with closing(self._connect()) as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            existing = connection.execute('SELECT input_hash, receipt FROM catalog_submissions WHERE id = ?', (submission_id,)).fetchone()
            if existing:
                if existing['input_hash'] != input_hash:
                    raise SubmissionConflict('Submission ID already belongs to another input. Submit the edited draft with a new ID.')
                return json.loads(existing['receipt'])
            schema = connection.execute('SELECT columns FROM catalog_schemas WHERE id = ? AND revision = ?', (table.schema_id, table.schema_revision)).fetchone()
            if schema and schema['columns'] != columns:
                raise SchemaConflict('This schema revision already has another definition. Update the column settings to create a new revision.')
            connection.execute('INSERT OR IGNORE INTO catalog_schemas VALUES (?, ?, ?)', (table.schema_id, table.schema_revision, columns))
            registered_at = datetime.now(timezone.utc).isoformat(timespec='microseconds')
            records = []
            for row_id, cells in typed_rows:
                current = connection.execute('SELECT id, version FROM catalog_rows WHERE table_id = ? AND row_id = ?', (table.identity, row_id)).fetchone()
                record_id = current['id'] if current else uuid4().hex
                version = current['version'] + 1 if current else 1
                record = {'id': record_id, 'version': version, 'schemaId': table.schema_id, 'schemaRevision': table.schema_revision,
                          'tableId': table.identity, 'rowId': row_id, 'name': table.name, 'registeredAt': registered_at,
                          'values': {key: cell.wire() for key, cell in cells}, 'columns': [column.wire() for column in table.columns]}
                connection.execute('INSERT INTO catalog_versions VALUES (?, ?, ?, ?, ?, ?)',
                                   (record_id, version, table.schema_id, _serialized(record), _serialized(record).casefold(), registered_at))
                connection.execute('INSERT INTO catalog_rows VALUES (?, ?, ?, ?) ON CONFLICT (table_id, row_id) DO UPDATE SET version = excluded.version',
                                   (table.identity, row_id, record_id, version))
                records.append({'rowId': row_id, 'recordId': record_id, 'version': version})
            receipt = {'source': SOURCE, 'catalogId': self.identity, 'submissionId': submission_id, 'inputHash': input_hash, 'tableId': table.identity,
                       'schemaId': table.schema_id, 'schemaRevision': table.schema_revision, 'registeredAt': registered_at, 'records': records}
            connection.execute('INSERT INTO catalog_submissions VALUES (?, ?, ?, ?)', (submission_id, input_hash, raw, _serialized(receipt)))
            return receipt

    def lookup(self, query):
        # HTTP query conversion belongs to the transport, before this typed boundary.
        query = CatalogQuery.parse(query)
        with closing(self._connect()) as connection:
            connection.execute('BEGIN')
            params = (query.schema_id, query.schema_id, query.text.casefold())
            selection = '''FROM catalog_rows r JOIN catalog_versions v ON v.record_id = r.id AND v.version = r.version
                WHERE (? = '' OR v.schema_id = ?) AND instr(v.search_text, ?) > 0'''
            total = connection.execute('SELECT COUNT(*) ' + selection, params).fetchone()[0]
            rows = connection.execute('SELECT v.data ' + selection + ' ORDER BY v.registered_at DESC, v.record_id LIMIT ?', (*params, query.limit))
            records = [json.loads(row['data']) for row in rows]
            return {'source': SOURCE, 'catalogId': self.identity, 'query': query.wire(), 'refreshedAt': datetime.now(timezone.utc).isoformat(timespec='microseconds'), 'total': total, 'records': records}
