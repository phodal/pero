"""Seed-paper exploration and saved candidates; relationships are not evidence."""
from dataclasses import dataclass
import re
from urllib.parse import urlsplit

from .model import ID, Invalid, PaperSnapshot, digest, mapping, sequence, text, https

WORK = re.compile(r'W\d+')
RELATIONS = ('related', 'references', 'citing')


@dataclass(frozen=True)
class DiscoveryQuery:
    seed_id: str
    relation: str
    page: int = 1
    work_id: str | None = None

    @classmethod
    def parse(cls, value):
        value = mapping(value, 'discovery request')
        seed, relation, page, work = value.get('seedId'), value.get('relation'), value.get('page', 1), value.get('workId')
        if not isinstance(seed, str) or not ID.fullmatch(seed) or relation not in RELATIONS:
            raise Invalid('Choose a saved seed paper and discovery relation')
        if type(page) is not int or not 1 <= page <= 100:
            raise Invalid('Discovery page must be 1–100')
        if work is not None and (not isinstance(work, str) or not WORK.fullmatch(work)):
            raise Invalid('Invalid OpenAlex work reference')
        return cls(seed, relation, page, work)

    def selector(self, paper):
        if self.work_id:
            return self.work_id
        if paper.source == 'openalex' and WORK.fullmatch(paper.source_id):
            return paper.source_id
        url = urlsplit(paper.url)
        if url.hostname == 'openalex.org' and WORK.fullmatch(url.path.strip('/')):
            return url.path.strip('/')
        if url.hostname == 'doi.org' and re.fullmatch(r'/10\.\d{4,9}/[^\s]+', url.path):
            return 'https://doi.org' + url.path
        return None


@dataclass(frozen=True)
class DiscoveryPaper:
    id: str
    title: str
    url: str
    authors: tuple[str, ...]
    abstract: str
    date: str
    citations: int
    doi: str = ''

    @classmethod
    def parse(cls, value):
        value = mapping(value, 'discovery paper')
        identity = value.get('id')
        if not isinstance(identity, str) or not WORK.fullmatch(identity):
            raise Invalid('Invalid OpenAlex response identity')
        abstract = value.get('abstract', '')
        citations = value.get('citations', 0)
        if not isinstance(abstract, str) or len(abstract) > 120000 or type(citations) is not int or citations < 0:
            raise Invalid('Invalid OpenAlex abstract or citation count')
        return cls(identity, text(value.get('title'), 1000, 'paper title'), https(value.get('url')),
                   tuple(text(a, 300, 'author') for a in sequence(value.get('authors', []), 100, 'authors')),
                   abstract, str(value.get('publicationDate') or '')[:10], citations,
                   text(value['doi'], 300, 'DOI') if value.get('doi') else '')

    def to_dict(self):
        return dict(id=self.id, source='openalex', title=self.title, url=self.url, authors=list(self.authors),
                    abstract=self.abstract, publicationDate=self.date, citations=self.citations, doi=self.doi)

    def reading(self, now):
        if not self.abstract.strip():
            raise Invalid('This record has no abstract. Open the original source and import readable text before comparison.')
        return PaperSnapshot.from_reading(dict(source='openalex', sourceId=self.id, title=self.title, url=self.url,
            authors=list(self.authors), content=self.abstract, contentKind='abstract'), now)


@dataclass(frozen=True)
class SeedMatches:
    seed_id: str
    candidates: tuple[DiscoveryPaper, ...]

    def to_dict(self):
        return dict(status='choose-seed', seedId=self.seed_id, provider='openalex',
                    candidates=[p.to_dict() for p in self.candidates])


@dataclass(frozen=True)
class DiscoveryBatch:
    seed_id: str
    seed_title: str
    relation: str
    work: DiscoveryPaper
    items: tuple[DiscoveryPaper, ...]
    page: int
    has_more: bool
    fetched_at: str
    matching: str

    @property
    def id(self):
        return digest(self.document())

    def document(self):
        return dict(seedId=self.seed_id, seedTitle=self.seed_title, relation=self.relation, work=self.work.to_dict(),
                    items=[p.to_dict() for p in self.items], page=self.page, hasMore=self.has_more,
                    fetchedAt=self.fetched_at, matching=self.matching, provider='openalex')

    def to_dict(self):
        return dict(id=self.id, **self.document())

    @classmethod
    def from_record(cls, value):
        query = DiscoveryQuery.parse(value)
        result = cls(query.seed_id, text(value.get('seedTitle'), 1000, 'seed title'), query.relation,
                     DiscoveryPaper.parse(value.get('work')),
                     tuple(DiscoveryPaper.parse(p) for p in sequence(value.get('items'), 12, 'discovery results')),
                     query.page, value.get('hasMore') is True, text(value.get('fetchedAt'), 40, 'retrieval time'),
                     text(value.get('matching'), 40, 'seed matching'))
        if result.id != value.get('id'):
            raise Invalid('Stored discovery integrity check failed')
        return result

    def paper(self, work_id):
        paper = next((p for p in self.items if p.id == work_id), None)
        if paper is None:
            raise Invalid('Paper is outside this discovery result')
        return paper


@dataclass(frozen=True)
class SavedDiscovery:
    batch: DiscoveryBatch
    paper: DiscoveryPaper

    @property
    def id(self):
        return digest(self.paper.id.encode('utf-8'))

    def to_dict(self):
        return dict(id=self.id, batchId=self.batch.id, seedId=self.batch.seed_id, seedTitle=self.batch.seed_title,
                    relation=self.batch.relation, paper=self.paper.to_dict(), fetchedAt=self.batch.fetched_at)
