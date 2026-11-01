"""Read-only, bounded source representations. TeX is indexed, never evaluated."""
from dataclasses import asdict, dataclass
from bisect import bisect_right
from itertools import accumulate
import gzip
import io
from pathlib import PurePosixPath
import re
import tarfile

from .model import Invalid, digest
from .source_text import SourceText

MAX_ARCHIVE = 16 * 1024 * 1024
MAX_EXPANDED = 64 * 1024 * 1024
MAX_TEXT = 2 * 1024 * 1024
MAX_MEMBERS = 1024
COMMAND = re.compile(r'\\([A-Za-z]+\*?|.)', re.S)
ENVIRONMENTS = {'table', 'table*', 'longtable', 'tabular', 'tabular*', 'tabularx', 'figure', 'figure*'}
LIMITATIONS = ('Literal TeX structure only: macros, conditions and input files are not expanded or compiled.',
              'Source figures are not raw experimental data. Code and data links are references, not execution authorization.',
              'Source line anchors are not PDF page numbers. Only literal caption matches provide cross-representation locations.')


@dataclass(frozen=True)
class TexStructure:
    kind: str
    start: int
    end: int
    startLine: int
    endLine: int
    name: str = ''
    caption: str | None = None
    context: str | None = None
    reference: str | None = None

    def to_dict(self):
        return asdict(self)


def tex_structures(content):
    """A bounded literal scanner: comments/verbatim cannot manufacture commands."""
    structures, stack, bibitems = [], [], []
    cursor, length = 0, len(content)
    line_starts = (0, *tuple(accumulate(len(line) for line in SourceText(content).lines))[:-1])

    def group(pos, opening='{', closing='}'):
        while pos < length and content[pos].isspace():
            pos += 1
        if pos >= length or content[pos] != opening:
            return None, pos
        start, depth = pos + 1, 1
        pos += 1
        while pos < length:
            if content[pos] == '\\':
                pos += 2
                continue
            if content[pos] == '%':
                newline = content.find('\n', pos)
                pos = length if newline < 0 else newline + 1
                continue
            if content[pos] == opening:
                depth += 1
                if depth > 64:
                    raise Invalid('TeX nesting exceeds 64 levels')
            elif content[pos] == closing:
                depth -= 1
                if depth == 0:
                    return content[start:pos], pos + 1
            pos += 1
        return None, pos

    def record(kind, start, end, **fields):
        if len(structures) >= 2048:
            raise Invalid('TeX structure exceeds 2,048 entries')
        if fields.get('caption') and len(fields['caption']) > 4000:
            fields['caption'], fields['context'] = None, 'Caption exceeds the literal-index limit; read original lines.'
        if fields.get('reference') and len(fields['reference']) > 4096:
            fields['reference'], fields['context'] = None, 'Reference exceeds the literal-index limit; read original lines.'
        if len(fields.get('name', '')) > 256:
            fields['name'] = '[overlong literal identifier]'
        structures.append(TexStructure(kind, start, end, bisect_right(line_starts, start),
                                       bisect_right(line_starts, max(start, end - 1)), **fields))

    while cursor < length:
        if content[cursor] == '%':
            newline = content.find('\n', cursor)
            cursor = length if newline < 0 else newline + 1
            continue
        if content[cursor] != '\\':
            cursor += 1
            continue
        start = cursor
        token = COMMAND.match(content, cursor)
        if not token:
            break
        name = token[1]
        cursor = token.end()
        if name.rstrip('*') == 'verb':
            if cursor < length:
                finish = content.find(content[cursor], cursor + 1)
                cursor = length if finish < 0 else finish + 1
            continue
        if name in ('begin', 'end'):
            env, finish = group(cursor)
            if env is None:
                continue
            cursor = finish
            if name == 'begin' and env in ('verbatim', 'verbatim*', 'lstlisting', 'minted'):
                finish = content.find('\\end{' + env + '}', cursor)
                cursor = length if finish < 0 else finish + len(env) + 6
                continue
            if name == 'begin':
                if len(stack) >= 64:
                    raise Invalid('TeX environment nesting exceeds 64 levels')
                stack.append((env, start, None))
            elif stack and stack[-1][0] == env:
                _, beginning, caption = stack.pop()
                if env in ENVIRONMENTS:
                    previous_line = content[:beginning].rstrip().split('\n')[-1][:300] if beginning else ''
                    record(env, beginning, cursor, caption=caption, context=previous_line or None)
                if env == 'thebibliography' and bibitems:
                    beginning, key = bibitems.pop()
                    record('bibitem', beginning, start, name=key)
            continue
        if name.rstrip('*') in ('caption', 'includegraphics', 'bibitem'):
            optional, finish = group(cursor, '[', ']')
            if optional is not None:
                cursor = finish
        if name.rstrip('*') in ('caption', 'includegraphics', 'label', 'input', 'include', 'bibliography', 'bibitem', 'url', 'href'):
            value, finish = group(cursor)
            if value is None:
                continue
            cursor = finish
            if name.rstrip('*') == 'caption':
                record('caption', start, cursor, name=name, caption=value)
                for index in range(len(stack) - 1, -1, -1):
                    if stack[index][0] in ENVIRONMENTS:
                        env, beginning, _ = stack[index]
                        stack[index] = (env, beginning, value)
                        break
            elif name == 'bibitem':
                if bibitems:
                    beginning, key = bibitems.pop()
                    record('bibitem', beginning, start, name=key)
                bibitems.append((start, value))
            else:
                record(name.rstrip('*'), start, cursor, reference=value)
    for beginning, key in bibitems:
        record('bibitem', beginning, length, name=key)
    return tuple(sorted(structures, key=lambda item: (item.start, item.end)))


@dataclass(frozen=True)
class SourceMember:
    id: str
    path: str
    sha256: str
    size: int
    kind: str
    lineCount: int | None
    structures: tuple[TexStructure, ...] = ()
    preview: bool = False
    warning: str = ''
    previewSha256: str | None = None
    # Legacy width/height are preview dimensions, never original asset dimensions.
    width: int | None = None
    height: int | None = None
    originalWidth: int | None = None
    originalHeight: int | None = None
    previewWidth: int | None = None
    previewHeight: int | None = None

    def to_dict(self):
        return {**asdict(self), 'structures': [s.to_dict() for s in self.structures]}

    @classmethod
    def from_record(cls, value):
        return cls(**{**value, 'previewWidth': value.get('previewWidth', value.get('width')),
                      'previewHeight': value.get('previewHeight', value.get('height')),
                      'structures': tuple(TexStructure(**s) for s in value.get('structures', ()))})


@dataclass(frozen=True)
class SourceArchive:
    sha256: str
    format: str
    status: str
    members: tuple[SourceMember, ...]

    def to_dict(self):
        return dict(sha256=self.sha256, format=self.format, status=self.status,
                    members=[member.to_dict() for member in self.members])

    @classmethod
    def from_record(cls, value):
        return cls(value['sha256'], value['format'], value['status'], tuple(SourceMember.from_record(m) for m in value['members']))

    @classmethod
    def inspect(cls, data):
        if not data or len(data) > MAX_ARCHIVE:
            raise Invalid('Source payload must be between 1 byte and 16 MiB', 413)
        archive_digest = digest(data)
        if data.lstrip().lower().startswith((b'<html', b'<!doctype html')):
            raise Invalid('HTML is not a source representation')
        if data.startswith(b'%PDF-'):
            return cls(archive_digest, 'pdf', 'pdf_only', ()), {}, {}
        format = 'plain'
        unpacked = data
        if data.startswith(b'\x1f\x8b'):
            try:
                with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:
                    unpacked = stream.read(MAX_EXPANDED + 1)
            except (OSError, EOFError) as error:
                raise Invalid('Damaged gzip source payload') from error
            if len(unpacked) > MAX_EXPANDED:
                raise Invalid('Source expansion exceeds 64 MiB', 413)
            format = 'gzip'
        if unpacked.startswith(b'%PDF-'):
            return cls(archive_digest, format + '-pdf', 'pdf_only', ()), {}, {}
        if unpacked.startswith((b'PK\x03\x04', b'PK\x05\x06', b'PK\x07\x08')):
            raise Invalid('ZIP source packages are unsupported')
        blobs, previews, members, names = {}, {}, [], set()

        def add(name, content):
            suffix = PurePosixPath(name).suffix.lower()
            file_digest = digest(content)
            member_id = digest(dict(path=name, sha256=file_digest))
            kind, line_count, structures, preview, warning = 'binary', None, (), False, ''
            preview_sha, width, height = None, None, None
            original_width, original_height = None, None
            if suffix in ('.gz', '.tgz', '.tar', '.zip', '.bz2', '.xz', '.7z') or content.startswith((b'\x1f\x8b', b'PK\x03\x04', b'PK\x05\x06', b'PK\x07\x08')) or content[257:262] == b'ustar':
                raise Invalid('Nested source archives are unsupported')
            if suffix in ('.tex', '.bib', '.bbl', '.cls', '.sty', '.txt', '.md', '.json', '.csv'):
                if len(content) > MAX_TEXT:
                    raise Invalid('Source text member exceeds 2 MiB', 413)
                try:
                    text = content.decode('utf-8')
                except UnicodeError:
                    kind, warning = 'unknown_encoding', 'Not valid UTF-8; no encoding was guessed.'
                else:
                    kind = 'tex' if suffix == '.tex' else 'text'
                    line_count = len(SourceText(text).lines)
                    structures = tex_structures(text) if kind == 'tex' else ()
            elif suffix in ('.png', '.jpg', '.jpeg', '.webp'):
                kind = 'image'
                try:
                    value, width, height, original_width, original_height = safe_preview(content)
                    previews[member_id] = value
                    preview_sha = digest(value)
                    preview = True
                except Exception:
                    warning = 'Image preview unavailable: unsupported, damaged or above 20 megapixels.'
            elif suffix in ('.svg', '.eps', '.pdf'):
                warning = 'Listed only; no SVG, EPS or PDF member conversion is performed.'
            blobs[file_digest] = content
            members.append(SourceMember(member_id, name, file_digest, len(content), kind, line_count, structures, preview, warning, preview_sha, width, height, original_width, original_height, width, height))

        try:
            archive = tarfile.open(fileobj=io.BytesIO(unpacked), mode='r:')
        except tarfile.ReadError:
            if len(unpacked) > MAX_TEXT:
                raise Invalid('Single source text exceeds 2 MiB', 413)
            # A text response is a TeX representation only with literal TeX syntax.
            if not re.search(rb'\\(?:documentclass\b|begin\s*\{document\}|def\b|input\b)', unpacked):
                return cls(archive_digest, format, 'no_tex', ()), {}, {}
            add('source.tex', unpacked)
            return cls(archive_digest, format + '-tex', 'source_available' if members[0].kind == 'tex' else 'no_tex', tuple(members)), blobs, previews
        total, count = 0, 0
        with archive:
            for entry in archive:
                count += 1
                if count > MAX_MEMBERS:
                    raise Invalid('Source package exceeds 1,024 members', 413)
                name = entry.name
                if '\\' in name or name.startswith('/') or ':' in name or any(part == '..' for part in name.split('/')):
                    raise Invalid('Unsafe source member path')
                parts = tuple(part for part in name.split('/') if part not in ('', '.'))
                if not parts or len(parts) > 16 or any(ord(c) < 32 or ord(c) == 127 for c in name):
                    raise Invalid('Unsafe source member path or depth')
                name = '/'.join(parts)
                if name in names:
                    raise Invalid('Duplicate source member path')
                names.add(name)
                if entry.issparse() or any('sparse' in key.lower() for key in entry.pax_headers) or not (entry.isfile() or entry.isdir()):
                    raise Invalid('Only regular files and directories are allowed in source packages')
                if entry.isdir():
                    continue
                total += entry.size
                if entry.size < 0 or total > MAX_EXPANDED:
                    raise Invalid('Source expansion exceeds 64 MiB', 413)
                with archive.extractfile(entry) as stream:
                    content = stream.read(entry.size + 1)
                if len(content) != entry.size:
                    raise Invalid('Truncated source member')
                add(name, content)
        status = 'source_available' if any(m.kind == 'tex' for m in members) else 'no_tex'
        return cls(archive_digest, 'tar.gz' if format == 'gzip' else 'tar', status, tuple(members)), blobs, previews


def safe_preview(content):
    """Called only inside the bounded acquisition/repair child for product reads."""
    from PIL import Image
    with Image.open(io.BytesIO(content)) as image:
        if image.format not in ('PNG', 'JPEG', 'WEBP') or image.width * image.height > 20_000_000 or image.width < 1 or image.height < 1:
            raise Invalid('Raster image is unsupported or above 20 megapixels')
        image.load()
        original_width, original_height = image.width, image.height
        image.thumbnail((1600, 1600))
        output = io.BytesIO()
        with image.convert('RGB') as converted:
            converted.save(output, format='PNG')
        value = output.getvalue()
        if len(value) > 4 * 1024 * 1024:
            raise Invalid('Source image preview exceeds 4 MiB', 413)
        return value, image.width, image.height, original_width, original_height
