"""Recoverable catalog visibility changes never edit registered record versions."""
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timezone
import json

from catalog import _fields, _id, _integer, _text, _serialized
from store import RevisionConflict


class MissingCatalogRecord(Exception):
    pass


@dataclass(frozen=True)
class CatalogArchiveChange:
    version: int
    revision: int
    archived: bool
    reason: str

    @classmethod
    def parse(cls, value):
        _fields(value, ('expectedVersion', 'expectedArchiveRevision', 'archived', 'reason'))
        if type(value['archived']) is not bool:
            raise ValueError('Archived must be boolean')
        return cls(_integer(value['expectedVersion']), _integer(value['expectedArchiveRevision'], minimum=0),
                   value['archived'], _text(value['reason'], 500, required=True))


class CatalogArchiveStore:
    def __init__(self, catalog):
        self.catalog = catalog

    def _read(self, connection, identity):
        row = connection.execute('SELECT v.data FROM catalog_rows r JOIN catalog_versions v ON v.record_id = r.id AND v.version = r.version WHERE r.id = ?', (identity,)).fetchone()
        if row is None:
            raise MissingCatalogRecord('Catalog record does not exist')
        state = connection.execute('SELECT revision, archived FROM catalog_archives WHERE record_id = ?', (identity,)).fetchone()
        history = [json.loads(row['event']) for row in connection.execute('SELECT event FROM catalog_archive_history WHERE record_id = ? ORDER BY revision DESC', (identity,))]
        return dict(record=json.loads(row['data']), catalogId=self.catalog.identity,
                    archived=bool(state['archived']) if state else False, archiveRevision=state['revision'] if state else 0, history=history)

    def read(self, identity):
        with closing(self.catalog._connect()) as connection:
            return self._read(connection, _id(identity))

    def apply(self, identity, payload):
        identity, change = _id(identity), CatalogArchiveChange.parse(payload)
        with closing(self.catalog._connect()) as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            current = self._read(connection, identity)
            if current['record']['version'] != change.version:
                raise RevisionConflict(current['record']['version'])
            if current['archiveRevision'] != change.revision:
                raise RevisionConflict(current['archiveRevision'])
            revision = change.revision + 1
            event = dict(revision=revision, recordVersion=change.version, archived=change.archived, reason=change.reason,
                         occurredAt=datetime.now(timezone.utc).isoformat(timespec='microseconds'))
            connection.execute('INSERT INTO catalog_archive_history VALUES (?, ?, ?)', (identity, revision, _serialized(event)))
            connection.execute('INSERT INTO catalog_archives VALUES (?, ?, ?) ON CONFLICT(record_id) DO UPDATE SET revision = excluded.revision, archived = excluded.archived', (identity, revision, int(change.archived)))
            return self._read(connection, identity)
