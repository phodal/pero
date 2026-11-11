"""Persist authored MyST as inert source; parsing and publication never execute it."""

from dataclasses import dataclass
from document import fields, block_id

MAX_MYST_SOURCE_BYTES = 256 * 1024


@dataclass(frozen=True)
class MystDocumentSource:
    source: str

    def __post_init__(self):
        if not isinstance(self.source, str) or len(self.source.encode('utf-8')) > MAX_MYST_SOURCE_BYTES:
            raise ValueError('MyST source must be text no larger than 256 KiB')

    @classmethod
    def parse(cls, attrs):
        fields(attrs, {'blockId', 'schemaVersion', 'source'}, {'templateOrigin'})
        block_id(attrs['blockId'])
        if type(attrs['schemaVersion']) is not int or attrs['schemaVersion'] != 1:
            raise ValueError('Unsupported MyST document block version; source was not replaced')
        return cls(attrs['source'])
