"""Hierarchical template organization, independent of immutable template content."""
from contextlib import closing
from dataclasses import dataclass, replace
from datetime import datetime, timezone
import json
import sqlite3
from uuid import uuid4

from document import block_id, fields, integer, string
from store import RevisionConflict


@dataclass(frozen=True)
class TemplateCollection:
    identity: str
    name: str
    parent: str | None

    def wire(self):
        return dict(id=self.identity, name=self.name, parentId=self.parent)


@dataclass(frozen=True)
class CollectionLibrary:
    revision: int = 0
    collections: tuple[TemplateCollection, ...] = ()
    memberships: tuple[tuple[str, str], ...] = ()

    def wire(self):
        return dict(revision=self.revision, collections=[item.wire() for item in self.collections],
                    memberships=dict(self.memberships))

    @classmethod
    def stored(cls, raw):
        return cls(raw['revision'], tuple(TemplateCollection(item['id'], item['name'], item['parentId'])
                   for item in raw['collections']), tuple(raw['memberships'].items()))


@dataclass(frozen=True)
class CollectionChange:
    kind: str
    identity: str = ''
    name: str = ''
    parent: str | None = None

    @classmethod
    def parse(cls, raw):
        if not isinstance(raw, dict) or raw.get('type') not in ('create', 'rename', 'move', 'assign-template'):
            raise ValueError('Unknown template collection change')
        kind = raw['type']
        required = {'create': {'name', 'parentId'}, 'rename': {'id', 'name'},
                    'move': {'id', 'parentId'}, 'assign-template': {'templateId', 'collectionId'}}[kind]
        fields(raw, {'type'} | required)
        parent = raw.get('collectionId' if kind == 'assign-template' else 'parentId')
        return cls(kind, block_id(raw['templateId' if kind == 'assign-template' else 'id']) if kind != 'create' else '',
                   string(raw['name'], 'collection name', 100, required=True).strip() if 'name' in raw else '',
                   block_id(parent) if parent is not None else None)


def change_collection_library(state, change, new_id):
    """One owner for naming, acyclic hierarchy and membership transitions."""
    collections = list(state.collections)
    by_id = {item.identity: item for item in collections}
    if change.parent is not None and change.parent not in by_id:
        raise ValueError('Destination collection no longer exists')
    memberships = dict(state.memberships)
    if change.kind == 'assign-template':
        if change.parent is None:
            memberships.pop(change.identity, None)
        else:
            memberships[change.identity] = change.parent
    else:
        if change.kind == 'create':
            if len(collections) >= 200:
                raise ValueError('At most 200 template collections are supported')
            candidate = TemplateCollection(new_id, change.name, change.parent)
        else:
            current = by_id.get(change.identity)
            if current is None:
                raise ValueError('Collection no longer exists')
            candidate = replace(current, name=change.name) if change.kind == 'rename' else replace(current, parent=change.parent)
        parent = candidate.parent
        while parent is not None:
            if parent == candidate.identity:
                raise ValueError('A collection cannot move into itself or a descendant')
            parent = by_id[parent].parent
        if any(item.identity != candidate.identity and item.parent == candidate.parent and item.name.casefold() == candidate.name.casefold() for item in collections):
            raise ValueError('A collection with this name already exists at the destination')
        collections = [item for item in collections if item.identity != candidate.identity] + [candidate]
    return CollectionLibrary(state.revision + 1, tuple(collections), tuple(memberships.items()))


class TemplateCollectionStore:
    def __init__(self, entries, templates):
        self.path, self.templates = entries.path, templates
        with closing(self._connect()) as connection, connection:
            connection.execute('''CREATE TABLE IF NOT EXISTS notebook_collection_history (
                revision INTEGER PRIMARY KEY, occurred_at TEXT NOT NULL, change TEXT NOT NULL, state TEXT NOT NULL)''')

    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    def _read(self, connection, revision=None):
        row = connection.execute('SELECT state FROM notebook_collection_history WHERE (? IS NULL OR revision = ?) ORDER BY revision DESC LIMIT 1', (revision, revision)).fetchone()
        if row is None:
            if revision is not None and revision != 0:
                raise ValueError('Collection revision does not exist')
            return CollectionLibrary()
        return CollectionLibrary.stored(json.loads(row['state']))

    def read(self, revision=None):
        with closing(self._connect()) as connection:
            return self._read(connection, revision).wire()

    def history(self):
        with closing(self._connect()) as connection:
            result = []
            for row in connection.execute('SELECT * FROM notebook_collection_history ORDER BY revision DESC'):
                change = CollectionChange.parse(json.loads(row['change']))
                state = CollectionLibrary.stored(json.loads(row['state']))
                subject = next((item.name for item in state.collections if item.identity == change.identity), change.name or change.identity)
                parent = change.parent
                destination = []
                by_id = {item.identity: item for item in state.collections}
                while parent is not None:
                    destination.insert(0, by_id[parent].name)
                    parent = by_id[parent].parent
                result.append(dict(revision=row['revision'], occurredAt=row['occurred_at'], change=json.loads(row['change']),
                                   subject=subject, destination=destination))
            return result

    def apply(self, payload):
        fields(payload, {'expectedRevision', 'change'})
        expected = integer(payload['expectedRevision'], 'collection revision', minimum=0)
        change = CollectionChange.parse(payload['change'])
        with closing(self._connect()) as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            current = self._read(connection)
            if current.revision != expected:
                raise RevisionConflict(current.revision)
            if change.kind == 'assign-template':
                self.templates._read(connection, change.identity)
            next_state = change_collection_library(current, change, uuid4().hex)
            connection.execute('INSERT INTO notebook_collection_history VALUES (?, ?, ?, ?)',
                (next_state.revision, datetime.now(timezone.utc).isoformat(timespec='microseconds'),
                 json.dumps(payload['change'], ensure_ascii=False), json.dumps(next_state.wire(), ensure_ascii=False)))
            return next_state.wire()
