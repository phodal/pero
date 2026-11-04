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

    @property
    def has_selectable_text(self):
        return any(page.text.strip() for page in self.pages)

    @classmethod
    def create(cls, paper_id, file_digest, source_url, pages, now):
        identity = digest(dict(paperId=paper_id, fileDigest=file_digest))
        return cls(identity, paper_id, file_digest, source_url, pages, now)

    @classmethod
    def from_record(cls, value):
        from .source_text import SourceText
        return cls(value['id'], value['paperId'], value['fileDigest'], value['sourceUrl'],
                   tuple(PdfPage(page['number'], page['width'], page['height'], SourceText.from_lines(page['lines']).content if 'lines' in page else page['text']) for page in value['pages']), value['createdAt'])

    def page(self, number):
        if type(number) is not int or not 1 <= number <= len(self.pages):
            raise Invalid('Page is outside this PDF')
        return self.pages[number - 1]

    def matching_pages(self, quote):
        return tuple(page.number for page in self.pages if page.contains_quote(quote))

    def to_record(self):
        from .source_text import SourceText
        value = self.to_dict()
        for page in value['pages']:
            page['lines'] = list(SourceText(page.pop('text')).lines)
        return value

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
class PdfAnchor:
    """A version-bound selected region, independent of notes or discussion text."""
    document_id: str
    file_digest: str
    page: int
    rects: tuple[PdfRect, ...]

    @classmethod
    def parse(cls, value):
        from .model import ID
        value = mapping(value, 'PDF anchor')
        if any(not isinstance(value.get(k), str) or not ID.fullmatch(value[k]) for k in ('documentId', 'fileDigest')):
            raise Invalid('Choose a fixed PDF version for the anchor')
        if type(value.get('page')) is not int or value['page'] < 1:
            raise Invalid('Choose a PDF page for the anchor')
        rects = tuple(PdfRect.parse(r) for r in sequence(value['rects'], 100, 'PDF regions')) if 'rects' in value else ()
        if 'rects' in value and not rects:
            raise Invalid('Select a PDF region first')
        return cls(value['documentId'], value['fileDigest'], value['page'], rects)

    def check(self, document, quote=''):
        if self.document_id != document.id or self.file_digest != document.file_digest:
            raise Invalid('Anchor PDF version does not match the saved original', 409)
        page = document.page(self.page)
        if quote and not page.contains_quote(quote):
            raise Invalid('Selected text does not match this PDF page')
        return self

    def to_dict(self):
        location = dict(documentId=self.document_id, fileDigest=self.file_digest,
                        page=self.page, **(dict(rects=[{k: float(v) for k, v in r.to_dict().items()} for r in self.rects]) if self.rects else {}))
        return dict(id=digest(location), **location, verification='pdf-region' if self.rects else 'page-only')


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
    anchor: PdfAnchor | None = None

    @classmethod
    def create(cls, value, document, now):
        value = mapping(value, 'PDF annotation')
        kind = value.get('kind')
        if kind not in ('highlight', 'figure'):
            raise Invalid('Choose highlight or figure')
        quote = value.get('quote', '')
        if not isinstance(quote, str) or len(quote) > 4000:
            raise Invalid('PDF quotation exceeds 4,000 characters')
        if kind == 'highlight':
            text(quote, 4000, 'PDF quotation')
        note = value.get('note', '')
        if not isinstance(note, str) or len(note) > 4000:
            raise Invalid('PDF note exceeds 4,000 characters')
        anchor = PdfAnchor.parse(dict(documentId=document.id, fileDigest=value.get('fileDigest', document.file_digest),
                                      page=value.get('page'), rects=value.get('rects'))).check(document, quote if kind == 'highlight' else '')
        if kind == 'figure' and len(anchor.rects) != 1:
            raise Invalid('Select a PDF region first')
        content = dict(documentId=document.id, paperId=document.paper_id, page=anchor.page, kind=kind,
                       rects=[rect.to_dict() for rect in anchor.rects], quote=quote, note=note)
        return cls(digest(content), document.id, document.paper_id, anchor.page, kind, anchor.rects, quote, note, now, anchor)

    @classmethod
    def from_record(cls, value):
        return cls(value['id'], value['documentId'], value['paperId'], value['page'], value['kind'],
                   tuple(PdfRect(**rect) for rect in value['rects']), value['quote'], value['note'], value['createdAt'],
                   PdfAnchor.parse(value['anchor']) if value.get('anchor') else None)

    def to_dict(self):
        return dict(id=self.id, documentId=self.document_id, paperId=self.paper_id, page=self.page,
                    kind=self.kind, rects=[rect.to_dict() for rect in self.rects], quote=self.quote,
                    note=self.note, createdAt=self.created_at,
                    verification='page-text-match' if self.kind == 'highlight' else 'pdf-region',
                    **(dict(anchor=self.anchor.to_dict()) if self.anchor else {}))
