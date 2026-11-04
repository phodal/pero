"""Typeset previews of approved TeX projects, separate from original PDF evidence."""
from dataclasses import asdict, dataclass, replace
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import threading

from .model import ID, Invalid, digest
from .pdf import PdfDocument
from .research_resources import ArxivPaper, OfficialHtml
from .source_archive import SourceArchive


@dataclass(frozen=True)
class TexInput:
    id: str
    path: str
    data: bytes

    def contains_line(self, line):
        try:
            return 1 <= line <= len(self.data.decode('utf-8').splitlines())
        except UnicodeDecodeError:
            return False


@dataclass(frozen=True)
class TexProject:
    archive_digest: str
    files: tuple[TexInput, ...]

    @property
    def entries(self):
        return tuple(f for f in self.files if f.path.lower().endswith('.tex')
                     and re.search(rb'(?m)^[^%\n]*\\documentclass\b', f.data))

    def entry(self, identity=None):
        entries = self.entries
        if identity is None and len(entries) == 1:
            return entries[0]
        selected = next((f for f in entries if f.id == identity), None)
        if selected is None:
            raise Invalid('Choose a main TeX file containing \\documentclass.', 422)
        return selected


@dataclass(frozen=True)
class TexRequest:
    bundle_id: str
    resource_id: str
    entry_id: str | None

    @classmethod
    def parse(cls, value):
        if (set(value) - {'bundleId', 'resourceId', 'entryId'}
                or any(not isinstance(value.get(k), str) or not ID.fullmatch(value[k]) for k in ('bundleId', 'resourceId'))
                or ('entryId' in value and (not isinstance(value['entryId'], str) or not ID.fullmatch(value['entryId'])))):
            raise Invalid('Choose an approved source archive and main TeX file.')
        return cls(value['bundleId'], value['resourceId'], value.get('entryId'))


@dataclass(frozen=True)
class TexCompilation:
    id: str
    status: str = 'running'
    preview_id: str | None = None
    error: str = ''

    def finish(self, preview_id=None, error=''):
        if self.status != 'running' or bool(preview_id) == bool(error):
            raise Invalid('A running TeX compilation finishes with either a preview or an error.')
        return replace(self, status='failed' if error else 'complete', preview_id=preview_id, error=error)


@dataclass(frozen=True)
class TexSource:
    bundle_id: str
    resource_id: str
    revision: str
    available: bool
    status: str


@dataclass(frozen=True)
class TexPreview:
    id: str
    paper_id: str
    bundle_id: str
    resource_id: str
    archive_digest: str
    entry_id: str
    entry_path: str
    engine: str
    document: PdfDocument
    diagnostics: str
    created_at: str
    source_map_digest: str | None = None
    source_root: str | None = None

    def to_dict(self):
        return dict(id=self.id, paperId=self.paper_id, bundleId=self.bundle_id, resourceId=self.resource_id,
            archiveDigest=self.archive_digest, entryId=self.entry_id, entryPath=self.entry_path, engine=self.engine,
            document=self.document.to_dict(), diagnostics=self.diagnostics, createdAt=self.created_at,
            sourceMapDigest=self.source_map_digest, sourceRoot=self.source_root)

    @classmethod
    def from_record(cls, value):
        return cls(value['id'], value['paperId'], value['bundleId'], value['resourceId'], value['archiveDigest'],
            value['entryId'], value['entryPath'], value['engine'], PdfDocument.from_record(value['document']),
            value['diagnostics'], value['createdAt'], value.get('sourceMapDigest'), value.get('sourceRoot'))


def tectonic_binary():
    candidates = [shutil.which('tectonic'), '/opt/homebrew/bin/tectonic', '/usr/local/bin/tectonic']
    return next((str(Path(p).resolve()) for p in candidates if p and Path(p).is_file()), None)


class TexPreviews:
    def __init__(self, store, pdf_files):
        self.store, self.pdf_files = store, pdf_files
        self.compilations: dict[str, TexCompilation] = {}

    def start(self, paper_id, value, now):
        request = TexRequest.parse(value)
        identity = digest(dict(paperId=paper_id, **asdict(request)))
        with self.store.lock:
            current = self.compilations.get(identity)
            if current and current.status == 'running':
                return self.status(identity)
            job = TexCompilation(identity)
            self.compilations[identity] = job

        def typeset():
            try:
                preview = self.compile(paper_id, request, now)
                self.compilations[identity] = job.finish(preview_id=preview.id)
            except Exception as error:
                self.compilations[identity] = job.finish(error=str(error))

        threading.Thread(target=typeset, daemon=True, name='paper-tex-preview').start()
        return self.status(identity)

    def status(self, identity):
        job = self.compilations.get(identity)
        if job is None:
            raise Invalid('TeX compilation was interrupted. Reopen the preview or retry.', 409)
        return dict(id=job.id, status=job.status, error=job.error,
                    preview=self.record(job.preview_id).to_dict() if job.preview_id else None)

    def sources(self, paper_id):
        paper = self.store.paper(paper_id)
        try:
            work = ArxivPaper.from_snapshot(paper)
        except Invalid:
            return []
        sources = []
        for bundle in self.store.imports.bundles():
            for resource in bundle.resources:
                if (resource.kind != 'source_archive' or resource.id not in bundle.sourceDownloadIds
                        or not resource.workIdentity or not resource.revision):
                    continue
                source = OfficialHtml(resource.workIdentity.removeprefix('arxiv:'), resource.revision)
                if not work.accepts(source):
                    continue
                _, job = self.store.source_downloads.job(bundle.id, resource.id)
                sources.append(TexSource(bundle.id, resource.id, resource.revision,
                                         self.store.source_downloads.available(job), job.status))
        return sources

    def project(self, bundle_id, resource_id):
        _, job = self.store.source_downloads.job(bundle_id, resource_id)
        if not job.receipt or not self.store.source_downloads.available(job):
            raise Invalid('Download or restore this source archive before typesetting.', 409)
        archive = SourceArchive.from_record(self.store._read('source-archives', job.receipt.archiveDigest))
        return TexProject(archive.sha256, tuple(TexInput(m.id, m.path,
            (self.store.root / 'source-members' / (m.sha256 + '.bin')).read_bytes()) for m in archive.members))

    def overview(self, paper_id):
        from .tex_navigation import synctex_binary
        sources = self.sources(paper_id)
        previews = [TexPreview.from_record(self.store._read('tex-previews', identity)) for identity in self.store._list('tex-previews')]
        previews.sort(key=lambda p: (p.source_map_digest is not None, p.created_at), reverse=True)
        rows = []
        for source in sources:
            row = dict(bundleId=source.bundle_id, resourceId=source.resource_id, revision=source.revision,
                       available=source.available, status=source.status)
            if source.available:
                project = self.project(source.bundle_id, source.resource_id)
                row['archiveDigest'] = project.archive_digest
                row['entries'] = [dict(id=f.id, path=f.path) for f in project.entries]
                row['previews'] = [p.to_dict() for p in previews if p.paper_id == paper_id
                    and p.archive_digest == project.archive_digest
                    and (p.bundle_id, p.resource_id) == (source.bundle_id, source.resource_id)]
            rows.append(row)
        return dict(sources=rows, engineAvailable=bool(tectonic_binary() and sys.platform == 'darwin'), sourceNavigationAvailable=bool(synctex_binary()))

    def compile(self, paper_id, request: TexRequest, now):
        bundle_id, resource_id = request.bundle_id, request.resource_id
        if not any((s.bundle_id, s.resource_id) == (bundle_id, resource_id) for s in self.sources(paper_id)):
            raise Invalid('This source archive does not belong to the selected paper/version.', 409)
        project = self.project(bundle_id, resource_id)
        entry = project.entry(request.entry_id)
        binary = tectonic_binary()
        if not binary or sys.platform != 'darwin':
            raise Invalid('Install Tectonic to enable TeX previews. This preview runner requires macOS sandbox-exec.', 422)
        engine = subprocess.check_output([binary, '--version'], text=True, timeout=5).strip()
        identity = digest(dict(paperId=paper_id, bundleId=bundle_id, resourceId=resource_id, archive=project.archive_digest, entry=entry.id, engine=engine, runner='sandbox-tectonic.v2-synctex'))
        if identity in self.store._list('tex-previews'):
            record = TexPreview.from_record(self.store._read('tex-previews', identity))
            self.file(identity)
            return record
        cache = (self.store.root / 'tex-engine-cache').resolve()
        cache.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='pero-tex-') as directory:
            root = Path(directory).resolve()
            for member in project.files:
                path = root / member.path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(member.data)
            output = root / '_pero_output'
            output.mkdir()
            # The compiler sees the staged project and its package cache, not the
            # user's files. Tectonic's untrusted mode also disables shell escape.
            profile = ('(version 1) (allow default) (deny file-write*) '
                f'(allow file-write* (subpath {json.dumps(str(root))}) (subpath {json.dumps(str(cache))}) (literal "/dev/null")) '
                '(deny file-read* (subpath "/Users")) '
                f'(allow file-read* (subpath {json.dumps(str(root))}) (subpath {json.dumps(str(cache))})) '
                f'(deny process-exec) (allow process-exec (literal {json.dumps(binary)}))')
            env = {k: v for k, v in os.environ.items() if k.lower() in
                   ('path', 'https_proxy', 'http_proxy', 'all_proxy', 'no_proxy', 'ssl_cert_file')}
            env.update(HOME=str(cache), XDG_CACHE_HOME=str(cache), TMPDIR=str(root), TECTONIC_UNTRUSTED_MODE='1')
            with (root / 'compiler.log').open('w+b') as log:
                try:
                    result = subprocess.run(['/usr/bin/sandbox-exec', '-p', profile, binary,
                        '--untrusted', '--synctex', '--keep-logs', '--outdir', str(output), Path(entry.path).name],
                        cwd=root / Path(entry.path).parent, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=180)
                except subprocess.TimeoutExpired as error:
                    raise Invalid('TeX compilation exceeded 180 seconds. Inspect the source and retry.', 422) from error
                log.seek(max(0, log.tell() - 4800))
                diagnostics = log.read().decode('utf-8', errors='replace')
            pdf = output / (Path(entry.path).stem + '.pdf')
            if result.returncode or not pdf.is_file():
                raise Invalid('TeX compilation failed.\n' + diagnostics, 422)
            if pdf.stat().st_size > 32 * 1024 * 1024:
                raise Invalid('Compiled TeX PDF exceeds 32 MiB.', 413)
            data = pdf.read_bytes()
            source_map = pdf.with_suffix('.synctex.gz')
            mapping = source_map.read_bytes() if source_map.is_file() else None
            document = PdfDocument.create(paper_id, digest(data), 'urn:pero:tex:' + project.archive_digest,
                                          self.pdf_files.pages(data), now)
        record = TexPreview(identity, paper_id, bundle_id, resource_id, project.archive_digest,
                            entry.id, entry.path, engine, document, diagnostics[-2000:], now,
                            digest(mapping) if mapping else None, str(root) if mapping else None)
        directory = self.store.root / 'tex-preview-files'
        directory.mkdir(parents=True, exist_ok=True)
        (directory / (identity + '.pdf')).write_bytes(data)
        if mapping:
            (directory / (identity + '.synctex.gz')).write_bytes(mapping)
        self.store._write('tex-previews', identity, record.to_dict())
        return record

    def file(self, identity):
        record = self.record(identity)
        data = (self.store.root / 'tex-preview-files' / (identity + '.pdf')).read_bytes()
        if digest(data) != record.document.file_digest:
            raise Invalid('Compiled TeX preview integrity check failed. Compile again.', 409)
        return data

    def record(self, identity):
        record = TexPreview.from_record(self.store._read('tex-previews', identity))
        _, job = self.store.source_downloads.job(record.bundle_id, record.resource_id)
        if not job.receipt or job.receipt.archiveDigest != record.archive_digest:
            raise Invalid('The compiled preview no longer matches its approved source.', 409)
        return record
