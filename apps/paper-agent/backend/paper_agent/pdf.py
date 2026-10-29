"""PDF versions and anchors in unrotated page space, with a top-left origin."""
from dataclasses import dataclass
import math
import re

from .model import Invalid, digest, mapping, sequence, text


@dataclass(frozen=True)
class PdfPage:
    number: int
    width: float
    height: float
    text: str

    def contains_quote(self, quote):
        compact = re.sub(r'\s+', '', quote)
        return bool(compact and compact in re.sub(r'\s+', '', self.text))

    def to_dict(self):
        return dict(number=self.number, width=self.width, height=self.height, text=self.text)


@dataclass(frozen=True)
class PdfDocument:
    id: str
    paper_id: str
    file_digest: str
    source_url: str
    pages: tuple[PdfPage, ...]
    created_at: str

    @classmethod
    def create(cls, paper_id, file_digest, source_url, pages, now):
        identity = digest(dict(paperId=paper_id, fileDigest=file_digest))
        return cls(identity, paper_id, file_digest, source_url, pages, now)

    @classmethod
    def from_record(cls, value):
        return cls(value['id'], value['paperId'], value['fileDigest'], value['sourceUrl'],
                   tuple(PdfPage(**page) for page in value['pages']), value['createdAt'])

    def page(self, number):
        if type(number) is not int or not 1 <= number <= len(self.pages):
            raise Invalid('Page is outside this PDF')
        return self.pages[number - 1]

    def matching_pages(self, quote):
        return tuple(page.number for page in self.pages if page.contains_quote(quote))

    def to_dict(self):
        return dict(id=self.id, paperId=self.paper_id, fileDigest=self.file_digest,
                    sourceUrl=self.source_url, coordinateSpace='unrotated-top-left',
                    pages=[page.to_dict() for page in self.pages], createdAt=self.created_at)


@dataclass(frozen=True)
class PdfRect:
    x: float
    y: float
    width: float
    height: float

    @classmethod
    def parse(cls, value):
        value = mapping(value, 'PDF region')
        numbers = tuple(value.get(key) for key in ('x', 'y', 'width', 'height'))
        if any(type(n) not in (int, float) or not math.isfinite(n) for n in numbers):
            raise Invalid('Invalid PDF region')
        x, y, width, height = numbers
        if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > 1.00001 or y + height > 1.00001:
            raise Invalid('PDF region must be inside the page')
        return cls(x, y, width, height)

    def to_dict(self):
        return dict(x=self.x, y=self.y, width=self.width, height=self.height)


@dataclass(frozen=True)
class PdfAnnotation:
    id: str
    document_id: str
    paper_id: str
    page: int
    kind: str
    rects: tuple[PdfRect, ...]
    quote: str
    note: str
    created_at: str

    @classmethod
    def create(cls, value, document, now):
        value = mapping(value, 'PDF annotation')
        page = document.page(value.get('page'))
        kind = value.get('kind')
        if kind not in ('highlight', 'figure'):
            raise Invalid('Choose highlight or figure')
        rects = tuple(PdfRect.parse(rect) for rect in sequence(value.get('rects'), 100, 'PDF regions'))
        if not rects or (kind == 'figure' and len(rects) != 1):
            raise Invalid('Select a PDF region first')
        quote = value.get('quote', '')
        if not isinstance(quote, str) or len(quote) > 4000:
            raise Invalid('PDF quotation exceeds 4,000 characters')
        if kind == 'highlight':
            text(quote, 4000, 'PDF quotation')
            if not page.contains_quote(quote):
                raise Invalid('Selected text does not match this PDF page')
        note = value.get('note', '')
        if not isinstance(note, str) or len(note) > 4000:
            raise Invalid('PDF note exceeds 4,000 characters')
        content = dict(documentId=document.id, paperId=document.paper_id, page=page.number, kind=kind,
                       rects=[rect.to_dict() for rect in rects], quote=quote, note=note)
        return cls(digest(content), document.id, document.paper_id, page.number, kind, rects, quote, note, now)

    @classmethod
    def from_record(cls, value):
        return cls(value['id'], value['documentId'], value['paperId'], value['page'], value['kind'],
                   tuple(PdfRect(**rect) for rect in value['rects']), value['quote'], value['note'], value['createdAt'])

    def to_dict(self):
        return dict(id=self.id, documentId=self.document_id, paperId=self.paper_id, page=self.page,
                    kind=self.kind, rects=[rect.to_dict() for rect in self.rects], quote=self.quote,
                    note=self.note, createdAt=self.created_at,
                    verification='page-text-match' if self.kind == 'highlight' else 'pdf-region')
