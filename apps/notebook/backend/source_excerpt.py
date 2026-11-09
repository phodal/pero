"""Pinned local UTF-8 source text and exact codepoint excerpts, not authenticated citations."""
from dataclasses import dataclass
from hashlib import sha256
import re

from document import block_id, fields, integer, string

MAX_SOURCE_BYTES = 128 * 1024
SOURCE_MIMES = {'text/plain', 'text/markdown', 'text/csv', 'text/tab-separated-values', 'application/json', 'application/x-ndjson'}


@dataclass(frozen=True)
class SourceExcerptSource:
    block_id: str
    filename: str
    mime: str
    sha256: str

    @classmethod
    def parse(cls, value):
        fields(value, {'blockId', 'filename', 'mime', 'sha256'})
        identity = block_id(value['blockId'])
        filename = string(value['filename'], 'source filename', 255, required=True)
        if filename in {'.', '..'} or re.search(r'[\x00-\x1f\x7f/\\]', filename):
            raise ValueError('Invalid source filename')
        if not isinstance(value['mime'], str) or value['mime'] not in SOURCE_MIMES:
            raise ValueError('Unsupported source MIME type')
        digest = value['sha256']
        if not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest):
            raise ValueError('Invalid source digest')
        return cls(identity, filename, value['mime'], digest)

    def wire(self):
        return dict(blockId=self.block_id, filename=self.filename, mime=self.mime, sha256=self.sha256)


@dataclass(frozen=True)
class SourceExcerpt:
    source: SourceExcerptSource
    version: str
    text: str
    start: int
    end: int
    quote: str

    @classmethod
    def parse(cls, value):
        fields(value, {'source', 'version', 'text', 'start', 'end', 'quote'})
        source = SourceExcerptSource.parse(value['source'])
        if value['version'] != source.sha256:
            raise ValueError('Source excerpt version must be its immutable digest')
        text = string(value['text'], 'source text', MAX_SOURCE_BYTES)
        if re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', text):
            raise ValueError('Source text contains binary control characters')
        try:
            raw = text.encode('utf-8')  # Do not strip BOM or normalize newlines.
        except UnicodeEncodeError as error:
            raise ValueError('Source text must contain valid Unicode scalar values') from error
        if len(raw) > MAX_SOURCE_BYTES:
            raise ValueError('Source text exceeds 128 KiB')
        if sha256(raw).hexdigest() != source.sha256:
            raise ValueError('Retained source digest does not match its text')
        start = integer(value['start'], 'source start', len(text), minimum=0)
        end = integer(value['end'], 'source end', len(text), minimum=start + 1)
        quote = string(value['quote'], 'source quote', MAX_SOURCE_BYTES)
        if text[start:end] != quote:
            raise ValueError('Source quote does not match its codepoint range')
        return cls(source, source.sha256, text, start, end, quote)

    def wire(self):
        return dict(source=self.source.wire(), version=self.version, text=self.text, start=self.start, end=self.end, quote=self.quote)


def parse_source_excerpt_attributes(value):
    fields(value, {'label', 'excerpt'})
    label = string(value['label'], 'source excerpt label', 200)
    excerpt = None if value['excerpt'] is None else SourceExcerpt.parse(value['excerpt']).wire()
    return dict(label=label, excerpt=excerpt)
