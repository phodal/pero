"""Frozen source-only project boundary. No YAML, bibliography, filesystem or effects."""
from dataclasses import dataclass
import json
import re
from document import fields, block_id

MAX_FILES = 32
MAX_RESOURCE_BYTES = 256 * 1024
MAX_TEXT_BYTES = 1024 * 1024
MAX_WIRE_BYTES = 8 * 1024 * 1024
MAX_PATH_BYTES = 1024
MAX_PERSISTED_BYTES = 1536 * 1024


def utf8_size(value):
    if not isinstance(value, str):
        raise ValueError('MyST resource must be text')
    try:
        return len(value.encode('utf-8'))
    except UnicodeEncodeError as error:
        raise ValueError('MyST text must contain Unicode scalar values') from error


def validate_persisted_contribution(text):
    # Same escaped UTF-8 scalar that NotebookDocument.serialized persists.
    if utf8_size(json.dumps(text, ensure_ascii=False)) > MAX_PERSISTED_BYTES:
        raise ValueError('MyST snapshot exceeds the 1536 KiB persisted contribution budget after JSON escaping; reduce resources or formatting. The Notebook total remains limited to 2 MiB.')


def canonical_path(value):
    if not isinstance(value, str) or not value or utf8_size(value) > MAX_PATH_BYTES:
        raise ValueError('Invalid MyST resource path')
    if re.search(r'[\\:?#\x00-\x1f\x7f]', value) or any(part in ('', '.', '..') for part in value.split('/')):
        raise ValueError('MyST paths must be canonical root-relative paths')
    return value


@dataclass(frozen=True)
class MystTextResource:
    path: str
    text: str


@dataclass(frozen=True)
class MystProjectSnapshot:
    entry: str
    files: tuple[MystTextResource, ...]

    @classmethod
    def from_wire(cls, value):
        if not isinstance(value, dict) or set(value) != {'format', 'version', 'entry', 'files'} or value['format'] != 'pero-myst-project' or type(value['version']) not in (int, float) or value['version'] != 1:
            raise ValueError('Unsupported MyST project snapshot')
        entry = canonical_path(value['entry'])
        if not re.search(r'\.(md|myst)$', entry, re.IGNORECASE):
            raise ValueError('MyST entry must name a Markdown resource')
        resources = value['files']
        if not isinstance(resources, list) or not 1 <= len(resources) <= MAX_FILES:
            raise ValueError('MyST projects require 1–32 text resources')
        files, paths, total = [], set(), 0
        for resource in resources:
            if not isinstance(resource, dict) or set(resource) != {'path', 'text'}:
                raise ValueError('Invalid MyST text resource')
            path = canonical_path(resource['path'])
            if path in paths:
                raise ValueError('Duplicate MyST resource')
            paths.add(path)
            size = utf8_size(resource['text'])
            total += size
            if size > MAX_RESOURCE_BYTES or total > MAX_TEXT_BYTES:
                raise ValueError('MyST text budget exceeded')
            files.append(MystTextResource(path, resource['text']))
        if entry not in paths:
            raise ValueError('MyST entry resource is missing')
        snapshot = cls(entry, tuple(files))
        canonical = json.dumps({'format': 'pero-myst-project', 'version': 1, 'entry': entry,
                                'files': [{'path': file.path, 'text': file.text} for file in files]},
                               ensure_ascii=False, indent=2) + '\n'
        validate_persisted_contribution(canonical)
        return snapshot

    @classmethod
    def parse(cls, attrs):
        fields(attrs, {'blockId', 'schemaVersion', 'snapshot'}, {'templateOrigin'})
        block_id(attrs['blockId'])
        if type(attrs['schemaVersion']) is not int or attrs['schemaVersion'] != 1:
            raise ValueError('Unsupported MyST project block version')
        if utf8_size(attrs['snapshot']) > MAX_WIRE_BYTES:
            raise ValueError('MyST project wire exceeds 8 MiB')
        validate_persisted_contribution(attrs['snapshot'])
        try:
            value = json.loads(attrs['snapshot'])
        except (ValueError, RecursionError) as error:
            raise ValueError('Invalid MyST project JSON') from error
        return cls.from_wire(value)
