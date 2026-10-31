"""App-private immutable files and a small atomic metadata catalog."""
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import base64
import hashlib
import json
from pathlib import Path
import threading
import uuid

IMPORT_LIMIT = 10 * 1024 * 1024


def text(value, label, maximum=300):
    if not isinstance(value, str) or len(value) > maximum or any(ord(c) < 32 for c in value):
        raise ValueError(f'Invalid {label}')
    return value.strip()


@dataclass(frozen=True)
class ImportFile:
    name: str
    kind: str
    content: bytes
    source: str
    license: str

    @classmethod
    def parse(cls, value):
        if set(value) - {'name', 'kind', 'content', 'source', 'license'}:
            raise ValueError('Unknown import field')
        name = text(value.get('name'), 'filename', 200)
        if not name or name in ('.', '..') or '/' in name or '\\' in name:
            raise ValueError('Choose a filename, not a path')
        kind = value.get('kind')
        if kind not in ('dataset', 'model'):
            raise ValueError('Choose dataset or model')
        encoded = value.get('content')
        if not isinstance(encoded, str) or len(encoded) > ((IMPORT_LIMIT + 2) // 3) * 4:
            raise ValueError('Import limit is 10 MiB')
        try:
            content = base64.b64decode(encoded, validate=True)
        except (ValueError, UnicodeEncodeError) as error:
            raise ValueError('Invalid file encoding') from error
        if not content or len(content) > IMPORT_LIMIT:
            raise ValueError('File must be between 1 byte and 10 MiB')
        return cls(name, kind, content, text(value.get('source', 'Local import'), 'source'),
                   text(value.get('license', 'Unknown'), 'license'))


@dataclass(frozen=True)
class Asset:
    id: str
    name: str
    kind: str
    format: str
    size: int
    source: str
    revision: str
    license: str
    sha256: str
    createdAt: str
    checksums: list


class Catalog:
    def __init__(self, directory):
        self.directory = Path(directory).resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.files = self.directory / 'files'
        self.files.mkdir(exist_ok=True)
        self.lock = threading.RLock()
        path = self.directory / 'catalog.json'
        self.assets = [Asset(**item) for item in json.loads(path.read_text(encoding='utf-8'))] if path.exists() else []

    def atomic(self, name, value):
        path = self.directory / name
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False), encoding='utf-8')
        temporary.replace(path)

    def listing(self):
        with self.lock:
            return [dict(asdict(asset), location=str(self.files / asset.id),
                         localAvailable=(self.files / asset.id).is_file())
                    for asset in reversed(self.assets)]

    def publish(self, part, name, kind, source, revision='', license='Unknown', checksums=()):
        digest = hashlib.sha256()
        with part.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(chunk)
        asset = Asset(uuid.uuid4().hex, name, kind, Path(name).suffix.lstrip('.').lower() or 'binary',
                      part.stat().st_size, source, revision, license, digest.hexdigest(),
                      datetime.now(timezone.utc).isoformat(), list(checksums))
        with self.lock:
            destination = self.files / asset.id
            part.replace(destination)
            try:
                self.atomic('catalog.json', [asdict(a) for a in (*self.assets, asset)])
            except OSError:
                destination.unlink(missing_ok=True)
                raise
            self.assets.append(asset)
        return asset

    def import_file(self, request):
        part = self.directory / f'{uuid.uuid4().hex}.part'
        try:
            part.write_bytes(request.content)
            return self.publish(part, request.name, request.kind, request.source, license=request.license)
        finally:
            part.unlink(missing_ok=True)
