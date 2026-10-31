"""Stable original-text lines; line numbers are one-based and inclusive."""
from dataclasses import dataclass

from .model import Invalid


@dataclass(frozen=True)
class SourceText:
    content: str

    @classmethod
    def from_lines(cls, lines):
        if not isinstance(lines, list) or any(not isinstance(line, str) for line in lines):
            raise Invalid('Invalid stored source lines')
        return cls(''.join(lines))

    @property
    def lines(self):
        # Keep original line endings, including CRLF, for exact quotations/digests.
        return tuple(self.content.splitlines(keepends=True))

    def range(self, start_line, end_line, limit=4800):
        lines = self.lines
        if (type(start_line) is not int or type(end_line) is not int
                or not 1 <= start_line <= end_line <= len(lines)):
            raise Invalid('Line range is outside the source; use one-based inclusive lines')
        start = sum(len(line) for line in lines[:start_line - 1])
        content = ''.join(lines[start_line - 1:end_line])
        if len(content) > limit:
            raise Invalid('Line range exceeds 4,800 characters; choose fewer lines or read by character offset')
        return start, content
