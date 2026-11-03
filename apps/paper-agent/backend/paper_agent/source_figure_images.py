"""Bounded PDF-figure previews; originals and existing archive indexes stay immutable."""
from contextlib import closing
from dataclasses import asdict, dataclass
import io
import json
import math
from pathlib import Path
import tempfile
import threading

from .acquisition_worker import acquire_bounded
from .model import ID, Invalid, digest

RENDERER = 'pdfium-figure-v1'


@dataclass(frozen=True)
class FigurePreview:
    memberId: str
    originalSha256: str
    previewSha256: str
    width: int
    height: int
    renderer: str = RENDERER

    @classmethod
    def parse(cls, value):
        if (not isinstance(value, dict) or set(value) != {'memberId', 'originalSha256', 'previewSha256', 'width', 'height', 'renderer'}
                or any(not isinstance(value[k], str) or not ID.fullmatch(value[k]) for k in ('memberId', 'originalSha256', 'previewSha256'))
                or any(type(value[k]) is not int or not 1 <= value[k] <= 1600 for k in ('width', 'height'))
                or value['renderer'] != RENDERER):
            raise Invalid('PDF figure preview metadata is invalid', 409)
        return cls(**value)


def render_figure(output, directory, original):
    from .pdf_files import PdfFiles
    pdfium = PdfFiles()._engine()
    with closing(pdfium.PdfDocument(original)) as pdf:
        if len(pdf) != 1:
            raise Invalid('Choose a single-page PDF figure; multi-page documents are not inferred to be figures', 422)
        with closing(pdf[0]) as page:
            longest = max(page.get_size())
            if not math.isfinite(longest) or longest <= 0:
                raise Invalid('PDF figure dimensions are invalid', 422)
            with closing(page.render(scale=min(2, 1600 / longest))) as bitmap:
                with bitmap.to_pil() as image, image.convert('RGB') as rgb:
                    data = io.BytesIO()
                    rgb.save(data, format='PNG')
                    image_bytes = data.getvalue()
                    if len(image_bytes) > 4 * 1024 * 1024:
                        raise Invalid('PDF figure preview exceeds 4 MiB', 413)
                    (Path(directory) / 'preview.png').write_bytes(image_bytes)
                    output.send(('figure_complete', rgb.width, rgb.height, digest(image_bytes)))


def figure_image(store, member, *, render=True):
    if not member.path.lower().endswith('.pdf'):
        raise Invalid('Choose a safe raster preview or a single-page PDF figure')
    original = (store.root / 'source-members' / (member.sha256 + '.bin')).read_bytes()
    if digest(original) != member.sha256:
        raise Invalid('Original PDF figure integrity check failed', 409)
    records = store.root / 'source-figure-previews'
    metadata = records / (member.id + '.json')
    image_path = records / (member.id + '.png')
    if metadata.is_file() and image_path.is_file():
        preview = FigurePreview.parse(json.loads(metadata.read_bytes()))
        if (preview.memberId, preview.originalSha256) != (member.id, member.sha256):
            raise Invalid('PDF figure preview belongs to another source', 409)
        image = image_path.read_bytes()
        if len(image) > 4 * 1024 * 1024 or digest(image) != preview.previewSha256:
            raise Invalid('PDF figure preview integrity check failed', 409)
        return preview, image
    if not render:
        raise Invalid('PDF figure preview is unavailable', 409)
    with tempfile.TemporaryDirectory(prefix='pero-paper-figure-') as directory:
        result = acquire_bounded(render_figure, (directory, original), threading.Event(), 20, lambda stage: None)
        if result[0] != 'figure_complete':
            raise Invalid(result[1], 422)
        preview = FigurePreview.parse(dict(memberId=member.id, originalSha256=member.sha256,
            previewSha256=result[3], width=result[1], height=result[2], renderer=RENDERER))
        image = (Path(directory) / 'preview.png').read_bytes()
        records.mkdir(parents=True, exist_ok=True)
        image_path.write_bytes(image)
        store.imports._replace('source-figure-previews', member.id, asdict(preview))
        return preview, image
