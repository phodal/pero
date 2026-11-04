"""Version-bound queries to the official SyncTeX utility, never page guesses."""
from dataclasses import dataclass
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from .model import ID, Invalid, digest
from .pdf import PdfAnchor, PdfRect


def synctex_binary():
    candidates = (os.environ.get('PERO_SYNCTEX_BIN'), shutil.which('synctex'),
                  str(Path(sys.executable).with_name('synctex')), '/Library/TeX/texbin/synctex')
    return next((str(Path(path).resolve()) for path in candidates if path and Path(path).is_file()), None)


@dataclass(frozen=True)
class TexNavigation:
    member_id: str | None = None
    line: int | None = None
    page: int | None = None
    x: float = 0
    y: float = 0

    @classmethod
    def parse(cls, value):
        if set(value) == {'memberId', 'line'}:
            member, line = value['memberId'], value['line']
            if isinstance(member, str) and ID.fullmatch(member) and type(line) is int and line > 0:
                return cls(member_id=member, line=line)
        elif set(value) == {'page', 'x', 'y'}:
            page, x, y = value['page'], value['x'], value['y']
            if (type(page) is int and page > 0 and all(type(n) in (int, float) and math.isfinite(n) and 0 <= n <= 1 for n in (x, y))):
                return cls(page=page, x=x, y=y)
        raise Invalid('Choose a source member and line, or a point in the compiled preview')


@dataclass(frozen=True)
class SynctexResult:
    fields: tuple[tuple[str, str], ...]

    @classmethod
    def parse(cls, output):
        results, fields, active = [], [], False
        for line in output.splitlines():
            if line == 'SyncTeX result begin':
                active = True
            elif line == 'SyncTeX result end':
                if fields:
                    results.append(cls(tuple(fields)))
                fields, active = [], False
            elif active and ':' in line:
                key, value = line.split(':', 1)
                if key == 'Output' and fields:
                    results.append(cls(tuple(fields)))
                    fields = []
                fields.append((key, value))
        return tuple(results)

    def anchor(self, document):
        fields = dict(self.fields)
        page = document.page(int(fields['Page']))
        x, bottom, width, height = (float(fields[key]) for key in ('h', 'v', 'W', 'H'))
        left, top = max(0, x / page.width), max(0, (bottom - height) / page.height)
        right, bottom = min(1, (x + width) / page.width), min(1, bottom / page.height)
        rect = PdfRect.parse(dict(x=left, y=top, width=right - left, height=bottom - top))
        return PdfAnchor(document.id, document.file_digest, page.number, (rect,)).to_dict()


def locate_tex(previews, identity, request: TexNavigation):
    preview = previews.record(identity)
    binary = synctex_binary()
    if not binary:
        raise Invalid('SyncTeX is unavailable. Source files remain readable.', 422)
    if not preview.source_map_digest or not preview.source_root:
        raise Invalid('Recompile this TeX preview to enable source navigation.', 409)
    data = (previews.store.root / 'tex-preview-files' / (identity + '.synctex.gz')).read_bytes()
    if digest(data) != preview.source_map_digest:
        raise Invalid('The source map no longer matches this build. Recompile the preview.', 409)
    project = previews.project(preview.bundle_id, preview.resource_id)
    if request.member_id:
        member = next((m for m in project.files if m.id == request.member_id), None)
        if member is None or not member.contains_line(request.line):
            raise Invalid('The source line is outside this TeX project')
        query = ['view', '-i', f'{request.line}:0:{Path(preview.source_root) / member.path}']
    else:
        page = preview.document.page(request.page)
        query = ['edit', '-o', f'{page.number}:{request.x * page.width}:{request.y * page.height}']
    with tempfile.TemporaryDirectory(prefix='pero-synctex-') as directory:
        pdf = Path(directory) / 'preview.pdf'
        pdf.write_bytes(previews.file(identity))
        pdf.with_suffix('.synctex.gz').write_bytes(data)
        command = [binary, *query, '-o', str(pdf)] if request.member_id else [binary, query[0], query[1], query[2] + ':' + str(pdf)]
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=10)
        except subprocess.TimeoutExpired as error:
            raise Invalid('Source navigation timed out. Retry this location.', 422) from error
    results = SynctexResult.parse(result.stdout)
    if result.returncode or not results:
        raise Invalid('No compiled position corresponds to this source location.', 422)
    if request.member_id:
        return dict(anchor=results[0].anchor(preview.document), memberId=member.id, line=request.line)
    for result in results:
        fields = dict(result.fields)
        member = next((m for m in project.files if str(Path(preview.source_root) / m.path) == fields.get('Input')), None)
        line = int(fields.get('Line', '0'))
        if member and member.contains_line(line):
            return dict(memberId=member.id, memberPath=member.path, line=line)
    raise Invalid('This position maps to a typesetting dependency outside the saved source files.', 422)
