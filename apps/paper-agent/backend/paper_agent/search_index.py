"""Rebuildable App-local FTS5 index. Immutable JSON documents own source truth."""
import json
import sqlite3

from .model import Invalid, canonical
from .retrieval import SearchHit, SearchQuery, SearchResult, SourceChunk, SourceVersion


class SearchIndex:
    def __init__(self, path):
        self.path = path

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path)
        self.db.row_factory = sqlite3.Row
        try:
            self.db.executescript('''
                CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS chunks(id TEXT PRIMARY KEY, source_id TEXT NOT NULL,
                    paper_id TEXT NOT NULL, page INTEGER, data TEXT NOT NULL, tokens TEXT NOT NULL);
                CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(tokens,
                    content='chunks', content_rowid='rowid');
                PRAGMA user_version = 1;
            ''')
        except sqlite3.Error as error:
            self.db.close()
            if 'no such module: fts5' in str(error):
                raise Invalid('Local search requires SQLite FTS5. Use a Python build with FTS5 enabled.', 503) from error
            raise
        return self

    def __exit__(self, *_args):
        self.db.close()

    def sources(self) -> tuple[SourceVersion, ...]:
        return tuple(SourceVersion.from_record(json.loads(row[0])) for row in self.db.execute('SELECT data FROM sources ORDER BY id'))

    def replace(self, source: SourceVersion, passages: tuple[SourceChunk, ...]):
        from .retrieval import terms
        with self.db:
            self._remove(source.id)
            self.db.execute('INSERT INTO sources VALUES (?, ?)', (source.id, canonical(source.to_dict()).decode()))
            for passage in passages:
                tokens = ' '.join(terms(passage.content))
                if passage.page is None and passage.start == 0:
                    tokens += ' ' + ' '.join(terms(source.title))
                cursor = self.db.execute('INSERT INTO chunks VALUES (?, ?, ?, ?, ?, ?)',
                    (passage.id, source.id, source.paper_id, passage.page, canonical(passage.to_dict()).decode(), tokens))
                self.db.execute('INSERT INTO chunks_fts(rowid, tokens) VALUES (?, ?)', (cursor.lastrowid, tokens))

    def _remove(self, identity):
        self.db.execute('INSERT INTO chunks_fts(chunks_fts, rowid, tokens) SELECT \'delete\', rowid, tokens FROM chunks WHERE source_id = ?', (identity,))
        self.db.execute('DELETE FROM chunks WHERE source_id = ?', (identity,))
        self.db.execute('DELETE FROM sources WHERE id = ?', (identity,))

    def retain(self, ids: set[str]):
        with self.db:
            for source in self.sources():
                if source.id not in ids:
                    self._remove(source.id)

    def search(self, query: SearchQuery) -> SearchResult:
        # Old PDF revisions remain addressable for frozen evidence.
        sources = query.select_sources(self.sources())
        if not sources:
            return SearchResult(query, (), (), 0)
        # Only quoted normalized words enter MATCH; punctuation is never FTS syntax.
        match = ' OR '.join('"' + token + '"' for token in query.tokens[:64])
        params = (match, *(s.id for s in sources))
        where = 'chunks_fts MATCH ? AND c.source_id IN (' + ','.join('?' for _ in sources) + ')'
        total = self.db.execute('SELECT count(*) FROM chunks_fts JOIN chunks c ON c.rowid = chunks_fts.rowid WHERE ' + where, params).fetchone()[0]
        rows = self.db.execute('SELECT c.data, bm25(chunks_fts) AS rank FROM chunks_fts JOIN chunks c ON c.rowid = chunks_fts.rowid WHERE '
                               + where + ' ORDER BY rank, c.id', params)
        candidates = (SearchHit(SourceChunk.from_record(json.loads(row['data'])), -row['rank']) for row in rows)
        return SearchResult.collect(query, sources, total, candidates)
