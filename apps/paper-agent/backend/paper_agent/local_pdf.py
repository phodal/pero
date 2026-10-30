"""A user-supplied PDF is identified by its bytes, independently of its filename."""
from dataclasses import dataclass
from pathlib import PurePath

from .model import Invalid, digest, text

MAX_PDF_BYTES = 16 * 1024 * 1024


@dataclass(frozen=True)
class LocalPdf:
    data: bytes
    title: str
    file_digest: str

    @classmethod
    def parse(cls, data, filename):
        filename = text(filename, 1000, 'PDF filename')
        if not data or len(data) > MAX_PDF_BYTES:
            raise Invalid('PDF must be between 1 byte and 16 MiB', 413)
        if not data.startswith(b'%PDF-'):
            raise Invalid('Choose a PDF file', 415)
        return cls(data, PurePath(filename).stem, digest(data))
