"""Frozen publication inputs and receipts; no compiler, clock or filesystem access."""
from dataclasses import dataclass
from hashlib import sha256
import base64
import binascii
import io
import json
import re
import zipfile

from document import fields, integer, block_id

MAX_ARCHIVE_BYTES = 1024 * 1024
MAX_EXPANDED_BYTES = 8 * 1024 * 1024
MAX_PDF_BYTES = 8 * 1024 * 1024
MAX_LOG_BYTES = 32 * 1024


@dataclass(frozen=True)
class PublicationMember:
    path: str
    data: bytes


@dataclass(frozen=True)
class PublicationSource:
    snapshot: str
    entry_path: str
    entry_text: str

    @classmethod
    def from_entry(cls, entry, identity):
        node = entry.document.block(identity)
        if node is None or node['type'] != 'mystProject':
            raise ValueError('Choose a saved MyST project block before building')
        # EntryStore already admitted the document and its snapshot at persistence.
        raw = node['attrs']['snapshot']
        snapshot = json.loads(raw)
        resource = next(file for file in snapshot['files'] if file['path'] == snapshot['entry'])
        return cls(raw, snapshot['entry'], resource['text'])

    @property
    def sha256(self):
        return sha256(self.snapshot.encode()).hexdigest()


@dataclass(frozen=True)
class PublicationArchive:
    raw: bytes
    members: tuple[PublicationMember, ...]

    @classmethod
    def parse(cls, encoded):
        if not isinstance(encoded, str) or len(encoded) > ((MAX_ARCHIVE_BYTES + 2) // 3) * 4:
            raise ValueError('Publication archive must be canonical base64 and at most 1 MiB')
        try:
            raw = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error) as error:
            raise ValueError('Invalid publication archive base64') from error
        if len(raw) > MAX_ARCHIVE_BYTES or base64.b64encode(raw).decode() != encoded:
            raise ValueError('Publication archive must be canonical base64 and at most 1 MiB')
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                files = archive.infolist()
                if not 3 <= len(files) <= 64 or sum(file.file_size for file in files) > MAX_EXPANDED_BYTES:
                    raise ValueError('Publication archive exceeds 64 files or 8 MiB expanded')
                names, members = set(), []
                for file in files:
                    path = file.filename
                    if (path in names or file.is_dir() or file.flag_bits & 1
                            or (file.external_attr >> 16) & 0o170000 == 0o120000
                            or not (path in ('article.tex', 'source.json', 'notebook.ipynb', 'assets.json', 'publication-losses.json', 'project.myst-project.json')
                                    or re.fullmatch(r'assets/image-[1-9][0-9]*\.(png|jpg)', path))):
                        raise ValueError('Publication archive contains an unsupported or duplicate resource')
                    names.add(path)
                    members.append(PublicationMember(path, archive.read(file)))
                if not {'article.tex', 'assets.json', 'publication-losses.json', 'project.myst-project.json'} <= names:
                    raise ValueError('Publication archive is missing its generated source or manifests')
                if ('source.json' in names) == ('notebook.ipynb' in names):
                    raise ValueError('Publication archive requires exactly one original entry source')
        except (zipfile.BadZipFile, RuntimeError, NotImplementedError, UnicodeError) as error:
            raise ValueError('Unreadable publication ZIP archive') from error
        return cls(raw, tuple(members))

    def bind(self, source):
        """A compiled projection must recover the exact selected entry source."""
        files = {file.path: file.data for file in self.members}
        try:
            if files['project.myst-project.json'] != source.snapshot.encode('utf-8'):
                raise ValueError('Publication projection does not match the complete saved project snapshot. Save and build again.')
            if source.entry_path.lower().endswith('.ipynb'):
                original = files['notebook.ipynb'].decode('utf-8')
            else:
                recovery = fields(json.loads(files['source.json']), {'format', 'version', 'source'})
                if recovery['format'] != 'pero-myst' or recovery['version'] != 1:
                    raise ValueError('Unsupported publication source recovery')
                original = recovery['source']
            if original != source.entry_text:
                raise ValueError('Publication projection does not match the saved entry source. Save and build again.')
            losses = json.loads(files['publication-losses.json'])
            if not isinstance(losses, list) or any(not isinstance(item, str) for item in losses):
                raise ValueError('Invalid publication loss manifest')
        except (KeyError, UnicodeError, json.JSONDecodeError) as error:
            raise ValueError('Publication archive lacks readable original entry source or losses') from error
        return tuple(PublicationDiagnostic('warning', message) for message in losses)

    @property
    def sha256(self):
        return sha256(self.raw).hexdigest()


@dataclass(frozen=True)
class PublicationBuildRequest:
    revision: int
    block_id: str
    archive: PublicationArchive

    @classmethod
    def parse(cls, value):
        fields(value, {'revision', 'blockId', 'archive'})
        return cls(integer(value['revision'], 'revision'), block_id(value['blockId']),
                   PublicationArchive.parse(value['archive']))


@dataclass(frozen=True)
class PublicationDiagnostic:
    severity: str
    message: str
    path: str | None = None
    line: int | None = None

    def wire(self):
        return dict(severity=self.severity, message=self.message,
                    **({'path': self.path} if self.path else {}),
                    **({'line': self.line} if self.line else {}))


@dataclass(frozen=True)
class PublicationResult:
    status: str
    engine: str | None
    command: tuple[str, ...]
    diagnostics: tuple[PublicationDiagnostic, ...]
    log: str = ''
    pdf: bytes | None = None
    tex_cache: str | None = None


@dataclass(frozen=True)
class PublicationBuild:
    id: str
    entry_id: str
    revision: int
    block_id: str
    source_sha256: str
    archive_sha256: str
    created_at: str
    result: PublicationResult

    def wire(self):
        return dict(id=self.id, entryId=self.entry_id, revision=self.revision, blockId=self.block_id,
                    sourceSha256=self.source_sha256, archiveSha256=self.archive_sha256,
                    createdAt=self.created_at, status=self.result.status, engine=self.result.engine,
                    command=list(self.result.command), diagnostics=[item.wire() for item in self.result.diagnostics],
                    log=self.result.log,
                    **({'texCache': self.result.tex_cache} if self.result.tex_cache else {}),
                    **({'pdfSha256': sha256(self.result.pdf).hexdigest()} if self.result.pdf else {}))
