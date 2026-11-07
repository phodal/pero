"""Retrieval outcomes retain failures, seed choices and continuation cursors."""
from dataclasses import dataclass
from .discovery import DiscoveryPaper
from .model import Invalid, mapping, sequence


@dataclass(frozen=True)
class RetrievalDiagnostic:
    source: str
    detail: str


@dataclass(frozen=True)
class ResearchLookupOutcome:
    status: str
    errors: tuple[RetrievalDiagnostic, ...]
    warnings: tuple[RetrievalDiagnostic, ...]
    candidates: tuple[DiscoveryPaper, ...]
    page: int | None
    hasMore: bool

    @classmethod
    def parse(cls, value):
        value = mapping(value, 'retrieval result')
        status = value.get('status', 'complete')
        if status not in ('complete', 'partial', 'failed', 'choose-seed'):
            raise Invalid('Unsupported retrieval status')
        diagnostics = []
        for key, field in (('errors', 'error'), ('warnings', 'message')):
            items = [mapping(item, 'retrieval diagnostic') for item in sequence(value.get(key, []), 16, key)]
            diagnostics.append(tuple(RetrievalDiagnostic(str(item.get('source', 'provider'))[:80], str(item.get(field, ''))[:2000]) for item in items))
        page = value.get('page')
        if page is not None and (type(page) is not int or not 1 <= page <= 100):
            raise Invalid('Unsupported retrieval page')
        return cls(status, *diagnostics, tuple(DiscoveryPaper.parse(item) for item in sequence(value.get('candidates', []), 5, 'seed choices')),
                   page, value.get('hasMore') is True)

    def to_dict(self):
        return dict(status=self.status, errors=[dict(source=d.source, error=d.detail) for d in self.errors],
                    warnings=[dict(source=d.source, message=d.detail) for d in self.warnings],
                    candidates=[{**p.to_dict(), 'abstract': p.abstract[:4000]} for p in self.candidates], page=self.page, hasMore=self.hasMore)
