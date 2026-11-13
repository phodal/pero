"""One synchronous, offline, sandboxed Tectonic adapter; no Agent or run queue."""
from contextlib import closing
from hashlib import sha256
import io
from datetime import datetime, timezone
from pathlib import Path
import base64
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from uuid import uuid4

from publication_build import (PublicationBuild, PublicationDiagnostic,
    PublicationResult, PublicationSource, MAX_PDF_BYTES, MAX_LOG_BYTES)
from store import MissingEntry


def tectonic_binary():
    candidates = (shutil.which('tectonic'), '/opt/homebrew/bin/tectonic', '/usr/local/bin/tectonic')
    return next((str(Path(path).resolve()) for path in candidates if path and Path(path).is_file()), None)


def tectonic_cache():
    configured = os.environ.get('PERO_NOTEBOOK_TEX_CACHE')
    return (Path(configured).expanduser() if configured else Path.home() / 'Library/Caches/TectonicProject.Tectonic').resolve()


def compiler_availability():
    if sys.platform != 'darwin' or not Path('/usr/bin/sandbox-exec').is_file():
        return False, 'Local PDF builds require macOS sandbox-exec and Tectonic. LaTeX/Typst exports remain available.'
    if not tectonic_binary():
        return False, 'Install Tectonic locally to build PDFs. LaTeX/Typst exports remain available; no compiler is downloaded.'
    return True, f'Uses installed Tectonic offline with read-only TeX cache: {tectonic_cache()}. Missing packages are reported in the build diagnostics.'


def compile_publication(archive, warnings=(), *, timeout=45):
    available, detail = compiler_availability()
    if not available:
        return PublicationResult('unavailable', None, (), (*warnings, PublicationDiagnostic('error', detail)))
    binary = tectonic_binary()
    try:
        engine = subprocess.check_output([binary, '--version'], text=True, timeout=5).strip()
    except (OSError, subprocess.SubprocessError) as error:
        return PublicationResult('unavailable', None, (), (*warnings, PublicationDiagnostic('error', f'Cannot start Tectonic: {error}')))
    # Use only the existing engine package cache. Compiler cannot read other user
    # files, write outside this staging directory, execute children or use network.
    cache = tectonic_cache()
    with tempfile.TemporaryDirectory(prefix='pero-publication-') as directory:
        root = Path(directory).resolve()
        for member in archive.members:
            path = root / member.path
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(member.data)
        home = root / '_engine_home'
        package_cache = home / 'Library/Caches/TectonicProject.Tectonic'
        package_cache.parent.mkdir(parents=True)
        if cache.is_dir():
            package_cache.symlink_to(cache, target_is_directory=True)
        output = root / '_output'
        output.mkdir()
        profile = ('(version 1) (allow default) (deny network*) (deny file-write*) '
            f'(allow file-write* (subpath {json.dumps(str(root))}) (literal "/dev/null")) '
            '(deny file-read* (subpath "/Users")) '
            f'(allow file-read* (subpath {json.dumps(str(root))}) (subpath {json.dumps(str(cache))})) '
            f'(deny process-exec) (allow process-exec (literal {json.dumps(binary)}))')
        command = (binary, '--untrusted', '--only-cached', '--keep-logs', '--outdir', str(output), 'article.tex')
        env = dict(HOME=str(home), PATH='/opt/homebrew/bin:/usr/bin:/bin', TMPDIR=str(root), TECTONIC_UNTRUSTED_MODE='1')
        # Bound log/PDF files at the process boundary as well as before retention.
        launcher = ('import os,resource; '
                    f'resource.setrlimit(resource.RLIMIT_FSIZE, ({MAX_PDF_BYTES}, {MAX_PDF_BYTES})); '
                    'os.execv("/usr/bin/sandbox-exec", __import__("sys").argv[1:])')
        with (root / 'compiler.log').open('w+b') as log:
            try:
                process = subprocess.run([sys.executable, '-I', '-c', launcher, '/usr/bin/sandbox-exec', '-p', profile, *command],
                    cwd=root, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
                failure = '' if process.returncode == 0 else f'Tectonic exited with code {process.returncode}. Correct the source or cached package availability, then build again.'
            except subprocess.TimeoutExpired:
                failure = f'PDF build exceeded {timeout} seconds. Simplify the source and build again.'
            except OSError as error:
                failure = f'Cannot start the local PDF compiler: {error}'
            log.seek(0, 2)
            log.seek(max(0, log.tell() - MAX_LOG_BYTES))
            compiler_log = log.read().decode('utf-8', errors='replace')
        tex_log = output / 'article.log'
        if tex_log.is_file():
            with tex_log.open('rb') as stream:
                stream.seek(max(0, tex_log.stat().st_size - MAX_LOG_BYTES))
                compiler_log = (compiler_log + '\n' + stream.read().decode('utf-8', errors='replace'))[-MAX_LOG_BYTES:]
        diagnostics = list(warnings)
        # Tectonic's terminal diagnostics use article.tex:LINE; retain generated
        # source locations honestly rather than claiming a MyST-to-TeX source map.
        for line in compiler_log.splitlines():
            match = re.search(r'(?:error|warning): (article\.tex):(\d+):\s*(.*)', line)
            if match:
                diagnostics.append(PublicationDiagnostic('error' if line.startswith('error:') else 'warning', match[3], match[1], int(match[2])))
        pdf = output / 'article.pdf'
        if not failure and (not pdf.is_file() or pdf.stat().st_size > MAX_PDF_BYTES):
            failure = 'Compiler produced no usable PDF within the 8 MiB limit. Inspect the retained log and source archive.'
        if failure:
            diagnostics.append(PublicationDiagnostic('error', failure))
            return PublicationResult('failed', engine, command, tuple(diagnostics), compiler_log, tex_cache=str(cache))
        data = pdf.read_bytes()
        if not data.startswith(b'%PDF-'):
            return PublicationResult('failed', engine, command, (*diagnostics, PublicationDiagnostic('error', 'Compiler output is not a PDF.')), compiler_log, tex_cache=str(cache))
        return PublicationResult('succeeded', engine, command, tuple(diagnostics), compiler_log, data, str(cache))


class PublicationPreviewUnavailable(ValueError):
    pass


class PublicationBuildStore:
    """Publication receipts are satellites of immutable Notebook Entry revisions."""
    def __init__(self, store):
        self.store = store
        store.migrate(['''CREATE TABLE IF NOT EXISTS notebook_publication_builds (
            id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, revision INTEGER NOT NULL,
            block_id TEXT NOT NULL, created_at TEXT NOT NULL, record TEXT NOT NULL,
            archive BLOB NOT NULL, pdf BLOB)'''])

    def build(self, identity, request):
        entry = self.store.read(identity, request.revision)
        source = PublicationSource.from_entry(entry, request.block_id)
        warnings = request.archive.bind(source)
        result = compile_publication(request.archive, warnings)
        build = PublicationBuild(uuid4().hex, identity, request.revision, request.block_id,
            source.sha256, request.archive.sha256, datetime.now(timezone.utc).isoformat(timespec='microseconds'), result)
        record = build.wire()
        self.store.in_entry(identity, lambda connection, _entry: connection.execute(
            'INSERT INTO notebook_publication_builds VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            (build.id, identity, build.revision, build.block_id, build.created_at,
             json.dumps(record), request.archive.raw, result.pdf)))
        return self.read(identity, build.id)

    def list(self, identity, block=None):
        self.store.read(identity)
        with closing(sqlite3.connect(self.store.path)) as connection:
            rows = connection.execute('''SELECT record FROM notebook_publication_builds
                WHERE entry_id = ? AND (? IS NULL OR block_id = ?) ORDER BY created_at DESC, id DESC''',
                (identity, block, block))
            available, detail = compiler_availability()
            return dict(builds=[json.loads(row[0]) for row in rows], engineAvailable=available, engineDetail=detail)

    def page(self, identity, build_id, page):
        record = self.read(identity, build_id)
        if 'pdf' not in record:
            raise ValueError('This build produced no PDF. Inspect its diagnostics and source archive.')
        try:
            from pero_source_tools import PDFIUM_LOCK, pdf_engine
            from PIL import Image
            engine = pdf_engine()
        except ImportError as error:
            raise PublicationPreviewUnavailable('PDF preview dependencies are unavailable. Repair Notebook dependencies in Host, or download the PDF.') from error
        data = base64.b64decode(record['pdf'])
        with PDFIUM_LOCK, closing(engine.PdfDocument(data)) as pdf:
            if not 1 <= page <= len(pdf) <= 500:
                raise ValueError('Choose an existing page in a PDF with at most 500 pages')
            with closing(pdf[page - 1]) as selected:
                scale = min(2, 1600 / max(selected.get_size()))
                with closing(selected.render(scale=scale)) as bitmap, bitmap.to_pil() as image:
                    output = io.BytesIO()
                    image.save(output, format='PNG')
                    while output.tell() > 2 * 1024 * 1024:
                        image.thumbnail((max(1, image.width // 2), max(1, image.height // 2)), Image.Resampling.LANCZOS)
                        output = io.BytesIO()
                        image.save(output, format='PNG')
                    return dict(page=page, pages=len(pdf), base64=base64.b64encode(output.getvalue()).decode(),
                                width=image.width, height=image.height, pdfSha256=sha256(data).hexdigest())

    def read(self, identity, build_id):
        self.store.read(identity)
        with closing(sqlite3.connect(self.store.path)) as connection:
            row = connection.execute('SELECT record, archive, pdf FROM notebook_publication_builds WHERE entry_id = ? AND id = ?',
                                     (identity, build_id)).fetchone()
        if row is None:
            raise MissingEntry('Publication build not found')
        record = json.loads(row[0])
        source = PublicationSource.from_entry(self.store.read(identity, record['revision']), record['blockId'])
        return dict(build=record, archive=base64.b64encode(row[1]).decode(), snapshot=source.snapshot,
                    **({'pdf': base64.b64encode(row[2]).decode()} if row[2] is not None else {}))
