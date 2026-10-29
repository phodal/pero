"""Exact source chunks and bounded lexical retrieval contracts.

KiroCrew's local Knowledge Library informs the FTS5/token and source-locator
approach. Chunks here always slice the original text; overlap never rewrites it.
"""
from dataclasses import dataclass
from collections import Counter
import re

from .model import ID, Invalid, PaperSnapshot, PdfPassage, RetrievalSnapshot, digest, mapping, sequence, text
from .pdf import PdfDocument

METHOD = 'pero.paper-search.fts5-bm25.v1'
CHUNK_SIZE = 1600
CHUNK_OVERLAP = 160
MAX_PASSAGES = 12
MAX_CONTEXT = 19200


def terms(value: str) -> tuple[str, ...]:
    value = value.lower()
    words = re.findall(r'[^\W_\u3400-\u9fff]+|[\u3400-\u9fff]', value)
    pairs = re.findall(r'(?=([\u3400-\u9fff]{2}))', value)
    return tuple(words + pairs)


@dataclass(frozen=True)
class SearchQuery:
    query: str
    paper_ids: tuple[str, ...]
    limit: int = MAX_PASSAGES
    pdf_only: bool = False

    def __post_init__(self):
        if not terms(self.query):
            raise Invalid('Enter searchable words in the source language')

    @classmethod
    def parse(cls, value):
        value = mapping(value, 'local search')
        query = text(value.get('query'), 2000, 'local search query')
        ids = sequence(value.get('paperIds', []), 200, 'paper IDs')
        if any(not isinstance(i, str) or not ID.fullmatch(i) for i in ids) or len(set(ids)) != len(ids):
            raise Invalid('Choose distinct stored paper IDs')
        limit = value.get('limit', MAX_PASSAGES)
        if type(limit) is not int or not 1 <= limit <= 30:
            raise Invalid('Local search limit must be between 1 and 30')
        pdf_only = value.get('pdfOnly', False)
        if type(pdf_only) is not bool:
            raise Invalid('Invalid local search mode')
        return cls(query, tuple(ids), limit, pdf_only)

    @property
    def tokens(self) -> tuple[str, ...]:
        return tuple(dict.fromkeys(terms(self.query)))

    def select_sources(self, versions: tuple['SourceVersion', ...]) -> tuple['SourceVersion', ...]:
        if any(i not in {s.paper_id for s in versions} for i in self.paper_ids):
            raise Invalid('A selected paper is no longer in the source library', 404)
        latest = {}
        for source in versions:
            if source.document_id:
                previous = latest.get(source.paper_id)
                if previous is None or (source.fetched_at, source.id) > (previous.fetched_at, previous.id):
                    latest[source.paper_id] = source
        return tuple(s for s in versions if (not self.paper_ids or s.paper_id in self.paper_ids)
                     and ((s.document_id and s == latest[s.paper_id]) or (not s.document_id and not self.pdf_only)))


@dataclass(frozen=True)
class SourceVersion:
    id: str
    paper_id: str
    title: str
    url: str
    content_kind: str
    content_digest: str
    fetched_at: str
    document_id: str | None = None
    file_digest: str | None = None

    @classmethod
    def of(cls, paper: PaperSnapshot, document: PdfDocument | None = None):
        if document:
            if document.paper_id != paper.id:
                raise Invalid('PDF does not belong to this paper snapshot')
            return cls(document.id, paper.id, paper.title, document.source_url, 'full-text',
                       paper.content_digest, document.created_at, document.id, document.file_digest)
        return cls(paper.id, paper.id, paper.title, paper.url, paper.content_kind, paper.content_digest, paper.fetched_at)

    def to_dict(self):
        return dict(id=self.id, paperId=self.paper_id, title=self.title, url=self.url,
                    contentKind=self.content_kind, contentDigest=self.content_digest, fetchedAt=self.fetched_at,
                    documentId=self.document_id, fileDigest=self.file_digest)

    @classmethod
    def from_record(cls, value):
        return cls(value['id'], value['paperId'], value['title'], value['url'], value['contentKind'],
                   value['contentDigest'], value['fetchedAt'], value['documentId'], value['fileDigest'])


@dataclass(frozen=True)
class SourceChunk:
    id: str
    source: SourceVersion
    start: int
    content: str
    heading: str
    page: int | None = None

    def to_dict(self):
        return dict(id=self.id, source=self.source.to_dict(), start=self.start, end=self.start + len(self.content),
                    content=self.content, heading=self.heading, page=self.page)

    @classmethod
    def from_record(cls, value):
        return cls(value['id'], SourceVersion.from_record(value['source']), value['start'], value['content'], value['heading'], value['page'])

    def pdf_passage(self) -> PdfPassage:
        if self.page is None:
            raise Invalid('This search result is source text, not a PDF passage')
        return PdfPassage(self.id, self.source.paper_id, self.source.document_id,
                          self.source.file_digest, self.page, self.start, self.content)


def chunks(paper: PaperSnapshot, document: PdfDocument | None = None) -> tuple[SourceChunk, ...]:
    source = SourceVersion.of(paper, document)
    pages = ((p.number, p.text) for p in document.pages) if document else ((None, paper.content),)
    result = []
    for page, content in pages:
        headings = tuple(re.finditer(r'^#{1,6}\s+([^\n]+)', content, re.M)) if page is None else ()
        boundaries = sorted({0, len(content), *(m.start() for m in headings)})
        for section_start, section_end in zip(boundaries, boundaries[1:]):
            heading = next((m[1] for m in headings if m.start() == section_start), '')
            start = section_start
            while start < section_end:
                end = min(start + CHUNK_SIZE, section_end)
                if end < section_end:
                    boundary = content.rfind('\n', start + CHUNK_SIZE // 2, end)
                    if boundary > start:
                        end = boundary + 1
                passage = content[start:end]
                if passage.strip():
                    identity = (PdfPassage.create(paper.id, document.id, document.file_digest, page, start, passage).id
                                if document else digest(dict(paperId=paper.id, start=start, content=passage)))
                    result.append(SourceChunk(identity, source, start, passage, heading, page))
                if end == section_end:
                    break
                start = end - CHUNK_OVERLAP
    return tuple(result)


@dataclass(frozen=True)
class SearchHit:
    chunk: SourceChunk
    score: float

    def to_dict(self):
        return dict(**self.chunk.to_dict(), score=self.score)


@dataclass(frozen=True)
class SearchResult:
    query: SearchQuery
    hits: tuple[SearchHit, ...]
    sources: tuple[SourceVersion, ...]
    total_matches: int

    @classmethod
    def collect(cls, query: SearchQuery, sources: tuple[SourceVersion, ...], total_matches: int, candidates):
        hits, per_page, used = [], Counter(), 0
        for hit in candidates:
            chunk = hit.chunk
            key = (chunk.source.id, chunk.page)
            if chunk.page is not None and per_page[key] >= 2:
                continue
            if used + len(chunk.content) > MAX_CONTEXT:
                break
            hits.append(hit)
            used += len(chunk.content)
            per_page[key] += 1
            if len(hits) >= query.limit:
                break
        return cls(query, tuple(hits), sources, total_matches)

    @property
    def unmatched_paper_ids(self) -> tuple[str, ...]:
        matched = {hit.chunk.source.paper_id for hit in self.hits}
        return tuple(i for i in dict.fromkeys(s.paper_id for s in self.sources) if i not in matched)

    def to_dict(self):
        return dict(query=self.query.query, method=METHOD, items=[hit.to_dict() for hit in self.hits],
                    totalMatches=self.total_matches, returned=len(self.hits), truncated=len(self.hits) < self.total_matches,
                    queryTruncated=len(self.query.tokens) > 64, queryTerms=list(self.query.tokens[:64]),
                    sources=[s.to_dict() for s in self.sources], unmatchedPaperIds=list(self.unmatched_paper_ids))

    def freeze(self) -> RetrievalSnapshot:
        return RetrievalSnapshot(METHOD, tuple(s.id for s in self.sources), tuple(hit.chunk.id for hit in self.hits),
            self.total_matches, self.unmatched_paper_ids, self.query.tokens[:64], len(self.query.tokens) > 64)
