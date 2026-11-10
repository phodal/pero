"""Saved table projections and explicit, catalog-backed resynchronization."""
from contextlib import closing
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from hashlib import sha256
import json
import sqlite3
from uuid import uuid4

from catalog import CatalogQuery, StructuredRow, StructuredTableDraft, _fields, _id, _integer, _serialized, _text
from store import RevisionConflict


@dataclass(frozen=True)
class TableViewDefinition:
    identity: str
    name: str
    columns: tuple[str, ...]
    text: str
    sort_column: str
    descending: bool

    @classmethod
    def parse(cls, raw):
        _fields(raw, ('id', 'name', 'columns', 'text', 'sortColumn', 'descending'))
        columns = raw['columns']
        if not isinstance(columns, list) or not 1 <= len(columns) <= 50:
            raise ValueError('A view needs distinct visible columns')
        columns = tuple(_id(item) for item in columns)
        if len(set(columns)) != len(columns):
            raise ValueError('A view needs distinct visible columns')
        if type(raw['descending']) is not bool:
            raise ValueError('Invalid table view direction')
        return cls(_id(raw['id']), _text(raw['name'], required=True), columns,
                   _text(raw['text']), _id(raw['sortColumn']) if raw['sortColumn'] else _text(raw['sortColumn']), raw['descending'])

    def wire(self):
        return dict(id=self.identity, name=self.name, columns=list(self.columns), text=self.text,
                    sortColumn=self.sort_column, descending=self.descending)


@dataclass(frozen=True)
class SourceMapping:
    source: str
    target: str

    def wire(self):
        return dict(sourceColumnId=self.source, targetColumnId=self.target)


@dataclass(frozen=True)
class TableSourcePolicy:
    query: CatalogQuery
    mappings: tuple[SourceMapping, ...]
    add_new: bool
    update_existing: bool
    missing: str

    @classmethod
    def parse(cls, raw):
        _fields(raw, ('query', 'mappings', 'addNew', 'updateExisting', 'missing'))
        query = CatalogQuery.parse(raw['query'])
        if not query.schema_id:
            raise ValueError('Choose a source schema before mapping fields')
        mappings = raw['mappings']
        if not isinstance(mappings, list) or not 1 <= len(mappings) <= 50:
            raise ValueError('Map at least one source column')
        parsed = []
        for mapping in mappings:
            _fields(mapping, ('sourceColumnId', 'targetColumnId'))
            parsed.append(SourceMapping(_id(mapping['sourceColumnId']), _id(mapping['targetColumnId'])))
        if len({mapping.target for mapping in parsed}) != len(parsed):
            raise ValueError('Two source columns cannot write the same target')
        if any(type(raw[key]) is not bool for key in ('addNew', 'updateExisting')) or raw['missing'] not in ('keep', 'remove-unedited'):
            raise ValueError('Invalid resync options')
        return cls(query, tuple(parsed), raw['addNew'], raw['updateExisting'], raw['missing'])

    def wire(self):
        return dict(query=self.query.wire(), mappings=[item.wire() for item in self.mappings],
                    addNew=self.add_new, updateExisting=self.update_existing, missing=self.missing)


@dataclass(frozen=True)
class SourceRecord:
    identity: str
    version: int
    kinds: tuple[tuple[str, str], ...]
    cells: tuple[tuple[str, str], ...]

    @classmethod
    def from_catalog(cls, record):
        def raw(cell):
            if cell['type'] == 'missing':
                return ''
            if cell['type'] == 'quantity':
                return cell['value'] + ' ' + cell['unit']
            if cell['type'] == 'object':
                return _serialized(cell['value'])
            if cell['type'] == 'boolean':
                return 'true' if cell['value'] else 'false'
            return cell['value']
        return cls(record['id'], record['version'], tuple((col['id'], col['type']) for col in record['columns']),
                   tuple((key, raw(value)) for key, value in record['values'].items()))


@dataclass(frozen=True)
class SourceBaseline:
    record_id: str
    version: int
    row_id: str
    cells: tuple[tuple[str, str], ...]
    overrides: tuple[str, ...] = ()

    def wire(self):
        return dict(recordId=self.record_id, version=self.version, rowId=self.row_id, cells=dict(self.cells), overrides=list(self.overrides))


@dataclass(frozen=True)
class TableWorkflow:
    revision: int = 0
    views: tuple[TableViewDefinition, ...] = ()
    source: TableSourcePolicy | None = None
    baseline: tuple[SourceBaseline, ...] = ()

    def wire(self):
        return dict(revision=self.revision, views=[item.wire() for item in self.views],
                    source=self.source.wire() if self.source else None, baseline=[item.wire() for item in self.baseline])

    @classmethod
    def stored(cls, raw):
        return cls(raw['revision'], tuple(TableViewDefinition.parse(item) for item in raw['views']),
                   TableSourcePolicy.parse(raw['source']) if raw['source'] else None,
                   tuple(SourceBaseline(item['recordId'], item['version'], item['rowId'], tuple(item['cells'].items()), tuple(item.get('overrides', ()))) for item in raw['baseline']))


@dataclass(frozen=True)
class ResyncChange:
    kind: str
    row_id: str
    column_id: str = ''
    before: str = ''
    after: str = ''

    def wire(self):
        return dict(type=self.kind, rowId=self.row_id, columnId=self.column_id, before=self.before, after=self.after)


@dataclass(frozen=True)
class ResyncPlan:
    table: StructuredTableDraft
    baseline: tuple[SourceBaseline, ...]
    changes: tuple[ResyncChange, ...]

    def wire(self):
        return dict(table=self.table.wire(), baseline=[item.wire() for item in self.baseline], changes=[item.wire() for item in self.changes])


def plan_table_resync(table, policy, baseline, records):
    """Import typed source fields while retaining locally edited and unmapped cells."""
    columns = {column.identity: column for column in table.columns}
    for mapping in policy.mappings:
        if mapping.target not in columns:
            raise ValueError('A mapped target column was removed. Update the source mapping.')
    rows = list(table.rows)
    previous = {item.record_id: item for item in baseline}
    next_baseline = dict(previous)
    changes = []
    for record in records:
        source_cells, source_kinds = dict(record.cells), dict(record.kinds)
        mapped = {}
        for mapping in policy.mappings:
            target = columns[mapping.target]
            if mapping.source not in source_cells or source_kinds[mapping.source] != target.kind:
                raise ValueError('A source field is missing or its type differs from the mapped target')
            target.validate()
            target.parse_cell(source_cells[mapping.source])
            mapped[mapping.target] = source_cells[mapping.source]
        old = previous.get(record.identity)
        row_id = old.row_id if old else 'source_' + record.identity
        index = next((index for index, row in enumerate(rows) if row.identity == row_id), None)
        overrides = set(old.overrides) if old else set()
        if old is None:
            if not policy.add_new:
                continue
            if index is not None:
                raise ValueError('A source row identity already exists without provenance')
            rows.append(StructuredRow(row_id, tuple(mapped.items())))
            changes.append(ResyncChange('add-row', row_id))
        elif index is None:
            # Manual row deletion is an edit, not a request to resurrect it on refresh.
            changes.append(ResyncChange('preserve-deleted-row', row_id))
            continue
        elif policy.update_existing:
            row = rows[index]
            current_cells, old_cells = dict(row.cells), dict(old.cells)
            for key, value in mapped.items():
                current = current_cells.get(key, '')
                if key in overrides or current != old_cells.get(key, ''):
                    overrides.add(key)
                    changes.append(ResyncChange('preserve-manual', row_id, key, current, value))
                elif current != value:
                    current_cells[key] = value
                    changes.append(ResyncChange('update-cell', row_id, key, current, value))
            rows[index] = replace(row, cells=tuple(current_cells.items()))
        else:
            continue
        next_baseline[record.identity] = SourceBaseline(record.identity, record.version, row_id, tuple(mapped.items()), tuple(sorted(overrides & mapped.keys())))
    seen = {record.identity for record in records}
    for old in baseline:
        if old.record_id in seen:
            continue
        row = next((row for row in rows if row.identity == old.row_id), None)
        if row is None or policy.missing == 'keep':
            changes.append(ResyncChange('retain-missing-source', old.row_id))
            continue
        current, imported = dict(row.cells), dict(old.cells)
        if old.overrides or any(current.get(key, '') != imported.get(key, '') for key in current.keys() | imported.keys()):
            changes.append(ResyncChange('preserve-manual-row', old.row_id))
        else:
            rows.remove(row)
            next_baseline.pop(old.record_id)
            changes.append(ResyncChange('remove-row', old.row_id))
    if len(rows) > 200:
        raise ValueError('Resync would exceed the 200-row table limit')
    return ResyncPlan(replace(table, rows=tuple(rows)), tuple(next_baseline.values()), tuple(changes))


class TableWorkflowStore:
    def __init__(self, entries, catalog):
        self.path, self.catalog, self.entries = entries.path, catalog, entries
        with closing(self._connect()) as connection, connection:
            connection.executescript('''
                CREATE TABLE IF NOT EXISTS notebook_entry_table_workflows (
                    entry_id TEXT NOT NULL, table_id TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(entry_id, table_id));
                CREATE TABLE IF NOT EXISTS notebook_entry_table_resyncs (
                    id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, table_id TEXT NOT NULL, workflow_revision INTEGER NOT NULL,
                    input_hash TEXT NOT NULL, source_hash TEXT NOT NULL, plan TEXT NOT NULL,
                    created_at TEXT NOT NULL, applied TEXT);
            ''')

    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    def _read(self, connection, entry_id, table_id):
        self.entries._read(connection, entry_id)
        row = connection.execute('SELECT state FROM notebook_entry_table_workflows WHERE entry_id = ? AND table_id = ?', (entry_id, table_id)).fetchone()
        return TableWorkflow.stored(json.loads(row['state'])) if row else TableWorkflow()

    def read(self, entry_id, table_id):
        with closing(self._connect()) as connection:
            result = self._read(connection, _id(entry_id), _id(table_id)).wire()
            row = connection.execute('SELECT applied FROM notebook_entry_table_resyncs WHERE entry_id = ? AND table_id = ? AND applied IS NOT NULL ORDER BY created_at DESC LIMIT 1', (entry_id, table_id)).fetchone()
            result['lastApplied'] = json.loads(row['applied']) if row else None
            return result

    @staticmethod
    def _write(connection, entry_id, table_id, state):
        connection.execute('INSERT INTO notebook_entry_table_workflows VALUES (?, ?, ?) ON CONFLICT(entry_id, table_id) DO UPDATE SET state = excluded.state', (entry_id, table_id, _serialized(state.wire())))

    @staticmethod
    def _expected(state, expected):
        if state.revision != expected:
            raise RevisionConflict(state.revision)

    def configure(self, entry_id, table_id, payload):
        _id(entry_id)
        _fields(payload, ('expectedRevision', 'table', 'change'))
        table = StructuredTableDraft.parse(payload['table'])
        if table.identity != _id(table_id):
            raise ValueError('Workflow table identity does not match')
        expected = _integer(payload['expectedRevision'], minimum=0)
        raw = payload['change']
        if not isinstance(raw, dict) or raw.get('type') not in ('save-view', 'delete-view', 'source'):
            raise ValueError('Unknown table workflow change')
        kind = raw['type']
        _fields(raw, ('type', 'view' if kind == 'save-view' else 'id' if kind == 'delete-view' else 'source'))
        view = TableViewDefinition.parse(raw['view']) if kind == 'save-view' else None
        identity = _id(raw['id']) if kind == 'delete-view' else ''
        policy = TableSourcePolicy.parse(raw['source']) if kind == 'source' and raw['source'] is not None else None
        columns = {column.identity for column in table.columns}
        if view and (set(view.columns) - columns or view.sort_column and view.sort_column not in columns):
            raise ValueError('The saved view references a missing draft column')
        if policy and any(mapping.target not in columns for mapping in policy.mappings):
            raise ValueError('The source mapping references a missing draft column')
        with closing(self._connect()) as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            state = self._read(connection, entry_id, table_id)
            self._expected(state, expected)
            if kind == 'source':
                state = replace(state, source=policy)
            else:
                views = tuple(item for item in state.views if item.identity != (view.identity if view else identity))
                if view:
                    if len(views) >= 30 or any(item.name.casefold() == view.name.casefold() for item in views):
                        raise ValueError('View names must be distinct; at most 30 views are supported')
                    views += (view,)
                state = replace(state, views=views)
            state = replace(state, revision=state.revision + 1)
            self._write(connection, entry_id, table_id, state)
            return state.wire()

    def _source(self, connection, state):
        if state.source is None:
            raise ValueError('Configure and save a catalog source before resync')
        snapshot = self.catalog.lookup_in_connection(connection, state.source.query)
        if snapshot['total'] > len(snapshot['records']):
            raise ValueError('Source results exceed the query limit. Narrow the query before resync.')
        return snapshot, sha256(_serialized(dict(catalogId=snapshot['catalogId'], records=snapshot['records'])).encode()).hexdigest()

    def preview(self, entry_id, table_id, payload):
        _id(entry_id)
        _fields(payload, ('expectedRevision', 'table'))
        expected = _integer(payload['expectedRevision'], minimum=0)
        table = StructuredTableDraft.parse(payload['table'])
        if table.identity != _id(table_id):
            raise ValueError('Resync table identity does not match')
        with closing(self._connect()) as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            state = self._read(connection, entry_id, table_id)
            self._expected(state, expected)
            snapshot, source_hash = self._source(connection, state)
            if any(record['tableId'] == table_id for record in snapshot['records']):
                raise ValueError('A table cannot import its own registered records. Narrow the source query.')
            plan = plan_table_resync(table, state.source, state.baseline, tuple(SourceRecord.from_catalog(record) for record in snapshot['records']))
            identity = uuid4().hex
            response = dict(id=identity, entryId=entry_id, workflowRevision=state.revision, inputTable=table.wire(), **plan.wire(), snapshot=snapshot)
            connection.execute('INSERT INTO notebook_entry_table_resyncs VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)',
                (identity, entry_id, table_id, state.revision, sha256(_serialized(table.wire()).encode()).hexdigest(), source_hash,
                 _serialized(response), datetime.now(timezone.utc).isoformat(timespec='microseconds')))
            return response

    def apply(self, entry_id, table_id, payload):
        _id(entry_id)
        _fields(payload, ('previewId', 'table'))
        identity = _id(payload['previewId'])
        table = StructuredTableDraft.parse(payload['table'])
        if table.identity != _id(table_id):
            raise ValueError('Resync table identity does not match')
        with closing(self._connect()) as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            state = self._read(connection, entry_id, table_id)
            preview = connection.execute('SELECT * FROM notebook_entry_table_resyncs WHERE id = ? AND entry_id = ? AND table_id = ?', (identity, entry_id, table_id)).fetchone()
            if preview is None:
                raise ValueError('Resync preview does not exist')
            if preview['input_hash'] != sha256(_serialized(table.wire()).encode()).hexdigest():
                raise ValueError('The table changed after preview. Preview resync again.')
            if preview['applied']:
                return json.loads(preview['applied'])
            self._expected(state, preview['workflow_revision'])
            _, source_hash = self._source(connection, state)
            if preview['source_hash'] != source_hash:
                raise ValueError('The source changed after preview. Preview resync again.')
            plan = json.loads(preview['plan'])
            state = replace(state, revision=state.revision + 1, baseline=tuple(SourceBaseline(
                item['recordId'], item['version'], item['rowId'], tuple(item['cells'].items()), tuple(item.get('overrides', ()))) for item in plan['baseline']))
            self._write(connection, entry_id, table_id, state)
            result = dict(previewId=identity, entryId=entry_id, inputTable=plan['inputTable'], table=plan['table'], workflow=state.wire(), appliedAt=datetime.now(timezone.utc).isoformat(timespec='microseconds'))
            connection.execute('UPDATE notebook_entry_table_resyncs SET applied = ? WHERE id = ?', (_serialized(result), identity))
            return result
