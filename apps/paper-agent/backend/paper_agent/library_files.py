"""Copies a saved paper's PDF and TeX source into ~/.pero/paper."""
from pathlib import Path
import os
import re
import tempfile

from .model import Invalid
from .pdf_files import arxiv_identifier


def paper_directory(root=None):
    if root is None:
        configured = os.environ.get('PERO_PAPER_DIR', '').strip()
        if configured:
            path = Path(configured).expanduser()
        else:
            home = Path(os.environ.get('PERO_HOME', str(Path.home() / '.pero'))).expanduser()
            path = home / 'paper'
    else:
        path = Path(root)
    path.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise Invalid('Paper directory must not be a symbolic link', 409)
    return path


def file_stem(paper):
    identifier = arxiv_identifier(paper)
    if identifier:
        raw = identifier
    else:
        title = re.sub(r'[^A-Za-z0-9._-]+', '-', paper.title).strip('.-')[:40]
        raw = f'{title}-{paper.id[:8]}' if title else paper.id[:8]
    cleaned = re.sub(r'[^A-Za-z0-9._-]+', '-', raw).strip('.-')[:80]
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,80}', cleaned):
        raise Invalid('Invalid paper file name')
    return cleaned


def write_copy(directory, name, data):
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,120}', name):
        raise Invalid('Invalid paper file name')
    target = directory / name
    if target.is_symlink():
        raise Invalid('Paper file must not be a symbolic link', 409)
    descriptor, temporary = tempfile.mkstemp(dir=directory)
    try:
        with os.fdopen(descriptor, 'wb') as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return target


def publish(store, pdf_files, paper, now, root=None):
    document = store.paper_pdf(paper.id)
    if document is None:
        if not paper.pdf_url:
            raise Invalid('This paper has no PDF to download')
        content = pdf_files.download(paper)
        document = store.save_pdf(pdf_files.inspect(paper, content, now), content)
    else:
        content = store.pdf_bytes(document)
    tex, tex_note = None, ''
    if arxiv_identifier(paper):
        try:
            tex = pdf_files.download_source(paper)
        except Invalid as error:
            tex_note = error.detail
        if tex is None and not tex_note:
            tex_note = 'no-tex'
    directory = paper_directory(root)
    stem = file_stem(paper)
    saved = {'pdf': str(write_copy(directory, stem + '.pdf', content))}
    if tex is not None:
        saved['tex'] = str(write_copy(directory, stem + '-src.tar.gz', tex))
    if tex_note:
        saved['texNote'] = tex_note
    return saved


def locate_passage(store, pdf_files, value):
    if not isinstance(value, dict):
        raise Invalid('Invalid passage location')
    document = store.pdf(value.get('documentId'))
    page_number, start, quote = value.get('page'), value.get('start'), value.get('quote')
    if type(page_number) is not int or type(start) is not int or not isinstance(quote, str):
        raise Invalid('Invalid passage location')
    if not quote or len(quote) > 8000 or start < 0:
        raise Invalid('Invalid passage location')
    page = document.page(page_number)
    if page.text[start:start + len(quote)] != quote:
        raise Invalid('Passage does not match this PDF page')
    anchor = pdf_files.locate_anchor(store.pdf_bytes(document), document, {
        'fileDigest': document.file_digest, 'page': page_number, 'start': start, 'end': start + len(quote),
    })
    return {'rects': anchor.get('rects', [])}
