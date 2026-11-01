"""Approved, pinned source acquisition using the shared transport/worker/store."""
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
import json
import hashlib
import stat
import os
from pathlib import Path
import tempfile
import threading

from .acquisition_worker import acquire_bounded
from .model import ID, Invalid, canonical, digest
from .pdf_download import PdfDownloadCommand
from .resource_fetch import PublicMetadata
from .source_archive import SourceArchive, safe_preview

TERMINAL_SOURCES = ('source_available', 'pdf_only', 'no_tex')


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


@dataclass(frozen=True)
class SourceReceipt:
    sourcePageUrl: str
    requestUrl: str
    finalUrl: str
    fetchedAt: str
    archiveDigest: str
    size: int
    mime: str
    format: str
    workIdentity: str | None
    revision: str | None
    explicitVersion: str
    memberCount: int
    texCount: int


@dataclass(frozen=True)
class SourceDownload:
    id: str
    bundleId: str
    resourceId: str
    status: str = 'not_started'
    stage: str = 'discovered'
    error: str = ''
    receipt: SourceReceipt | None = None
    restoredAt: str | None = None
    restoreFinalUrl: str | None = None
    previewRebuiltAt: str | None = None
    sourceRebuiltAt: str | None = None

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_record(cls, value):
        return cls(**{**value, 'receipt': SourceReceipt(**value['receipt']) if value.get('receipt') else None})


def acquire_source(output, directory, url, transport, expected_digest):
    response = transport.fetch_source(url)
    fetched_at = now()
    if expected_digest and digest(response.data) != expected_digest:
        raise Invalid('Source bytes changed. Restore requires the original archive SHA-256; the saved receipt is unchanged.', 409)
    output.send(('stage', 'parsing'))
    stage_archive(directory, response.data)
    output.send(('complete', response.url, fetched_at, response.mime))


def stage_archive(directory, data):
    archive, blobs, previews = SourceArchive.inspect(data)
    root = Path(directory)
    (root / 'original.bin').write_bytes(data)
    index = canonical(archive.to_dict())
    if len(index) > 512 * 1024:
        raise Invalid('Source member and structure index exceeds 512 KiB', 413)
    (root / 'archive.json').write_bytes(index)
    for identity, content in blobs.items():
        (root / (identity + '.bin')).write_bytes(content)
    for identity, content in previews.items():
        (root / (identity + '.png')).write_bytes(content)


def repair_source(output, directory, store_root, archive_digest):
    data = (Path(store_root) / 'source-files' / (archive_digest + '.bin')).read_bytes()
    if digest(data) != archive_digest:
        raise Invalid('Original source archive integrity check failed', 409)
    output.send(('stage', 'parsing'))
    stage_archive(directory, data)
    output.send(('source_complete', now()))


def repair_previews(output, directory, store_root, archive):
    """Rebuild derived images from verified local members; never use transport."""
    root = Path(store_root)
    original = root / 'source-files' / (archive.sha256 + '.bin')
    if digest(original.read_bytes()) != archive.sha256:
        raise Invalid('Original source archive integrity check failed', 409)
    output.send(('stage', 'parsing'))
    for member in archive.members:
        if not member.preview:
            continue
        data = (root / 'source-members' / (member.sha256 + '.bin')).read_bytes()
        if digest(data) != member.sha256:
            raise Invalid('Original source image integrity check failed', 409)
        preview, width, height, _original_width, _original_height = safe_preview(data)
        if digest(preview) != member.previewSha256 or (width, height) != (member.previewWidth, member.previewHeight):
            raise Invalid('Rebuilt preview differs from its saved integrity metadata', 409)
        (Path(directory) / (member.id + '.png')).write_bytes(preview)
    output.send(('preview_complete', now()))


class SourceDownloads:
    def __init__(self, store, transport=None, seconds=60):
        self.store, self.transport, self.seconds = store, transport or PublicMetadata(), seconds
        self.running = {}
        self.integrity = {}
        for identity in store._list('source-downloads'):
            job = self._read(identity)
            if job.status == 'running':
                self._save(replace(job, status='interrupted', error='Source acquisition interrupted by restart. Retry explicitly.'))

    def _read(self, identity):
        return SourceDownload.from_record(self.store._read('source-downloads', identity))

    def _save(self, job):
        self.store.imports._replace('source-downloads', job.id, job.to_dict())

    def job(self, bundle_id, resource_id):
        resource = self.store.imports.approved_source(bundle_id, resource_id)
        identity = digest(dict(bundleId=bundle_id, resourceId=resource_id))
        job = self._read(identity) if identity in self.store._list('source-downloads') else SourceDownload(identity, bundle_id, resource_id)
        return resource, job

    def valid_blob(self, kind, name, expected, size=None):
        """Hash only when the managed regular file's filesystem fingerprint changes."""
        if kind not in ('source-files', 'source-members', 'source-previews') or not isinstance(expected, str) or not ID.fullmatch(expected):
            return False
        stem, suffix = os.path.splitext(name)
        if not ID.fullmatch(stem) or suffix != ('.png' if kind == 'source-previews' else '.bin'):
            return False
        path = self.store.root / kind / name
        try:
            observed = path.lstat()
        except OSError:
            return False
        fingerprint = (observed.st_dev, observed.st_ino, observed.st_size, observed.st_mtime_ns, observed.st_ctime_ns)
        key = (kind, name, expected, size)
        previous = self.integrity.get(key)
        if previous and previous[0] == fingerprint:
            return previous[1]
        maximum = {'source-files': 16, 'source-members': 64, 'source-previews': 4}[kind] * 1024 * 1024
        valid = stat.S_ISREG(observed.st_mode) and observed.st_size <= maximum and (size is None or observed.st_size == size)
        if valid:
            try:
                with path.open('rb') as stream:
                    valid = hashlib.file_digest(stream, 'sha256').hexdigest() == expected
                after = path.lstat()
                valid = valid and fingerprint == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
            except OSError:
                valid = False
        self.integrity[key] = (fingerprint, valid)
        return valid

    def archive_available(self, job):
        return bool(job.receipt and self.valid_blob('source-files', job.receipt.archiveDigest + '.bin', job.receipt.archiveDigest, job.receipt.size))

    def originals_available(self, job):
        if not self.archive_available(job):
            return False
        try:
            archive = SourceArchive.from_record(self.store._read('source-archives', job.receipt.archiveDigest))
        except Invalid:
            return False
        return all(self.valid_blob('source-members', member.sha256 + '.bin', member.sha256, member.size) for member in archive.members)

    def available(self, job):
        if not self.originals_available(job):
            return False
        archive = SourceArchive.from_record(self.store._read('source-archives', job.receipt.archiveDigest))
        return all(not member.preview or self.valid_blob('source-previews', member.id + '.png', member.previewSha256) for member in archive.members)

    def view(self, job):
        available = self.available(job)
        if job.status in TERMINAL_SOURCES and not available:
            job = replace(job, status='unavailable', stage='unavailable', error='Saved source files or previews are missing or failed integrity checks. Restore rebuilds members and previews locally when the verified archive remains; network recovery requires the original archive SHA-256.')
        return dict(**job.to_dict(), localAvailable=available)

    def request(self, value):
        command = PdfDownloadCommand.parse(value)
        with self.store.lock:
            resource, job = self.job(command.bundle_id, command.resource_id)
            if command.operation == 'cancel' and job.status == 'running':
                self.running[job.id][0].set()
            if command.operation == 'start' and job.status != 'running' and (job.status not in TERMINAL_SOURCES or not self.available(job)):
                if any(thread.is_alive() for _, thread in (*self.running.values(), *self.store.pdf_downloads.running.values())):
                    raise Invalid('Another source or PDF is being acquired. Wait or cancel it first.', 409)
                job = replace(job, status='running', stage='parsing' if self.archive_available(job) else 'downloading', error='')
                self._save(job)
                cancelled = threading.Event()
                thread = threading.Thread(target=self._acquire, args=(job, resource, cancelled), daemon=True)
                self.running[job.id] = (cancelled, thread)
                thread.start()
            return self.view(job)

    def _acquire(self, job, resource, cancelled):
        def stage(value):
            nonlocal job
            with self.store.lock:
                job = replace(job, stage=value)
                self._save(job)
        try:
            with tempfile.TemporaryDirectory(prefix='pero-paper-source-') as directory:
                if self.originals_available(job):
                    archive = SourceArchive.from_record(self.store._read('source-archives', job.receipt.archiveDigest))
                    result = acquire_bounded(repair_previews, (directory, str(self.store.root), archive), cancelled, self.seconds, stage)
                elif self.archive_available(job):
                    result = acquire_bounded(repair_source, (directory, str(self.store.root), job.receipt.archiveDigest), cancelled, self.seconds, stage)
                else:
                    result = acquire_bounded(acquire_source, (directory, resource.originalUrl, self.transport,
                        job.receipt.archiveDigest if job.receipt else None), cancelled, self.seconds, stage)
                with self.store.lock:
                    if cancelled.is_set():
                        job = replace(job, status='cancelled', error='Source acquisition cancelled.')
                    elif result[0] == 'preview_complete':
                        self._publish(archive, Path(directory), preview_only=True)
                        job = replace(job, status=archive.status, stage='available', error='', previewRebuiltAt=result[1])
                    elif result[0] == 'source_complete':
                        archive = SourceArchive.from_record(json.loads((Path(directory) / 'archive.json').read_bytes()))
                        self._publish(archive, Path(directory))
                        job = replace(job, status=archive.status, stage='available', error='', sourceRebuiltAt=result[1])
                    elif result[0] != 'complete':
                        job = replace(job, status=result[0], error=result[1])
                    else:
                        root = Path(directory)
                        archive = SourceArchive.from_record(json.loads((root / 'archive.json').read_bytes()))
                        self._publish(archive, root)
                        receipt = SourceReceipt(resource.evidence[0].url if resource.evidence else '', resource.originalUrl,
                            result[1], result[2], archive.sha256, (root / 'original.bin').stat().st_size, result[3], archive.format,
                            resource.workIdentity, resource.revision, 'sha256:' + archive.sha256, len(archive.members), sum(m.kind == 'tex' for m in archive.members))
                        job = replace(job, status=archive.status, stage='available', error='', receipt=job.receipt or receipt,
                                      restoredAt=result[2] if job.receipt else None, restoreFinalUrl=result[1] if job.receipt else None)
                    self._save(job)
        except Exception as error:
            with self.store.lock:
                detail = error.detail if isinstance(error, Invalid) else f'Source acquisition failed ({type(error).__name__}). Retry explicitly.'
                self._save(replace(job, status='cancelled' if cancelled.is_set() else 'failed', error=detail))
        finally:
            with self.store.lock:
                self.running.pop(job.id, None)

    def _publish(self, archive, directory, preview_only=False):
        files = [] if preview_only else [('source-files', archive.sha256 + '.bin', directory / 'original.bin', archive.sha256)]
        if not preview_only:
            files.extend(('source-members', member.sha256 + '.bin', directory / (member.sha256 + '.bin'), member.sha256) for member in archive.members)
        files.extend(('source-previews', member.id + '.png', directory / (member.id + '.png'), member.previewSha256) for member in archive.members if member.preview)
        created = []
        index = self.store.root / 'source-archives' / (archive.sha256 + '.json')
        index_existed = index.exists()
        try:
            for kind, name, original, expected in files:
                target = self.store.root / kind / name
                if self.valid_blob(kind, name, expected):
                    continue
                data = original.read_bytes()
                if digest(data) != expected:
                    raise Invalid('Staged source data failed integrity verification', 409)
                existed = target.exists() or target.is_symlink()
                target.parent.mkdir(parents=True, exist_ok=True)
                descriptor, temporary = tempfile.mkstemp(prefix='.source-', dir=target.parent)
                try:
                    with os.fdopen(descriptor, 'wb') as stream:
                        stream.write(data)
                        stream.flush()
                        os.fsync(stream.fileno())
                    os.replace(temporary, target)
                    if not existed:
                        created.append(target)
                finally:
                    if os.path.exists(temporary):
                        os.unlink(temporary)
            record = archive.to_dict()
            if index_existed:
                previous = self.store._read('source-archives', archive.sha256)
                old_members = {member['id']: member for member in previous['members']}
                for member in record['members']:
                    old = old_members.get(member['id'], {})
                    for field in ('originalWidth', 'originalHeight', 'previewWidth', 'previewHeight'):
                        if field not in old:
                            member.pop(field, None)
                if record != previous:
                    raise Invalid('Immutable research document conflict', 409)
                # Older indices retain unknown original dimensions; restoration
                # cannot silently rewrite historical metadata.
            else:
                self.store._write('source-archives', archive.sha256, record)
        except Exception:
            for path in created:
                path.unlink(missing_ok=True)
            if not index_existed:
                index.unlink(missing_ok=True)
            raise

    def close(self):
        with self.store.lock:
            workers = list(self.running.values())
            for cancelled, _ in workers:
                cancelled.set()
        for _, thread in workers:
            thread.join(timeout=3)
