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
class TexFailure:
    message: str
    code: str = 'compile_failed'
    diagnostics: str = ''

    @classmethod
    def from_compiler(cls, diagnostics, *, biber_available, timed_out):
        if timed_out:
            return cls('TeX compilation exceeded 180 seconds.', 'timeout', diagnostics)
        if not biber_available and 'note: Running external tool biber ...' in diagnostics:
            return cls('A compatible Biber executable is required to build the bibliography.',
                       'biber_unavailable', diagnostics)
        lines = diagnostics.splitlines()
        biber_error = next((line.removeprefix('ERROR - ').strip() for line in lines
                            if line.startswith('ERROR - ')), '')
        if biber_error:
            code = 'biber_version' if 'control file version' in biber_error else 'compile_failed'
            return cls(biber_error[:700], code, diagnostics)
        errors = [line.removeprefix('error: ').strip() for line in lines if line.startswith('error: ')]
        message = next((line for line in errors if ': ' in line), errors[-1] if errors else '')
        return cls(message[:700] or 'The compiler did not produce a PDF.', diagnostics=diagnostics)


class TexCompileError(Invalid):
    def __init__(self, failure: TexFailure):
        super().__init__(failure.message, 422)
        self.failure = failure


@dataclass(frozen=True)
class TexCompilation:
    id: str
    status: str = 'running'
    preview_id: str | None = None
    failure: TexFailure | None = None

    def finish(self, preview_id=None, failure: TexFailure | None = None):
        if self.status != 'running' or bool(preview_id) == bool(failure):
            raise Invalid('A running TeX compilation finishes with either a preview or an error.')
        return replace(self, status='failed' if failure else 'complete', preview_id=preview_id, failure=failure)


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
            except TexCompileError as error:
                self.compilations[identity] = job.finish(failure=error.failure)
            except Exception as error:
                self.compilations[identity] = job.finish(failure=TexFailure(str(error)))

        threading.Thread(target=typeset, daemon=True, name='paper-tex-preview').start()
        return self.status(identity)

    def status(self, identity):
        job = self.compilations.get(identity)
        if job is None:
            raise Invalid('TeX compilation was interrupted. Reopen the preview or retry.', 409)
        failure = job.failure
        return dict(id=job.id, status=job.status, error=failure.message if failure else '',
                    errorCode=failure.code if failure else None, diagnostics=failure.diagnostics if failure else '',
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
            scratch = Path(directory).resolve()
            root = scratch / 'project'
            root.mkdir()
            biber_runtime = scratch / 'biber-runtime'
            search_path = os.pathsep.join([os.environ.get('PATH', os.defpath),
                                           '/opt/homebrew/bin', '/usr/local/bin', '/Library/TeX/texbin'])
            biber_path = shutil.which('tectonic-biber', path=search_path) or shutil.which('biber', path=search_path)
            biber = Path(biber_path) if biber_path and Path(biber_path).is_absolute() else None
            executables = [binary]
            env = {k: v for k, v in os.environ.items() if k.lower() in
                   ('https_proxy', 'http_proxy', 'all_proxy', 'no_proxy', 'ssl_cert_file')}
            env.update(HOME=str(cache), XDG_CACHE_HOME=str(cache), TMPDIR=str(root),
                       TECTONIC_UNTRUSTED_MODE='1', PATH=os.defpath)
            if biber:
                # Standalone Biber unpacks its Perl runtime before re-executing.
                # Initialize it before staging the source, outside the writable project.
                biber_runtime.mkdir()
                biber_env = dict(env, PATH=os.defpath, PAR_GLOBAL_TEMP=str(biber_runtime))
                try:
                    probe = subprocess.run([str(biber), '--version'], cwd=biber_runtime, env=biber_env,
                                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
                    if probe.returncode:
                        biber = None
                except (OSError, subprocess.TimeoutExpired):
                    biber = None
                if biber:
                    env.update(PATH=str(biber.parent), PAR_GLOBAL_TEMP=str(biber_runtime))
                    executables.append(str(biber.resolve()))
                    for path in (biber_runtime / biber.name, biber_runtime / 'thin' / biber.name):
                        if path.is_file():
                            executables.append(str(path.resolve()))
            for member in project.files:
                path = root / member.path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(member.data)
            output = root / '_pero_output'
            output.mkdir()
            # The compiler sees the staged project and its package cache, not the
            # user's files. Tectonic's untrusted mode also disables shell escape.
            executable_rules = ' '.join(f'(literal {json.dumps(path)})' for path in executables)
            # PAR opens this lock even when the prepared runtime is already present.
            lock_rule = f'(literal {json.dumps(str(biber_runtime / "inc.lock"))})' if biber else ''
            profile = ('(version 1) (allow default) (deny file-write*) '
                f'(allow file-write* (subpath {json.dumps(str(root))}) (subpath {json.dumps(str(cache))}) (literal "/dev/null") {lock_rule}) '
                '(deny file-read* (subpath "/Users")) '
                f'(allow file-read* (subpath {json.dumps(str(scratch))}) (subpath {json.dumps(str(cache))}) {executable_rules}) '
                f'(deny process-exec) (allow process-exec {executable_rules})')
            with (root / 'compiler.log').open('w+b') as log:
                try:
                    result = subprocess.run(['/usr/bin/sandbox-exec', '-p', profile, binary,
                        '--untrusted', '--synctex', '--keep-logs', '--outdir', str(output), Path(entry.path).name],
                        cwd=root / Path(entry.path).parent, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=180)
                except subprocess.TimeoutExpired:
                    result = None
                size = log.seek(0, os.SEEK_END)
                log.seek(0)
                if size > 32_768:
                    start = log.read(8192).rpartition(b'\n')[0]
                    log.seek(size - 24_576)
                    end = log.read().partition(b'\n')[2]
                    diagnostics = (start + b'\n\n[...]\n\n' + end).decode('utf-8', errors='replace')
                else:
                    diagnostics = log.read().decode('utf-8', errors='replace')
            pdf = output / (Path(entry.path).stem + '.pdf')
            if result is None or result.returncode or not pdf.is_file():
                raise TexCompileError(TexFailure.from_compiler(diagnostics, biber_available=bool(biber),
                                                               timed_out=result is None))
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
