"""Revision-embedded bytes and bounded, locally recorded image derivation history."""
from dataclasses import dataclass
from hashlib import sha256
import base64
import binascii
import re

MAX_FILE_BYTES = 512 * 1024
MAX_HISTORY_BYTES = 512 * 1024
MAX_HISTORY_STEPS = 8
RASTER_SIDE = 8192
RASTER_PIXELS = 16_777_216
PREVIEW_TYPES = {'image/png', 'image/jpeg', 'image/webp'}
FILE_FIELDS = {'filename', 'mime', 'data', 'sha256'}


def fields(value, required):
    if not isinstance(value, dict) or value.keys() != required:
        raise ValueError('Invalid image history fields')


def integer(value, maximum, minimum=1):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError('Invalid image dimensions')
    return value


@dataclass(frozen=True)
class AttachmentFile:
    filename: str
    mime: str
    data: str
    sha256: str
    raw: bytes

    @classmethod
    def parse(cls, value):
        fields(value, FILE_FIELDS)
        filename = value['filename']
        if (not isinstance(filename, str) or not filename.strip() or len(filename) > 255
                or filename in {'.', '..'} or re.search(r'[\x00-\x1f\x7f/\\]', filename)):
            raise ValueError('Invalid attachment filename')
        mime = value['mime']
        if (not isinstance(mime, str) or len(mime) > 127
                or not re.fullmatch(r'[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*', mime)):
            raise ValueError('Invalid attachment MIME type')
        if mime.startswith('image/') and mime not in PREVIEW_TYPES:
            raise ValueError('Unsupported image type')
        data = value['data']
        if not isinstance(data, str) or len(data) > 4 * ((MAX_FILE_BYTES + 2) // 3):
            raise ValueError('Invalid attachment data')
        try:
            raw = base64.b64decode(data, validate=True)
        except (ValueError, binascii.Error) as error:
            raise ValueError('Invalid attachment base64') from error
        if len(raw) > MAX_FILE_BYTES or base64.b64encode(raw).decode() != data:
            raise ValueError('Invalid attachment size or base64')
        if value['sha256'] != sha256(raw).hexdigest():
            raise ValueError('Attachment digest does not match its bytes')
        return cls(filename, mime, data, value['sha256'], raw)


@dataclass(frozen=True)
class RasterEdit:
    x: int
    y: int
    width: int
    height: int
    output_width: int
    output_height: int
    rotation: int

    @classmethod
    def parse(cls, value, width, height):
        fields(value, {'x', 'y', 'width', 'height', 'outputWidth', 'outputHeight', 'rotation'})
        integer(width, RASTER_SIDE)
        integer(height, RASTER_SIDE)
        crop_width, crop_height, output_width, output_height = (
            integer(value[key], RASTER_SIDE) for key in ('width', 'height', 'outputWidth', 'outputHeight'))
        x, y = (integer(value[key], RASTER_SIDE, 0) for key in ('x', 'y'))
        rotation = integer(value['rotation'], 270, 0)
        if (rotation not in (0, 90, 180, 270) or x + crop_width > width or y + crop_height > height
                or width * height > RASTER_PIXELS or output_width * output_height > RASTER_PIXELS):
            raise ValueError('Invalid crop, rotation or output dimensions')
        return cls(x, y, crop_width, crop_height, output_width, output_height, rotation)

    @property
    def output_size(self):
        return ((self.output_height, self.output_width) if self.rotation % 180
                else (self.output_width, self.output_height))


@dataclass(frozen=True)
class ImageDerivationStep:
    source: AttachmentFile
    source_width: int
    source_height: int
    edit: RasterEdit
    output_sha256: str


@dataclass(frozen=True)
class ImageDerivation:
    """Hash integrity and chain consistency, not replay proof or external attestation."""
    steps: tuple[ImageDerivationStep, ...]

    @classmethod
    def parse(cls, value, output):
        fields(value, {'version', 'steps'})
        if (type(value['version']) is not int or value['version'] != 1 or output.mime != 'image/png'
                or not isinstance(value['steps'], list) or not 1 <= len(value['steps']) <= MAX_HISTORY_STEPS):
            raise ValueError('Invalid image history version or length')
        steps = []
        retained_bytes = 0
        for item in value['steps']:
            fields(item, {'source', 'sourceWidth', 'sourceHeight', 'edit', 'outputSha256'})
            source = AttachmentFile.parse(item['source'])
            if source.mime not in PREVIEW_TYPES:
                raise ValueError('Image history requires raster sources')
            edit = RasterEdit.parse(item['edit'], item['sourceWidth'], item['sourceHeight'])
            digest = item['outputSha256']
            if not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest):
                raise ValueError('Invalid image history output digest')
            retained_bytes += len(source.raw)
            if retained_bytes > MAX_HISTORY_BYTES:
                raise ValueError('Retained image sources exceed 512 KiB')
            if steps and (source.sha256 != steps[-1].output_sha256 or source.mime != 'image/png'
                          or (item['sourceWidth'], item['sourceHeight']) != steps[-1].edit.output_size):
                raise ValueError('Image history chain does not match its source')
            steps.append(ImageDerivationStep(source, item['sourceWidth'], item['sourceHeight'], edit, digest))
        if steps[-1].output_sha256 != output.sha256:
            raise ValueError('Image history does not match its output')
        return cls(tuple(steps))


def attachment(value):
    """The document owner checks the outer fields; this owner verifies file/history content."""
    output = AttachmentFile.parse({key: value[key] for key in FILE_FIELDS})
    caption = value['caption']
    if not isinstance(caption, str) or len(caption) > 2000:
        raise ValueError('Invalid attachment caption')
    if value.get('derivation') is not None:
        ImageDerivation.parse(value['derivation'], output)
