"""Explicit raster header admission; not a full image decoder or network loader."""
import base64 as encoding
import binascii
import re
from dataclasses import dataclass

MAX_ASSET_BYTES = 256 * 1024
MAX_IMAGE_DIMENSION = 4096
MAX_IMAGE_PIXELS = 16 * 1024 * 1024


@dataclass(frozen=True)
class MystImageData:
    media_type: str
    base64: str
    byte_length: int
    renderable: bool
    width: int | None = None
    height: int | None = None

    @classmethod
    def parse(cls, media_type, base64):
        if not isinstance(media_type, str) or not re.fullmatch(r'[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*', media_type):
            raise ValueError('Invalid asset media type')
        if not isinstance(base64, str) or len(base64) > ((MAX_ASSET_BYTES + 2) // 3) * 4:
            raise ValueError('Invalid or oversized asset base64')
        try:
            data = encoding.b64decode(base64, validate=True)
        except (ValueError, binascii.Error) as error:
            raise ValueError('Invalid asset base64') from error
        if encoding.b64encode(data).decode() != base64 or len(data) > MAX_ASSET_BYTES:
            raise ValueError('Asset base64 must be canonical and at most 256 KiB')
        width = height = None
        def integer(offset, length):
            if offset + length > len(data):
                raise ValueError('Truncated image header')
            return int.from_bytes(data[offset:offset + length], 'big')
        if media_type == 'image/png':
            if len(data) < 45 or data[:8] != b'\x89PNG\r\n\x1a\n':
                raise ValueError('PNG signature mismatch')
            offset, has_data, end = 8, False, False
            while offset + 12 <= len(data):
                length = integer(offset, 4)
                kind = data[offset + 4:offset + 8]
                if length > len(data) - offset - 12:
                    raise ValueError('Invalid PNG chunk length')
                if offset == 8:
                    if kind != b'IHDR' or length != 13:
                        raise ValueError('PNG requires first IHDR')
                    width, height = integer(offset + 8, 4), integer(offset + 12, 4)
                    if data[offset + 17] not in (0, 2, 3, 4, 6) or data[offset + 16] not in (1, 2, 4, 8, 16) or data[offset + 18] != 0 or data[offset + 19] != 0 or data[offset + 20] > 1:
                        raise ValueError('Invalid PNG header')
                elif kind == b'IHDR':
                    raise ValueError('Duplicate PNG header')
                if kind == b'IDAT':
                    has_data = True
                offset += length + 12
                if kind == b'IEND':
                    if length != 0 or offset != len(data):
                        raise ValueError('Invalid PNG end')
                    end = True
                    break
            if not has_data or not end:
                raise ValueError('Incomplete PNG structure')
        elif media_type == 'image/jpeg':
            if len(data) < 12 or data[:2] != b'\xff\xd8' or data[-2:] != b'\xff\xd9':
                raise ValueError('JPEG signature mismatch')
            offset, scan = 2, False
            while offset + 4 <= len(data):
                if data[offset] != 255:
                    raise ValueError('Invalid JPEG marker')
                offset += 1
                while offset < len(data) and data[offset] == 255:
                    offset += 1
                if offset >= len(data):
                    raise ValueError('Invalid JPEG marker')
                marker = data[offset]
                offset += 1
                length = integer(offset, 2)
                if length < 2 or offset + length > len(data):
                    raise ValueError('Invalid JPEG segment')
                if marker in (192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207):
                    if length < 8 or width is not None:
                        raise ValueError('Invalid JPEG frame')
                    height, width = integer(offset + 3, 2), integer(offset + 5, 2)
                if marker == 218:
                    scan = True
                    break
                offset += length
            if not scan or width is None:
                raise ValueError('Incomplete JPEG structure')
        if width is not None and (width < 1 or not height or width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION or width * height > MAX_IMAGE_PIXELS):
            raise ValueError('Image dimensions exceed the bounded raster budget')
        return cls(media_type, base64, len(data), width is not None, width, height)


@dataclass(frozen=True)
class MystBinaryAsset:
    path: str
    data: MystImageData

    def wire(self):
        return {'path': self.path, 'mediaType': self.data.media_type, 'base64': self.data.base64}
