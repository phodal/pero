"""Data owns frozen projections, reviewed definitions and query receipts."""
from dataclasses import asdict
from datetime import datetime, timezone
from hashlib import sha256
import json
import math
import re
import sqlite3
from threading import Event
from uuid import uuid4

from analysis import Analysis
from semantic_domain import Projection, QueryDefinition, ReadGrant
from semantic_sql import ReadOnlyQuery


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode()


class SemanticQueries:
    def __init__(self, catalog):
        self.catalog = catalog
        self.analysis = Analysis(catalog)
        self.root = catalog.directory / 'queries'
        self.root.mkdir(exist_ok=True)
        self.running = {}

    def save(self, kind, value):
        content = encoded(value)
        identity = sha256(content).hexdigest()
        path = self.root / f'{identity}.{kind}.json'
        with self.catalog.lock:
            if not path.exists():
                # Rename a complete document; interrupted writes never appear in history.
                temporary = self.root / f'.{uuid4().hex}.tmp'
                temporary.write_bytes(content)
                temporary.replace(path)
        return identity

    def read(self, kind, identity):
        if not isinstance(identity, str) or not re.fullmatch('[a-f0-9]{64}', identity):
            raise ValueError('Choose a saved query reference')
        path = self.root / f'{identity}.{kind}.json'
        if not path.exists():
            raise ValueError('Saved query evidence is unavailable')
        content = path.read_bytes()
        if sha256(content).hexdigest() != identity:
            raise ValueError('Saved query evidence hash mismatch')
        return json.loads(content)

    def snapshot(self, values):
        if not isinstance(values, list) or not 1 <= len(values) <= 5:
            raise ValueError('Select 1–5 fixed Data versions')
        projections = tuple(Projection.parse(v) for v in values)
        if len({p.table for p in projections}) != len(projections):
            raise ValueError('Each projected table needs a different name')
        sources = []
        temporary = self.root / f'.{uuid4().hex}.sqlite'
        connection = sqlite3.connect(temporary)
        complete = False
        try:
            for projection in projections:
                export = self.analysis.export(dict(datasetId=projection.dataset_id, assetId=projection.asset_id))
                document = json.loads(export['content'])
                columns = projection.columns
                names = ','.join('"' + name.replace('"', '""') + '" ' + ('REAL' if kind == 'number' else 'TEXT') for name, kind in columns)
                connection.execute(f'CREATE TABLE "{projection.table}" ({names})')
                rows = []
                for row in document['rows']:
                    cells = []
                    for name, kind in columns:
                        if name not in row:
                            raise ValueError(f'Projected column {name} is missing; choose an explicit complete column')
                        cell = row[name]
                        if cell is None or cell == '':
                            cell = None
                        elif kind == 'number':
                            if isinstance(cell, bool) or not isinstance(cell, (str, int, float)):
                                raise ValueError(f'{name} contains a non-numeric value')
                            cell = float(cell)
                            if not math.isfinite(cell):
                                raise ValueError(f'{name} contains a non-finite value')
                        elif not isinstance(cell, str):
                            raise ValueError(f'{name} requires an explicit text value')
                        cells.append(cell)
                    rows.append(cells)
                connection.executemany(f'INSERT INTO "{projection.table}" VALUES ({",".join("?" for _ in columns)})', rows)
                sources.append(dict(projection=asdict(projection), exportId=export['id'], manifest=document['manifest']))
            connection.commit()
            complete = True
        finally:
            connection.close()
            if not complete:
                temporary.unlink(missing_ok=True)
        database_hash = sha256(temporary.read_bytes()).hexdigest()
        temporary.replace(self.root / f'{database_hash}.sqlite')
        snapshot = dict(schema='pero.query-snapshot.v1', sources=sources, databaseHash=database_hash,
                        conversion='Explicit text/number; empty string and null become SQL NULL; finite numbers only')
        identity = self.save('snapshot', snapshot)
        return dict(id=identity, **snapshot)

    def definition(self, raw):
        QueryDefinition.parse(raw)
        identity = self.save('definition', raw)
        return dict(id=identity, **raw)

    def execute(self, value):
        if set(value) != {'snapshotId', 'definitionId', 'parameters', 'question'} or not isinstance(value['question'], str) or not 0 < len(value['question']) <= 4000:
            raise ValueError('Choose a snapshot, definition, bound parameters and question')
        snapshot = self.read('snapshot', value['snapshotId'])
        definition = QueryDefinition.parse(self.read('definition', value['definitionId']))
        parameters = definition.bind(value['parameters'])
        grant = ReadGrant('Host-authenticated Data profile', 'local-app-data', tuple(
            (s['projection']['table'], tuple(name for name, _ in s['projection']['columns'])) for s in snapshot['sources']))
        intent = dict(**value, actor=grant.actor, scope=asdict(grant), startedAt=datetime.now(timezone.utc).isoformat(),
                      nonce=uuid4().hex, sqliteVersion=sqlite3.sqlite_version, vmBudget=250000, modelRun=False, usage=None)
        query_id = self.save('intent', intent)
        cancel = Event()
        with self.catalog.lock:
            self.running[query_id] = cancel
        receipt = dict(queryId=query_id, status='failed', reason='', rows=[], rowCount=None, truncated=False, elapsedSeconds=None)
        try:
            database = self.root / (snapshot['databaseHash'] + '.sqlite')
            if not database.exists() or sha256(database.read_bytes()).hexdigest() != snapshot['databaseHash']:
                raise ValueError('Read-only snapshot is missing or changed; original query was not replayed')
            result = ReadOnlyQuery(database, grant, 250000).execute(definition.sql, dict(parameters), cancel)
            result_id = self.save('rows', result.rows)
            receipt.update(status='completed', resultId=result_id, rows=result.rows[:100], rowCount=len(result.rows),
                           truncated=len(result.rows) > 100, elapsedSeconds=result.elapsed_seconds)
        except (sqlite3.Error, ValueError) as error:
            receipt.update(status='cancelled' if cancel.is_set() else 'failed',
                reason='Query exceeded the 250000 VM-operation budget' if str(error) == 'interrupted' and not cancel.is_set() else str(error))
        finally:
            with self.catalog.lock:
                self.running.pop(query_id, None)
        receipt_id = self.save('receipt', receipt)
        return self.evidence(query_id) | dict(receiptId=receipt_id)

    def evidence(self, identity):
        intent = self.read('intent', identity)
        receipts = [self.read('receipt', p.name.split('.')[0]) for p in self.root.glob('*.receipt.json')]
        receipt = next((r for r in receipts if r['queryId'] == identity), None)
        if receipt is None:
            with self.catalog.lock:
                active = identity in self.running
            receipt = dict(queryId=identity, status='running' if active else 'interrupted',
                           reason='No completed receipt; inspect before explicitly starting a new query', rows=[], rowCount=None, truncated=False)
        if receipt.get('resultId'):
            rows = self.read('rows', receipt['resultId'])
            if len(rows) != receipt['rowCount']:
                raise ValueError('Stored result count does not match its receipt')
        return dict(id=identity, intent=intent, receipt=receipt,
                    snapshot=self.read('snapshot', intent['snapshotId']),
                    definition=self.read('definition', intent['definitionId']), acceptance='needs_review')

    def history(self):
        values = []
        for path in sorted(self.root.glob('*.intent.json'), reverse=True):
            identity = path.name.split('.')[0]
            intent = self.read('intent', identity)
            values.append(dict(id=identity, question=intent['question'], startedAt=intent['startedAt'],
                               snapshotId=intent['snapshotId'], definitionId=intent['definitionId']))
        return sorted(values, key=lambda item: item['startedAt'], reverse=True)

    def check(self, identity):
        evidence = self.evidence(identity)
        definition = QueryDefinition.parse(evidence['definition'])
        spec = definition.check
        if spec is None or evidence['receipt']['status'] != 'completed':
            raise ValueError('This query has no completed result with an independent whole-table check')
        source = next((s for s in evidence['snapshot']['sources'] if s['projection']['table'] == spec.table), None)
        if source is None:
            raise ValueError('Independent check table is outside the frozen projection')
        path = self.analysis.exports / (source['exportId'] + '.export.json')
        if not path.exists() or sha256(path.read_bytes()).hexdigest() != source['exportId']:
            raise ValueError('Independent source export is unavailable or changed')
        # Independent arithmetic reads original exported records, never SQLite or SQL result expressions.
        rows = json.loads(path.read_bytes())['rows']
        if spec.operation != 'count' and (spec.column, 'number') not in map(tuple, source['projection']['columns']):
            raise ValueError('Independent arithmetic requires an explicitly numeric projected column')
        result = self.read('rows', evidence['receipt']['resultId'])
        actual = result[0].get(spec.result_column) if len(result) == 1 else None
        comparison = spec.compare(tuple(row.get(spec.column) for row in rows), len(rows), actual,
                                  len(result) == 1 and spec.result_column in result[0])
        check = dict(queryId=identity, method='source-export Decimal arithmetic; absolute tolerance 0.000001',
                     **asdict(comparison), actual=actual, exportId=source['exportId'], acceptance='needs_review')
        return dict(id=self.save('check', check), **check)

    def request(self, value):
        operation = value.get('operation')
        if operation == 'snapshot' and set(value) == {'operation', 'sources'}:
            return self.snapshot(value['sources'])
        if operation == 'definition' and set(value) == {'operation', 'definition'}:
            return self.definition(value['definition'])
        if operation == 'execute':
            return self.execute({k: v for k, v in value.items() if k != 'operation'})
        if operation == 'list' and set(value) == {'operation'}:
            return dict(queries=self.history())
        if operation in ('read', 'check', 'cancel') and set(value) == {'operation', 'queryId'}:
            if operation == 'read':
                return self.evidence(value['queryId'])
            if operation == 'check':
                return self.check(value['queryId'])
            self.read('intent', value['queryId'])
            with self.catalog.lock:
                event = self.running.get(value['queryId'])
                if event is not None:
                    event.set()
            return self.evidence(value['queryId'])
        raise ValueError('Unknown query operation or fields')
