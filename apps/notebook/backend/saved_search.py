"""Named, revisioned queries over real local Notebook entry heads."""
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import sqlite3
from uuid import uuid4

from document import block_id, fields, integer, string
from store import RevisionConflict


class MissingSavedSearch(Exception):
    pass


@dataclass(frozen=True)
class NotebookQuery:
    title: str
    text: str
    tags: tuple[str, ...]
    sort: str

    @classmethod
    def parse(cls, value):
        fields(value, {'scope', 'title', 'text', 'tags', 'sort'})
        if value['scope'] != 'entries' or value['sort'] not in ('updated-desc', 'title-asc'):
            raise ValueError('Unsupported Notebook query scope or sort')
        title = string(value['title'], 'query title', 200)
        text = string(value['text'], 'query text', 500)
        tags = value['tags']
        if not isinstance(tags, list) or len(tags) > 50:
            raise ValueError('Invalid query tags')
        tags = tuple(string(tag, 'query tag', 100, required=True) for tag in tags)
        if len(set(tag.casefold() for tag in tags)) != len(tags):
            raise ValueError('Duplicate query tags')
        return cls(title, text, tags, value['sort'])

    def wire(self):
        return dict(scope='entries', title=self.title, text=self.text, tags=list(self.tags), sort=self.sort)

    def matches(self, title, text, tags):
        return (self.title.casefold() in title.casefold()
                and all(term in text.casefold() for term in self.text.casefold().split())
                and {tag.casefold() for tag in self.tags} <= {tag.casefold() for tag in tags})


@dataclass(frozen=True)
class SavedSearchDefinition:
    name: str
    query: NotebookQuery

    @classmethod
    def parse(cls, value):
        fields(value, {'name', 'query'})
        return cls(string(value['name'], 'saved search name', 200, required=True), NotebookQuery.parse(value['query']))


def entry_search_text(document):
    """Only recorded user-facing fields; never base64 attachments or embedded snapshots."""
    values = [document.title]
    for node in document.nodes():
        if isinstance(node.get('text'), str):
            values.append(node['text'])
        attrs = node.get('attrs', {})
        for key in ('label', 'claim', 'limitations', 'caption', 'filename', 'date'):
            if isinstance(attrs.get(key), str):
                values.append(attrs[key])
        if node['type'] == 'spreadsheet':
            values.extend(attrs['sheet']['cells'].values())
        if node['type'] in ('inputTable', 'registrationTable'):
            table = attrs['table']
            values.append(table['name'])
            values.extend(column['name'] for column in table['schema']['columns'])
            for row in table['rows']:
                values.extend(row['cells'].values())
    if document.metadata is not None:
        values.extend([document.metadata.project, document.metadata.author, *document.metadata.tags])
    for procedure in document.procedures or ():
        value = procedure.wire()
        values.append(value['title'])
        if procedure.introduction is None:
            values.append(value['description'])
        values.extend(step['text'] for step in value['steps'] if 'content' not in step)
        for root in procedure.materials:
            for material in root.descendants():
                values.extend([material.name, material.quantity])
                if material.source:
                    values.extend([material.source.catalog_id, material.source.record_id, material.source.schema_id])
    return ' '.join(values)


def parse_saved_search_attributes(value):
    fields(value, {'blockId', 'label', 'queryId', 'queryRevision', 'mode', 'snapshot'}, {'templateOrigin'})
    block_id(value['blockId'])
    block_id(value['queryId'])
    integer(value['queryRevision'], 'query revision')
    string(value['label'], 'saved search label', 200)
    if value['mode'] not in ('live', 'snapshot'):
        raise ValueError('Invalid saved search mode')
    snapshot = value['snapshot']
    if value['mode'] == 'live':
        if snapshot is not None:
            raise ValueError('Live query must not persist a misleading fixed projection')
        return value
    fields(snapshot, {'queryId', 'queryRevision', 'results', 'refreshedAt'})
    if snapshot['queryId'] != value['queryId'] or snapshot['queryRevision'] != value['queryRevision']:
        raise ValueError('Snapshot does not match the saved query revision')
    _timestamp(snapshot['refreshedAt'])
    results = snapshot['results']
    if not isinstance(results, list) or len(results) > 200:
        raise ValueError('Invalid search snapshot results')
    seen = set()
    for result in results:
        fields(result, {'entryId', 'revision', 'title', 'summary', 'tags', 'updatedAt'})
        identity = block_id(result['entryId'])
        if identity in seen:
            raise ValueError('Duplicate query result')
        seen.add(identity)
        integer(result['revision'], 'result revision')
        string(result['title'], 'result title', 200, required=True)
        string(result['summary'], 'result summary', 500)
        _timestamp(result['updatedAt'])
        tags = result['tags']
        if not isinstance(tags, list) or len(tags) > 50:
            raise ValueError('Invalid result tags')
        for tag in tags:
            string(tag, 'result tag', 100, required=True)
    return value


def _timestamp(value):
    string(value, 'timestamp', 64, required=True)
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            raise ValueError('Timestamp requires timezone')
    except ValueError as error:
        raise ValueError('Invalid search timestamp') from error


class SavedSearchStore:
    def __init__(self, entries):
        self.entries = entries
        self.path = entries.path
        with closing(self._connect()) as connection, connection:
            connection.execute('''CREATE TABLE IF NOT EXISTS notebook_saved_searches (
                query_id TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL,
                name TEXT NOT NULL, query TEXT NOT NULL, PRIMARY KEY(query_id, revision))''')

    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _wire(row):
        return dict(id=row['query_id'], revision=row['revision'], name=row['name'], query=json.loads(row['query']), updatedAt=row['updated_at'])

    def list(self):
        with closing(self._connect()) as connection:
            rows = connection.execute('''SELECT * FROM notebook_saved_searches WHERE (query_id,revision) IN
                (SELECT query_id,MAX(revision) FROM notebook_saved_searches GROUP BY query_id)
                ORDER BY updated_at DESC,query_id''')
            return [self._wire(row) for row in rows]

    def read(self, identity, revision=None):
        with closing(self._connect()) as connection:
            return self._read(connection, identity, revision)

    def _read(self, connection, identity, revision=None):
        row = connection.execute('''SELECT * FROM notebook_saved_searches
            WHERE query_id=? AND (? IS NULL OR revision=?) ORDER BY revision DESC LIMIT 1''', (identity, revision, revision)).fetchone()
        if row is None:
            raise MissingSavedSearch('Saved query or revision not found')
        return self._wire(row)

    def save(self, definition, identity=None, expected_revision=None):
        with closing(self._connect()) as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            revision = 1
            if identity is not None:
                current = self._read(connection, identity)
                if current['revision'] != expected_revision:
                    raise RevisionConflict(current['revision'])
                revision = current['revision'] + 1
            else:
                identity = uuid4().hex
            updated = datetime.now(timezone.utc).isoformat(timespec='microseconds')
            connection.execute('INSERT INTO notebook_saved_searches VALUES (?,?,?,?,?)',
                               (identity, revision, updated, definition.name, json.dumps(definition.query.wire(), ensure_ascii=False)))
            return self._read(connection, identity, revision)

    def run(self, identity, revision):
        saved = self.read(identity, revision)
        query = NotebookQuery.parse(saved['query'])
        results = []
        # One database read transaction gives a consistent head set and projection.
        with closing(self._connect()) as connection:
            connection.execute('BEGIN')
            heads = connection.execute('''SELECT entry_id,MAX(revision) AS revision FROM revisions GROUP BY entry_id''').fetchall()
            for head in heads:
                entry = self.entries._read(connection, head['entry_id'], head['revision'])
                text = entry_search_text(entry.document)
                tags = list(entry.document.metadata.tags) if entry.document.metadata is not None else []
                if query.matches(entry.document.title, text, tags):
                    results.append(dict(entryId=entry.identity, revision=entry.revision, title=entry.document.title,
                                        summary=text[:500], tags=tags, updatedAt=entry.updated_at))
        results.sort(key=(lambda row: (row['title'].casefold(), row['entryId'])) if query.sort == 'title-asc'
                     else (lambda row: (row['updatedAt'], row['entryId'])), reverse=query.sort == 'updated-desc')
        if len(results) > 200:
            raise ValueError('More than 200 matches. Narrow this saved query before displaying or freezing it.')
        return dict(queryId=identity, queryRevision=revision, results=results,
                    refreshedAt=datetime.now(timezone.utc).isoformat(timespec='microseconds'))
