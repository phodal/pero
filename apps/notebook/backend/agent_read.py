"""Bounded, revision-pinned Agent reads, including oversized single blocks."""

from dataclasses import dataclass
import json

from document import block_id, integer, nodes


# Leave room for entry metadata under Desktop App Use's 1,000,000 byte limit.
INLINE_BYTES = 900_000
# Even JSON's worst-case six-byte escaping stays below that limit.
CHUNK_CHARACTERS = 100_000


@dataclass(frozen=True)
class AgentRead:
    revision: int | None = None
    block_identity: str | None = None
    offset: int | None = None
    view: str | None = None

    def __post_init__(self):
        if self.view not in (None, 'index'):
            raise ValueError('Invalid read view')
        if self.view == 'index' and self.block_identity is not None:
            raise ValueError('Block index reads cannot select a block')
        if self.revision is not None:
            integer(self.revision, 'revision')
        if self.block_identity is not None:
            block_id(self.block_identity)
        if self.offset is not None:
            if type(self.offset) is not int or self.offset < 0:
                raise ValueError('Invalid read offset')
            if self.offset > 0 and self.revision is None:
                raise ValueError('Continuation reads require the revision returned by the first read')

    def read(self, document):
        target = 'document' if self.block_identity is None else 'block'
        value = document.wire() if self.block_identity is None else document.block(self.block_identity)
        if value is None:
            raise LookupError('Block is not present in this revision')
        serialized = json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
        if self.view == 'index' or (target == 'document' and self.offset is None
                                     and len(serialized.encode()) > INLINE_BYTES):
            blocks = [{'blockId': node['attrs']['blockId'], 'type': node['type']}
                      for node in nodes(document.content) if node.get('attrs', {}).get('blockId')]
            offset = self.offset or 0
            if offset and offset >= len(blocks):
                raise ValueError('Read offset lies outside the block index')
            end = min(offset + 100, len(blocks))
            return {'format': 'block-index', 'blocks': blocks[offset:end], 'offset': offset,
                    'nextOffset': end if end < len(blocks) else None, 'totalBlocks': len(blocks)}
        if self.offset is None and len(serialized.encode()) <= INLINE_BYTES:
            return {target: value}
        offset = self.offset or 0
        if offset >= len(serialized):
            raise ValueError('Read offset lies outside the selected content')
        end = min(offset + CHUNK_CHARACTERS, len(serialized))
        return {
            'format': 'json-chunk', 'target': target, 'blockId': self.block_identity,
            'offset': offset, 'nextOffset': end if end < len(serialized) else None,
            'totalCharacters': len(serialized), 'content': serialized[offset:end],
        }
