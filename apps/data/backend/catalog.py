"""One atomic catalog owns immutable files, logical datasets and saved views."""
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
import base64
import hashlib
import json
from pathlib import Path
import sys
import threading
import uuid

# Source and installed Apps use the same shared exact-value parser, not Data Agent.
_shared = Path(__file__).resolve().parents[3] / 'harness/go/charts/python'
sys.path.insert(0, str(_shared if _shared.is_dir() else Path(__file__).parent / '_core'))
from datasets import (Dataset, DatasetEdit, MAX_COLUMNS, MAX_FIELDS, MAX_ROWS, PARSER_VERSION,
                      PREVIEW_BYTES, PreviewRequest, SaveView, SavedView, fields, identity, text)
from inspection import Inspection

IMPORT_LIMIT = 10 * 1024 * 1024


@dataclass(frozen=True)
class ImportFile:
    name: str
    kind: str
    content: bytes
    source: str
    license: str
    datasetId: str = ''
    projectRef: str = ''

    @classmethod
    def parse(cls, value):
        fields(value, ('name', 'kind', 'content', 'source', 'license', 'datasetId', 'projectRef'))
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
        dataset_id = value.get('datasetId', '')
        if dataset_id:
            identity(dataset_id, 'dataset', 'ds-')
        elif not isinstance(dataset_id, str):
            raise ValueError('Invalid dataset')
        return cls(name, kind, content, text(value.get('source', 'Local import'), 'source'),
                   text(value.get('license', 'Unknown'), 'license'), dataset_id,
                   text(value.get('projectRef', ''), 'project reference', 200))


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
    bundleId: str = ''
    sourceId: str = ''
    downloadUrl: str = ''


class InspectionUnavailable(ValueError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class Catalog:
    def __init__(self, directory):
        self.directory = Path(directory).resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.files = self.directory / 'files'
        self.files.mkdir(exist_ok=True)
        self.lock = threading.RLock()
        path = self.directory / 'catalog.json'
        raw = json.loads(path.read_text(encoding='utf-8')) if path.exists() else []
        self.legacy = raw if isinstance(raw, list) and path.exists() else None
        if isinstance(raw, list):
            self.assets = [Asset(**item) for item in raw]
            self.datasets = [Dataset.for_asset(a.id, a.name, a.kind) for a in self.assets]
            self.views = []
        elif isinstance(raw, dict) and raw.get('schemaVersion') == 2:
            self.assets = [Asset(**item) for item in raw['assets']]
            self.datasets = [Dataset.restore(item) for item in raw['datasets']]
            self.views = [SavedView.restore(item) for item in raw['views']]
        else:
            raise ValueError('Unsupported Data catalog version; the original has not been changed')
        for asset in self.assets:
            identity(asset.id, 'stored asset')
        known = {a.id: a for a in self.assets}
        for dataset in self.datasets:
            if not dataset.versions or any(v not in known or known[v].kind != dataset.kind for v in dataset.versions):
                raise ValueError('Catalog contains a missing or incompatible version reference')
        for view in self.views:
            self.dataset(view.datasetId).require_version(view.assetId)
            if known[view.assetId].sha256 != view.sha256:
                raise ValueError('Saved view does not match its immutable asset reference')

    def atomic(self, name, value):
        path = self.directory / name
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False), encoding='utf-8')
        temporary.replace(path)

    def _save(self, assets, datasets, views):
        # A single replacement publishes files' metadata and logical references together.
        if self.legacy is not None and not (self.directory / 'catalog.v1.backup.json').exists():
            self.atomic('catalog.v1.backup.json', self.legacy)
        self.atomic('catalog.json', dict(schemaVersion=2, assets=[asdict(a) for a in assets],
                                        datasets=[asdict(d) for d in datasets], views=[v.public() for v in views]))
        self.assets, self.datasets, self.views = assets, datasets, views
        self.legacy = None

    def availability(self, asset):
        path = self.files / asset.id
        if path.is_symlink() or not path.is_file():
            return 'missing'
        return 'present' if path.stat().st_size == asset.size else 'changed'

    def listing(self):
        with self.lock:
            return [dict(asdict(asset), location=str(self.files / asset.id),
                         localAvailable=(state := self.availability(asset)) == 'present', availability=state)
                    for asset in reversed(self.assets)]

    def workspace(self):
        with self.lock:
            return dict(datasets=[asdict(d) for d in reversed(self.datasets)],
                        views=[v.public() for v in reversed(self.views)], parserVersion=PARSER_VERSION,
                        limits=dict(importBytes=IMPORT_LIMIT, previewBytes=PREVIEW_BYTES,
                                    records=MAX_ROWS, fields=MAX_FIELDS, columns=MAX_COLUMNS))

    def dataset(self, dataset_id):
        found = next((item for item in self.datasets if item.id == dataset_id), None)
        if found is None:
            raise ValueError('Dataset not found')
        return found

    def publish(self, part, name, kind, source, revision='', license='Unknown', checksums=(),
                bundle_id='', source_id='', download_url='', verified_sha256=None,
                dataset_id='', project_ref=''):
        if verified_sha256 is None:
            digest = hashlib.sha256()
            with part.open('rb') as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(chunk)
            verified_sha256 = digest.hexdigest()
        asset = Asset(uuid.uuid4().hex, name, kind, Path(name).suffix.lstrip('.').lower() or 'binary',
                      part.stat().st_size, source, revision, license, verified_sha256,
                      datetime.now(timezone.utc).isoformat(), list(checksums), bundle_id, source_id, download_url)
        with self.lock:
            if dataset_id:
                updated = self.dataset(dataset_id).append(asset.id, kind)
                datasets = [updated if d.id == dataset_id else d for d in self.datasets]
            else:
                datasets = [*self.datasets, Dataset.for_asset(asset.id, name, kind, project_ref)]
            destination = self.files / asset.id
            part.replace(destination)
            try:
                self._save([*self.assets, asset], datasets, self.views)
            except OSError:
                destination.unlink(missing_ok=True)
                raise
        return asset

    def matching_source(self, source):
        checksum = next(c.value for c in source.checksums if c.algorithm == 'sha256')
        with self.lock:
            return next((asset for asset in self.assets
                         if (asset.downloadUrl or f'{asset.source}/resolve/{asset.revision}/{asset.name}') == source.url
                         and asset.revision == source.revision
                         and asset.sha256 == checksum and asset.size == source.size
                         and self.availability(asset) == 'present'), None)

    def import_file(self, request):
        part = self.directory / f'{uuid.uuid4().hex}.part'
        try:
            part.write_bytes(request.content)
            return self.publish(part, request.name, request.kind, request.source, license=request.license,
                                dataset_id=request.datasetId, project_ref=request.projectRef)
        finally:
            part.unlink(missing_ok=True)

    def edit_dataset(self, request: DatasetEdit):
        with self.lock:
            updated = self.dataset(request.datasetId).edit(request)
            self._save(self.assets, [updated if d.id == updated.id else d for d in self.datasets], self.views)
        return updated

    def _inspect(self, request: PreviewRequest):
        with self.lock:
            self.dataset(request.datasetId).require_version(request.assetId)
            asset = next(a for a in self.assets if a.id == request.assetId)
        state = self.availability(asset)
        if state != 'present':
            raise InspectionUnavailable(state, 'Original file is missing or has a different size; no cached preview is substituted')
        if asset.size > PREVIEW_BYTES:
            raise InspectionUnavailable('unsupported', 'Stored file exceeds the 10 MiB inspection limit; its bytes have not been rechecked')
        with (self.files / asset.id).open('rb') as stream:
            content = stream.read(PREVIEW_BYTES + 1)
        if len(content) != asset.size or hashlib.sha256(content).hexdigest() != asset.sha256:
            raise InspectionUnavailable('changed', 'Original bytes no longer match the stored SHA-256')
        if asset.format not in ('csv', 'tsv', 'json', 'jsonl', 'ndjson'):
            raise InspectionUnavailable('unsupported', 'Stored opaque file; tabular preview is unavailable')
        return asset, Inspection.parse(content, asset.name, asset.format)

    def inspect(self, request: PreviewRequest):
        try:
            asset, inspection = self._inspect(request)
            return dict(status='ok', datasetId=request.datasetId, assetId=asset.id,
                        sha256=asset.sha256, **inspection.page(request))
        except InspectionUnavailable as error:
            return dict(status=error.status, message=str(error), datasetId=request.datasetId, assetId=request.assetId)
        except (UnicodeError, ValueError) as error:
            return dict(status='invalid', message=str(error), datasetId=request.datasetId, assetId=request.assetId)

    def save_view(self, request: SaveView):
        asset, inspection = self._inspect(request.preview)
        page = inspection.page(request.preview)
        view = SavedView(uuid.uuid4().hex, request.name, request.preview.datasetId, asset.id, asset.sha256,
                         replace(request.preview.view, columns=tuple(page['columns'])), inspection.report,
                         datetime.now(timezone.utc).isoformat())
        with self.lock:
            self._save(self.assets, self.datasets, [*self.views, view])
        return view
