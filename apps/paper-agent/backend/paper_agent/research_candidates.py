"""Observed bibliographic identities and screening; relationship is not evidence."""
from dataclasses import asdict, dataclass, replace
from urllib.parse import urlsplit
import re

from .model import Invalid, digest, text


@dataclass(frozen=True)
class DiscoveryPath:
    batchId: str
    seedId: str
    relation: str


@dataclass(frozen=True)
class ResearchCandidate:
    id: str
    title: str
    url: str
    source: str
    sourceId: str
    abstract: str
    authors: tuple[str, ...]
    aliases: tuple[str, ...]
    discoveries: tuple[DiscoveryPath, ...]
    pdfUrl: str | None = None
    paperId: str | None = None
    decision: str = 'pending'
    reason: str = ''
    documentId: str | None = None
    blocker: str | None = None
    htmlDocumentId: str | None = None
    officialHtmlUrl: str | None = None

    @classmethod
    def observed(cls, value, path):
        source = text(value.get('source', 'openalex'), 80, 'provider')
        source_id = text(value.get('id'), 300, 'provider identity')
        aliases = [source + ':' + source_id]
        doi = value.get('doi')
        if doi:
            normalized = doi.lower().removeprefix('https://doi.org/').removeprefix('http://doi.org/')
            if normalized.startswith('10.'):
                aliases.append('doi:' + normalized)
        url = value.get('url') or value.get('paperUrl') or ''
        pdf_url, html_url, version = value.get('pdfUrl'), None, ''
        if source in ('alphaxiv', 'huggingface') or urlsplit(url).hostname in ('arxiv.org', 'www.arxiv.org', 'alphaxiv.org', 'www.alphaxiv.org'):
            from .literature import PaperIdentity
            identity = PaperIdentity.parse(dict(id=url or source_id))
            aliases.append('arxiv:' + identity.id)
            pdf_url = pdf_url or 'https://arxiv.org/pdf/' + identity.id
            if re.search(r'v[1-9]\d*$', identity.id):
                version = identity.id
                html_url = 'https://arxiv.org/html/' + identity.id
        return cls(digest((aliases[0] + version).encode()), text(value.get('title'), 1000, 'candidate title'), url,
                   source, source_id, str(value.get('abstract') or '')[:24000], tuple(value.get('authors') or ()),
                   tuple(aliases), (path,), pdf_url, officialHtmlUrl=html_url)

    @classmethod
    def seed(cls, paper):
        item = cls.observed(dict(id=paper.source_id, source=paper.source, title=paper.title, url=paper.url,
                                abstract=paper.content if paper.content_kind == 'abstract' else '',
                                authors=paper.authors, pdfUrl=paper.pdf_url), DiscoveryPath(paper.id, paper.id, 'seed'))
        return replace(item, paperId=paper.id, decision='include', reason='User-selected seed')

    def merge(self, other):
        return replace(self, aliases=tuple(dict.fromkeys((*self.aliases, *other.aliases))),
                       discoveries=tuple(dict.fromkeys((*self.discoveries, *other.discoveries))),
                       pdfUrl=self.pdfUrl or other.pdfUrl, officialHtmlUrl=self.officialHtmlUrl or other.officialHtmlUrl)

    def matches(self, other):
        versions = [{alias for alias in item.aliases if alias.startswith('arxiv:') and re.search(r'v[1-9]\d*$', alias)} for item in (self, other)]
        return bool(set(self.aliases).intersection(other.aliases)) and not (all(versions) and versions[0] != versions[1])

    def screen(self, decision, reason):
        if decision not in ('include', 'exclude', 'pending'):
            raise Invalid('Choose include, exclude or pending')
        return replace(self, decision=decision, reason=text(reason, 2000, 'screening reason'))

    def to_dict(self):
        return {**asdict(self), 'authors': list(self.authors), 'aliases': list(self.aliases),
                'discoveries': [asdict(p) for p in self.discoveries]}

    @classmethod
    def restore(cls, value):
        return cls(**{**value, 'authors': tuple(value['authors']), 'aliases': tuple(value['aliases']),
                      'discoveries': tuple(DiscoveryPath(**p) for p in value['discoveries'])})
