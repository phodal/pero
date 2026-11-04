"""Literal caption windows shared by source comparison and figure navigation."""
from dataclasses import dataclass
import re

from .pdf import PdfDocument


@dataclass(frozen=True)
class CaptionLocation:
    page: int
    start: int
    end: int


@dataclass(frozen=True)
class SourceCaption:
    text: str

    def matches(self, document: PdfDocument) -> tuple[CaptionLocation, ...]:
        fragments = set()
        if not re.search(r'[\\{}$%]', self.text) and len(self.text) >= 12:
            fragments.add(self.text)
        fragments.update(part.strip() for part in re.split(r'\\[a-zA-Z@]+\*?|[{}$%]|(?<=[.;])\s+', self.text)
                         if len(part.strip()) >= 40)
        pages = tuple((page.number, page.text, [i for i, char in enumerate(page.text) if not char.isspace()])
                      for page in document.pages)
        compact_pages = tuple((number, text, offsets, ''.join(text[i] for i in offsets)) for number, text, offsets in pages)
        # A complete caption is stronger than its fragments. Never discard a
        # repeated occurrence before deciding whether navigation is unambiguous.
        for needle in sorted({re.sub(r'\s+', '', part) for part in fragments}, key=lambda part: (-len(part), part)):
            matches = []
            for number, text, offsets, compact in compact_pages:
                cursor = compact.find(needle)
                while cursor >= 0:
                    start, end = offsets[cursor], offsets[cursor + len(needle) - 1] + 1
                    if end - start <= 4800:
                        matches.append(CaptionLocation(number, start, end))
                    cursor = compact.find(needle, cursor + 1)
            if matches:
                return tuple(matches)
        return ()

    @staticmethod
    def unique(document: PdfDocument, captions: tuple['SourceCaption', ...]) -> CaptionLocation | None:
        matches = {match for caption in captions for match in caption.matches(document)}
        return next(iter(matches)) if len(matches) == 1 else None
