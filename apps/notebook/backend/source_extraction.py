"""Pinned derived text, distinct from original bytes and unverified scientific evidence."""
from dataclasses import dataclass
from hashlib import sha256
import math
import re

from attachment import AttachmentFile

MAX_TEXT_BYTES = 128 * 1024
PDF = 'application/pdf'
IMAGES = {'image/png', 'image/jpeg', 'image/webp'}
OFFICE = {
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
}


def fields(value, keys):
    if not isinstance(value, dict) or value.keys() != keys:
        raise ValueError('Invalid source extraction fields')


def scalar_text(value, limit, name):
    if not isinstance(value, str) or len(value) > limit or re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', value):
        raise ValueError(f'Invalid {name}')
    try:
        size = len(value.encode('utf-8'))
    except UnicodeEncodeError as error:
        raise ValueError(f'Invalid Unicode in {name}') from error
    if size > limit:
        raise ValueError(f'{name} exceeds the byte limit; choose a smaller source or page')
    return value


def integer(value, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError('Invalid extraction count or range')
    return value


@dataclass(frozen=True)
class ExtractionRequest:
    file: AttachmentFile
    mode: str
    page: int

    @classmethod
    def parse(cls, value):
        fields(value, {'file', 'mode', 'page'})
        file = AttachmentFile.parse(value['file'])
        if not file.raw:
            raise ValueError('Source is empty')
        if file.mime not in {PDF, *IMAGES, *OFFICE}:
            raise ValueError('Use PDF, PNG, JPEG, WebP, DOCX, XLSX or PPTX. Legacy Office files must be converted explicitly.')
        if value['mode'] not in ('native', 'ocr'):
            raise ValueError('Choose native text or explicit OCR')
        if file.mime in OFFICE and value['mode'] != 'native':
            raise ValueError('Office extraction reads stored text, not OCR. Export scanned pages as PDF or images.')
        if file.mime in IMAGES and value['mode'] != 'ocr':
            raise ValueError('Images require explicit OCR')
        page = integer(value['page'], 1, 500)
        if file.mime != PDF and page != 1:
            raise ValueError('Page selection applies only to PDFs')
        return cls(file, value['mode'], page)


@dataclass(frozen=True)
class SourceExtraction:
    value: dict

    @classmethod
    def parse(cls, value, text, original_digest=None):
        fields(value, {'version', 'original', 'parser', 'method', 'textSha256', 'segments', 'limitations'})
        if type(value['version']) is not int or value['version'] != 1 or value['method'] not in ('native', 'ocr'):
            raise ValueError('Invalid extraction version or method')
        fields(value['original'], {'sha256', 'bytes'})
        original = value['original']
        if not isinstance(original['sha256'], str) or not re.fullmatch(r'[a-f0-9]{64}', original['sha256']):
            raise ValueError('Invalid original source digest')
        if original_digest is not None and original['sha256'] != original_digest:
            raise ValueError('Extraction belongs to different original bytes')
        integer(original['bytes'], 1, 512 * 1024)
        fields(value['parser'], {'name', 'version'})
        for key in ('name', 'version'):
            if not scalar_text(value['parser'][key], 100, 'parser identity'):
                raise ValueError('Missing parser identity')
        scalar_text(text, MAX_TEXT_BYTES, 'Extracted text')
        if not text or sha256(text.encode()).hexdigest() != value['textSha256']:
            raise ValueError('Extracted text digest does not match the retained text')
        segments = value['segments']
        if not isinstance(segments, list) or not 1 <= len(segments) <= 4096:
            raise ValueError('Invalid extraction provenance')
        previous = 0
        for segment in segments:
            fields(segment, {'start', 'end', 'page', 'part', 'region', 'score'})
            start = integer(segment['start'], previous, len(text))
            previous = integer(segment['end'], start + 1, len(text))
            if segment['page'] is not None:
                integer(segment['page'], 1, 500)
            if not scalar_text(segment['part'], 255, 'source part'):
                raise ValueError('Missing source part')
            region = segment['region']
            if region is not None:
                fields(region, {'x', 'y', 'width', 'height'})
                if any(type(n) not in (int, float) or not math.isfinite(n) or not 0 <= n <= 1 for n in region.values()) or region['width'] <= 0 or region['height'] <= 0 or region['x'] + region['width'] > 1.0000001 or region['y'] + region['height'] > 1.0000001:
                    raise ValueError('Invalid normalized top-left source region')
            score = segment['score']
            if score is not None and (value['method'] != 'ocr' or type(score) not in (int, float) or not math.isfinite(score) or not -1 <= score <= 100):
                raise ValueError('Invalid raw OCR score')
        if not isinstance(value['limitations'], list) or not 1 <= len(value['limitations']) <= 10:
            raise ValueError('Missing extraction limitations')
        for limitation in value['limitations']:
            scalar_text(limitation, 500, 'extraction limitation')
        return cls(value)

    @classmethod
    def create(cls, request, parser, version, parts, limitations):
        text, segments = '', []
        for part_text, page, part, region, score in parts:
            if not part_text:
                continue
            if text:
                text += '\n'
            start = len(text)
            text += part_text
            segments.append(dict(start=start, end=len(text), page=page, part=part, region=region, score=score))
            if len(text.encode()) > MAX_TEXT_BYTES or len(segments) > 4096:
                raise ValueError('Extraction exceeds 128 KiB or 4096 parts. Choose a smaller file; nothing is truncated.')
        if not text.strip():
            raise ValueError('No readable text was found. For a scanned PDF, explicitly choose OCR and verify the original page.')
        value = dict(version=1, original=dict(sha256=request.file.sha256, bytes=len(request.file.raw)),
                     parser=dict(name=parser, version=version), method=request.mode,
                     textSha256=sha256(text.encode()).hexdigest(), segments=segments, limitations=limitations)
        return dict(text=text, extraction=cls.parse(value, text).value)
