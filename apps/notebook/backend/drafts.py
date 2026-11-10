"""One recoverable local draft per entry, separate from immutable revisions."""
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timezone
import json

from document import NotebookDocument, fields, integer
from store import RevisionConflict
from templates import preserve_template_origins


@dataclass(frozen=True)
class Draft:
    base_revision: int
    document: NotebookDocument

    @classmethod
    def parse(cls, value):
        data = fields(value, {'baseRevision', 'document'})
        return cls(integer(data['baseRevision'], 'base revision'), NotebookDocument.parse(data['document']))


class StoredDraftError(Exception):
    def __init__(self, raw, reason):
        super().__init__(f'Stored draft cannot be read. Export recovery before discarding it: {reason}')
        self.raw = raw


class DraftStore:
    def __init__(self, entries):
        self.entries = entries
        with closing(entries._connect()) as connection, connection:
            connection.execute('''CREATE TABLE IF NOT EXISTS drafts (
                entry_id TEXT PRIMARY KEY, base_revision INTEGER NOT NULL,
                document TEXT NOT NULL, updated_at TEXT NOT NULL)''')

    def _read(self, connection, identity):
        row = connection.execute('SELECT * FROM drafts WHERE entry_id = ?', (identity,)).fetchone()
        if row is None:
            return None
        try:
            draft = Draft.parse({'baseRevision': row['base_revision'], 'document': json.loads(row['document'])})
        except (ValueError, TypeError, RecursionError) as error:
            raise StoredDraftError(row['document'], str(error)) from error
        return {'baseRevision': draft.base_revision, 'document': draft.document.wire(), 'updatedAt': row['updated_at']}

    def read(self, identity):
        with closing(self.entries._connect()) as connection:
            self.entries._read(connection, identity)
            return self._read(connection, identity)

    def save(self, identity, draft):
        with closing(self.entries._connect()) as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            current = self.entries._read(connection, identity)
            if current.revision != draft.base_revision:
                raise RevisionConflict(current.revision)
            self._read(connection, identity)  # A corrupt recovery copy must never be silently overwritten.
            preserve_template_origins(current.document.wire(), draft.document.wire())
            updated = datetime.now(timezone.utc).isoformat(timespec='microseconds')
            connection.execute('INSERT OR REPLACE INTO drafts VALUES (?, ?, ?, ?)',
                               (identity, draft.base_revision, draft.document.serialized(), updated))
            return {'baseRevision': draft.base_revision, 'updatedAt': updated}

    def discard(self, identity, base_revision):
        with closing(self.entries._connect()) as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            current = self.entries._read(connection, identity)
            if current.revision != base_revision:
                raise RevisionConflict(current.revision)
            connection.execute('DELETE FROM drafts WHERE entry_id = ?', (identity,))
