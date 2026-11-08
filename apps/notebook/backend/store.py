"""Append-only local revisions with an atomic expected-revision check."""

from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
from uuid import uuid4

from document import NotebookDocument


class MissingEntry(Exception):
    pass


class RevisionConflict(Exception):
    def __init__(self, current_revision):
        super().__init__('The entry changed. Load its current revision before saving.')
        self.current_revision = current_revision


@dataclass(frozen=True)
class Entry:
    identity: str
    revision: int
    updated_at: str
    document: NotebookDocument

    def wire(self, *, summary=False):
        result = {
            'id': self.identity, 'title': self.document.title, 'revision': self.revision,
            'updatedAt': self.updated_at,
        }
        if not summary:
            result['document'] = self.document.wire()
        return result


def _summary(row):
    return {'id': row['entry_id'], 'title': row['title'], 'revision': row['revision'], 'updatedAt': row['updated_at']}


class EntryStore:
    def __init__(self, directory):
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True)
        self.path = directory / 'notebook.sqlite3'
        with closing(self._connect()) as connection, connection:
            connection.execute('''CREATE TABLE IF NOT EXISTS revisions (
                entry_id TEXT NOT NULL,
                revision INTEGER NOT NULL,
                updated_at TEXT NOT NULL,
                title TEXT NOT NULL,
                document TEXT NOT NULL,
                PRIMARY KEY (entry_id, revision)
            )''')

    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    def list(self):
        with closing(self._connect()) as connection:
            rows = connection.execute('''SELECT entry_id, revision, title, updated_at FROM revisions
                WHERE (entry_id, revision) IN (SELECT entry_id, MAX(revision) FROM revisions GROUP BY entry_id)
                ORDER BY updated_at DESC, entry_id''')
            return [_summary(row) for row in rows]

    def history(self, identity):
        with closing(self._connect()) as connection:
            rows = connection.execute('''SELECT entry_id, revision, title, updated_at FROM revisions
                WHERE entry_id = ? ORDER BY revision DESC''', (identity,))
            result = [_summary(row) for row in rows]
            if not result:
                raise MissingEntry('Entry not found')
            return result

    def read(self, identity, revision=None):
        with closing(self._connect()) as connection:
            return self._read(connection, identity, revision)

    def _read(self, connection, identity, revision=None):
        if revision is None:
            row = connection.execute('''SELECT revision, updated_at, document FROM revisions
                WHERE entry_id = ? ORDER BY revision DESC LIMIT 1''', (identity,)).fetchone()
        else:
            row = connection.execute('''SELECT revision, updated_at, document FROM revisions
                WHERE entry_id = ? AND revision = ?''', (identity, revision)).fetchone()
        if row is None:
            raise MissingEntry('Entry or revision not found')
        value = json.loads(row['document'])
        return Entry(identity, row['revision'], row['updated_at'], NotebookDocument(value['title'], value['content']))

    def _insert(self, connection, identity, revision, document):
        updated_at = datetime.now(timezone.utc).isoformat(timespec='microseconds')
        connection.execute('INSERT INTO revisions VALUES (?, ?, ?, ?, ?)',
                           (identity, revision, updated_at, document.title, document.serialized()))
        return Entry(identity, revision, updated_at, document)

    def create(self, document):
        with closing(self._connect()) as connection, connection:
            return self._insert(connection, uuid4().hex, 1, document)

    def commit(self, identity, expected_revision, edit):
        with closing(self._connect()) as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            current = self._read(connection, identity)
            if current.revision != expected_revision:
                raise RevisionConflict(current.revision)
            return self._insert(connection, identity, current.revision + 1, edit(current.document))
