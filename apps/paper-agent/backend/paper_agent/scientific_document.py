"""Immutable scientific document values; no IO, model calls or PDF evidence.

HTML text is a normalized extraction, not an exact PDF passage. A document ID
binds source bytes, parser version and the extracted structure, never a clock.
"""
from dataclasses import asdict, dataclass
from hashlib import sha256
import json
import re
from urllib.parse import urlsplit

SCHEMA = 'pero.scientific-document.v1'
PARSER = 'pero.arxiv-latexml.v1'
ARXIV_ID = re.compile(r'(?:\d{4}\.\d{4,5}|[a-z][a-z.\-]*/\d{7})(?:v[1-9]\d*)?')
PINNED_ID = re.compile(r'(.+?)v([1-9]\d*)')


class DocumentError(ValueError):
    def __init__(self, detail, code='document_invalid', status=422):
        super().__init__(detail)
        self.detail, self.code, self.status = detail, code, status


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(',', ':'), allow_nan=False).encode('utf-8')


@dataclass(frozen=True)
class ParseLimits:
    max_bytes: int = 8 * 1024 * 1024
    max_nodes: int = 100_000
    max_depth: int = 100
    max_blocks: int = 20_000
    max_text: int = 2_000_000
    max_table_slots: int = 100_000


@dataclass(frozen=True)
class DocumentSource:
    url: str
    arxiv_id: str
    digest: str
    byte_length: int

    @classmethod
    def of(cls, url, data):
        try:
            parsed = urlsplit(url)
        except ValueError as error:
            raise DocumentError('Invalid arXiv source URL') from error
        identity = parsed.path.removeprefix('/html/')
        if (parsed.scheme != 'https' or parsed.netloc != 'arxiv.org'
                or not parsed.path.startswith('/html/') or parsed.query or parsed.fragment
                or not ARXIV_ID.fullmatch(identity) or not PINNED_ID.fullmatch(identity)):
            raise DocumentError('Use an explicit version at https://arxiv.org/html/<id>vN')
        return cls(url, identity, sha256(data).hexdigest(), len(data))


@dataclass(frozen=True)
class Inline:
    kind: str
    text: str
    latex: str = ''
    mathml: str = ''
    target: str = ''
    url: str = ''


@dataclass(frozen=True)
class TableCell:
    row: int
    column: int
    row_span: int
    column_span: int
    header: bool
    content: tuple[Inline, ...]

    @property
    def text(self):
        return ''.join(item.text for item in self.content)


@dataclass(frozen=True)
class ImageReference:
    url: str
    alt: str


@dataclass(frozen=True)
class PaperBlock:
    id: str
    kind: str
    content: tuple[Inline, ...]
    anchors: tuple[str, ...] = ()
    section_id: str = ''
    level: int = 0
    cells: tuple[TableCell, ...] = ()
    images: tuple[ImageReference, ...] = ()

    @property
    def text(self):
        result = ''.join(item.text for item in self.content)
        if self.cells:
            rows = {}
            for cell in self.cells:
                rows.setdefault(cell.row, []).append(cell.text)
            result += '\n' + '\n'.join('\t'.join(row) for row in rows.values())
        return result


@dataclass(frozen=True)
class ScientificDocument:
    paper_id: str
    source: DocumentSource
    blocks: tuple[PaperBlock, ...]
    warnings: tuple[str, ...]
    parser: str = PARSER

    @property
    def id(self):
        return sha256(encoded(self.payload())).hexdigest()

    @property
    def title(self):
        return next((block.text for block in self.blocks if block.kind == 'title'), 'Paper')

    def payload(self):
        return dict(schema=SCHEMA, paperId=self.paper_id, source=asdict(self.source),
                    parser=self.parser, blocks=[asdict(block) for block in self.blocks],
                    warnings=list(self.warnings), textKind='normalized-html',
                    pdfAlignment='unavailable', scientificAcceptance='unverified')

    def to_dict(self):
        return dict(id=self.id, **self.payload())

    @classmethod
    def from_record(cls, record):
        value = {key: item for key, item in record.items() if key != 'id'}
        if (record.get('schema') != SCHEMA
                or sha256(encoded(value)).hexdigest() != record.get('id')):
            raise DocumentError('Stored scientific document integrity check failed')
        try:
            blocks = tuple(PaperBlock(
                block['id'], block['kind'], tuple(Inline(**v) for v in block['content']),
                tuple(block['anchors']), block['section_id'], block['level'],
                tuple(TableCell(cell['row'], cell['column'], cell['row_span'],
                                cell['column_span'], cell['header'],
                                tuple(Inline(**v) for v in cell['content'])) for cell in block['cells']),
                tuple(ImageReference(**v) for v in block['images'])) for block in record['blocks'])
            document = cls(record['paperId'], DocumentSource(**record['source']), blocks,
                           tuple(record['warnings']), record['parser'])
        except (KeyError, TypeError) as error:
            raise DocumentError('Stored scientific document schema is invalid') from error
        if document.id != record['id']:
            raise DocumentError('Stored scientific document contract changed')
        return document

    def outline(self):
        return tuple(dict(id=b.id, title=b.text, level=b.level, sectionId=b.section_id)
                     for b in self.blocks if b.kind == 'heading')

    def read(self, block_id, start=0, limit=4800):
        block = next((b for b in self.blocks if b.id == block_id), None)
        if block is None:
            raise DocumentError('Block is outside this document', status=404)
        if (type(start) is not int or type(limit) is not int or start < 0
                or start > len(block.text) or not 1 <= limit <= 4800):
            raise DocumentError('Choose a valid character offset and limit from 1 to 4800')
        end = min(start + limit, len(block.text))
        return dict(documentId=self.id, blockId=block.id, kind=block.kind,
                    content=block.text[start:end], start=start, end=end,
                    totalLength=len(block.text), nextStart=end if end < len(block.text) else None,
                    source=dict(url=self.source.url, digest=self.source.digest,
                                anchors=list(block.anchors)),
                    textKind='normalized-html', pdfAlignment='unavailable',
                    evidenceAdmission='not-observed-in-study')
