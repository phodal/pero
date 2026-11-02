"""Immutable scientific content and bounded typed reads; never PDF evidence."""
from dataclasses import asdict, dataclass
from hashlib import sha256
import json
import re
from urllib.parse import urlsplit

SCHEMA = 'pero.scientific-document.v2'
PARSER = 'pero.arxiv-latexml.v3'
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
class ParseManifest:
    parser: str = PARSER
    options: tuple[tuple[str, str], ...] = (('whitespace', 'preserve-decoded-text'), ('math', 'allowlisted-mathml'))
    limits: ParseLimits = ParseLimits()
    source_identity: str = 'version-unconfirmed'
    identity_evidence: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class DocumentSource:
    url: str
    arxiv_id: str
    digest: str
    byte_length: int
    requested_url: str = ''
    version: str = ''

    @classmethod
    def of(cls, url, data, requested_url=None):
        try:
            parsed = urlsplit(url)
        except ValueError as error:
            raise DocumentError('Invalid arXiv source URL') from error
        identity = parsed.path.removeprefix('/html/')
        if (len(url) > 2048 or parsed.scheme != 'https' or parsed.netloc != 'arxiv.org'
                or not parsed.path.startswith('/html/') or parsed.query or parsed.fragment
                or not ARXIV_ID.fullmatch(identity) or not PINNED_ID.fullmatch(identity)):
            raise DocumentError('Use an explicit version at https://arxiv.org/html/<id>vN')
        requested = requested_url or url
        try:
            request = urlsplit(requested)
        except ValueError as error:
            raise DocumentError('Invalid requested source URL') from error
        match = re.fullmatch(r'/(?:abs|html)/(.+)', request.path)
        requested_id = match[1] if match else ''
        if (request.scheme != 'https' or request.netloc != 'arxiv.org' or request.query or request.fragment
                or not ARXIV_ID.fullmatch(requested_id)
                or re.sub(r'v\d+$', '', requested_id) != re.sub(r'v\d+$', '', identity)
                or (PINNED_ID.fullmatch(requested_id) and requested_id != identity)):
            raise DocumentError('Requested and final HTML identities do not agree', 'source_version_mismatch')
        return cls(url, identity, sha256(data).hexdigest(), len(data), requested, 'v' + PINNED_ID.fullmatch(identity)[2])


@dataclass(frozen=True)
class SourceLocator:
    """Character offsets in original UTF-8-decoded HTML, not normalized text."""
    start: int
    end: int
    start_line: int
    end_line: int


@dataclass(frozen=True)
class Inline:
    kind: str
    text: str
    latex: str = ''
    mathml: str = ''
    target: str = ''
    url: str = ''
    target_status: str = ''


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
    locator: SourceLocator | None = None
    limitations: tuple[str, ...] = ()

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
class DocumentMetadata:
    title: str = ''
    authors: tuple[str, ...] = ()
    abstract: str = ''
    identifiers: tuple[tuple[str, str], ...] = ()
    date: str | None = None


@dataclass(frozen=True)
class ScientificDocument:
    paper_id: str
    source: DocumentSource
    blocks: tuple[PaperBlock, ...]
    warnings: tuple[str, ...]
    manifest: ParseManifest = ParseManifest()
    metadata: DocumentMetadata = DocumentMetadata()

    @property
    def parser(self):
        return self.manifest.parser

    @property
    def source_identity(self):
        return self.manifest.source_identity

    @property
    def id(self):
        return sha256(encoded(self.payload())).hexdigest()

    @property
    def title(self):
        return next((block.text for block in self.blocks if block.kind == 'title'), 'Paper')

    def payload(self):
        return dict(schema=SCHEMA, paperId=self.paper_id, source=asdict(self.source),
                    parser=self.parser, sourceIdentity=self.source_identity, manifest=asdict(self.manifest), metadata=asdict(self.metadata), blocks=[asdict(block) for block in self.blocks],
                    warnings=list(self.warnings), textKind='decoded-html-text',
                    parseStatus='partial' if self.warnings else 'parsed',
                    pdfAlignment='unavailable', scientificAcceptance='unverified')

    def to_dict(self):
        return dict(id=self.id, **self.payload())

    @classmethod
    def from_record(cls, record):
        value = {key: item for key, item in record.items() if key != 'id'}
        if record.get('schema') != SCHEMA or sha256(encoded(value)).hexdigest() != record.get('id'):
            raise DocumentError('Stored scientific document integrity check failed')
        try:
            blocks = tuple(PaperBlock(
                block['id'], block['kind'], tuple(Inline(**v) for v in block['content']),
                tuple(block['anchors']), block['section_id'], block['level'],
                tuple(TableCell(cell['row'], cell['column'], cell['row_span'], cell['column_span'], cell['header'],
                                tuple(Inline(**v) for v in cell['content'])) for cell in block['cells']),
                tuple(ImageReference(**v) for v in block['images']),
                SourceLocator(**block['locator']) if block['locator'] else None,
                tuple(block['limitations'])) for block in record['blocks'])
            manifest = record['manifest']
            document = cls(record['paperId'], DocumentSource(**record['source']), blocks, tuple(record['warnings']),
                ParseManifest(manifest['parser'], tuple(tuple(v) for v in manifest['options']), ParseLimits(**manifest['limits']), manifest['source_identity'], tuple(tuple(v) for v in manifest['identity_evidence'])),
                DocumentMetadata(record['metadata']['title'], tuple(record['metadata']['authors']), record['metadata']['abstract'],
                    tuple(tuple(v) for v in record['metadata']['identifiers']), record['metadata']['date']))
        except (KeyError, TypeError) as error:
            raise DocumentError('Stored scientific document schema is invalid') from error
        if document.id != record['id']:
            raise DocumentError('Stored scientific document contract changed')
        return document

    def outline(self, start=0, limit=64):
        headings = [b for b in self.blocks if b.kind == 'heading']
        if type(start) is not int or not 0 <= start <= len(headings) or type(limit) is not int or not 1 <= limit <= 64:
            raise DocumentError('Choose a valid outline offset and at most 64 headings')
        items, used, end = [], 0, start
        for block in headings[start:start + limit]:
            item = dict(id=block.id, title=block.text[:400], titleTruncated=len(block.text) > 400,
                        level=block.level, sectionId=block.section_id)
            size = len(encoded(item))
            if used + size > 16000:
                break
            items.append(item)
            used += size
            end += 1
        return dict(items=items, start=start, nextStart=end if end < len(headings) else None,
                    totalItems=len(headings), evidenceAdmission='not-observed-in-study')

    def block(self, block_id):
        block = next((b for b in self.blocks if b.id == block_id), None)
        if block is None:
            raise DocumentError('Block is outside this document', status=404)
        return block

    def read(self, block_id, start=0, limit=4800):
        """Read typed items without slicing MathML/cells into false structures.

        Plain prose uses character offsets. Tables use cell offsets, figures
        image-reference offsets and equations/rich prose inline-token offsets.
        An oversized indivisible item is explicitly unavailable, never flattened.
        complete describes window coverage only, never scientific validity.
        """
        block = self.block(block_id)
        if type(start) is not int or start < 0 or type(limit) is not int or not 1 <= limit <= 4800:
            raise DocumentError('Choose a nonnegative offset and a read budget from 1 to 4800')
        structured = bool(block.cells or block.images or any(t.kind != 'text' for t in block.content)
                          or block.kind in ('table', 'equation', 'figure'))
        base = dict(documentId=self.id, blockId=block.id, kind=block.kind,
                    source=dict(url=self.source.url, digest=self.source.digest, anchors=[a for a in block.anchors[:64] if len(a) <= 512],
                                anchorsTruncated=len(block.anchors) > 64 or any(len(a) > 512 for a in block.anchors[:64]),
                                locator=asdict(block.locator) if block.locator else None),
                    limitations=list(block.limitations), parseStatus='partial' if block.limitations else 'parsed',
                    textKind='decoded-html-text',
                    pdfAlignment='unavailable', evidenceAdmission='not-observed-in-study')
        if not structured:
            if start > len(block.text):
                raise DocumentError('Offset is outside this block')
            end = min(start + limit, len(block.text))
            result = dict(base, unit='characters', content=block.text[start:end], start=start, end=end,
                        totalLength=len(block.text), nextStart=end if end < len(block.text) else None,
                        missing=[], complete=start == 0 and end == len(block.text))
            if len(encoded(result)) > 32768:
                raise DocumentError('Text read metadata exceeds the output limit', 'document_limit', 413)
            return result
        if block.kind == 'table' and block.cells:
            unit = 'cells'
            items = [dict(type='cell', **asdict(cell), text=cell.text) for cell in block.cells]
        elif block.kind == 'figure':
            unit = 'images'
            items = [dict(type='image-reference', **asdict(image), bytesAcquired=False, visualObservation='not-observed') for image in block.images]
        else:
            unit = 'tokens'
            items = [dict(type='inline', **asdict(token)) for token in block.content]
        context = ''.join(token.text for token in block.content)
        base.update(context=context[:800] if unit in ('cells', 'images') else '',
                    contextTruncated=len(context) > 800 if unit in ('cells', 'images') else False)
        if start > len(items):
            raise DocumentError('Item offset is outside this block')
        selected, used, end, missing = [], 0, start, []
        for index, item in enumerate(items[start:], start):
            size = len(encoded(item))
            if size > limit:
                if selected:
                    break
                missing.append(dict(index=index, reason='Typed item exceeds read budget; inspect the original source.'))
                end = index + 1
                break
            if used + size > limit or len(selected) >= 64:
                break
            selected.append(item)
            used += size
            end = index + 1
        result = dict(base, unit=unit, items=selected, start=start, end=end,
                    totalItems=len(items), nextStart=end if end < len(items) else None,
                    missing=missing, complete=start == 0 and end == len(items) and not missing and not base['contextTruncated'],
                    imageObservation='not-observed' if block.kind == 'figure' else None)
        if len(encoded(result)) > 32768:
            raise DocumentError('Structured read metadata exceeds the output limit', 'document_limit', 413)
        return result
