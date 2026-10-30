"""Rebuildable App-local FTS5 index. Immutable JSON documents own source truth.

Keyword ranking stays in this index. Vector ranking and fusion live in app-infra.
"""
import json
import sqlite3

from app_infra.rag import fuse_hits, pack_vector, passage_input, query_input, unpack_vector, vector_ranks

from .model import Invalid, canonical
from .retrieval import HYBRID_METHOD, SearchHit, SearchQuery, SearchResult, SourceChunk, SourceVersion


class SearchIndex:
    def __init__(self, path, embedder=None):
        self.path = path
        self.embedder = embedder

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path)
        self.db.row_factory = sqlite3.Row
        try:
            self.db.executescript('''
                CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS chunks(id TEXT PRIMARY KEY, source_id TEXT NOT NULL,
                    paper_id TEXT NOT NULL, page INTEGER, data TEXT NOT NULL, tokens TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS embeddings(chunk_id TEXT PRIMARY KEY, sig TEXT NOT NULL,
                    dim INTEGER NOT NULL, vector BLOB NOT NULL);
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
            self._embed((source.id,))

    def _remove(self, identity):
        self.db.execute('DELETE FROM embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE source_id = ?)', (identity,))
        self.db.execute('INSERT INTO chunks_fts(chunks_fts, rowid, tokens) SELECT \'delete\', rowid, tokens FROM chunks WHERE source_id = ?', (identity,))
        self.db.execute('DELETE FROM chunks WHERE source_id = ?', (identity,))
        self.db.execute('DELETE FROM sources WHERE id = ?', (identity,))

    def _embed(self, source_ids, signature=None):
        embedder = self.embedder
        if embedder is None or not source_ids:
            return
        for source_id in source_ids:
            if signature:
                rows = self.db.execute('SELECT c.id, c.data FROM chunks c LEFT JOIN embeddings e ON e.chunk_id = c.id AND e.sig = ? '
                                       'WHERE c.source_id = ? AND e.chunk_id IS NULL', (signature, source_id))
            else:
                rows = self.db.execute('SELECT c.id, c.data FROM chunks c LEFT JOIN embeddings e ON e.chunk_id = c.id '
                                       'WHERE c.source_id = ? AND e.chunk_id IS NULL', (source_id,))
            for row in rows:
                chunk = SourceChunk.from_record(json.loads(row['data']))
                vector = embedder.embed(passage_input(chunk.source.title, chunk.content))
                signature = embedder.signature if vector else signature
                if not vector or not signature:
                    continue
                self.db.execute('INSERT OR REPLACE INTO embeddings VALUES (?, ?, ?, ?)',
                                (chunk.id, signature, len(vector), pack_vector(vector)))

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
        lexical = [SearchHit(SourceChunk.from_record(json.loads(row['data'])), -row['rank']) for row in rows]
        fused = self._fuse(query, sources, lexical)
        if fused is None:
            return SearchResult.collect(query, sources, total, lexical)
        return SearchResult.collect(query, sources, len(fused), fused, HYBRID_METHOD)

    def _fuse(self, query, sources, lexical):
        embedder = self.embedder
        if embedder is None:
            return None
        query_vector = embedder.embed(query_input(query.query))
        signature = embedder.signature if query_vector else None
        if not query_vector or not signature:
            return None
        source_ids = tuple(source.id for source in sources)
        with self.db:
            self._embed(source_ids, signature)
            stored = self.db.execute('SELECT c.id, c.data, e.vector FROM chunks c JOIN embeddings e ON e.chunk_id = c.id '
                                     'WHERE e.sig = ? AND c.source_id IN (' + ','.join('?' for _ in source_ids) + ')',
                                     (signature, *source_ids))
        chunks = {}
        vectors = []
        for row in stored:
            chunk = SourceChunk.from_record(json.loads(row['data']))
            chunks[chunk.id] = chunk
            vectors.append((chunk.id, unpack_vector(row['vector'])))
        ranked = vector_ranks(query_vector, vectors)
        fused = fuse_hits([hit.chunk.id for hit in lexical], ranked)
        if not fused:
            return None
        lexical_chunks = {hit.chunk.id: hit.chunk for hit in lexical}
        return [SearchHit(lexical_chunks.get(identity) or chunks[identity], score) for identity, score in fused if identity in lexical_chunks or identity in chunks]
