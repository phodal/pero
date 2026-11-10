"""Notebook-owned published template revisions in the existing entry database."""
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import math
import re
import sqlite3
from uuid import uuid4

from document import NotebookDocument, block_id, fields, integer, nodes, string
from store import RevisionConflict


class MissingTemplate(Exception):
    pass


@dataclass(frozen=True)
class TemplateParameter:
    key: str
    label: str
    kind: str
    required: bool
    target: dict
    default: str | float | bool | None

    @classmethod
    def parse(cls, value, document, template_kind):
        fields(value, {'key', 'label', 'type', 'required', 'target'}, {'default'})
        key = block_id(value['key'])
        label = string(value['label'], 'parameter label', 200, required=True)
        kind = value['type']
        if kind not in ('text', 'decimal', 'boolean') or type(value['required']) is not bool:
            raise ValueError('Invalid template parameter type')
        target = value['target']
        if not isinstance(target, dict):
            raise ValueError('Invalid parameter target')
        target_kind = target.get('kind')
        if target_kind == 'title':
            fields(target, {'kind'})
            if template_kind != 'entry' or kind != 'text':
                raise ValueError('Only entry text parameters may bind the title')
        else:
            fields(target, {'kind', 'blockId'}, {'field'} if target_kind == 'block-attribute' else {'address'} if target_kind == 'spreadsheet-cell' else ())
            node = document.block(block_id(target['blockId']))
            if node is None:
                raise ValueError('Stale parameter block binding')
            if target_kind == 'block-text':
                if kind != 'text' or node['type'] not in ('paragraph', 'heading', 'codeBlock'):
                    raise ValueError('Unsupported block text binding')
            elif target_kind == 'block-attribute':
                allowed = {'section': ('label',), 'spreadsheet': ('label',), 'evidence': ('label',),
                           'experiment': ('label',), 'finding': ('claim', 'limitations'),
                           'attachment': ('caption',), 'taskItem': ('checked',)}
                field = target.get('field')
                if field not in allowed.get(node['type'], ()) or kind != ('boolean' if field == 'checked' else 'text'):
                    raise ValueError('Unsupported typed attribute binding')
            elif target_kind == 'spreadsheet-cell':
                address = target.get('address')
                match = re.fullmatch(r'([A-Z]{1,2})([1-9][0-9]{0,2})', address) if isinstance(address, str) else None
                if node['type'] != 'spreadsheet' or match is None:
                    raise ValueError('Invalid cell parameter binding')
                sheet = node['attrs']['sheet']
                column = 0
                for letter in match[1]:
                    column = column * 26 + ord(letter) - 64
                if column > sheet['columns'] or int(match[2]) > sheet['rows'] or sheet['cells'].get(address, '').startswith('='):
                    raise ValueError('Stale, invalid or calculated cell binding')
            else:
                raise ValueError('Unknown template parameter binding')
        parameter = cls(key, label, kind, value['required'], target, value.get('default'))
        if 'default' in value:
            parameter.validate(value['default'])
        return parameter

    def validate(self, value):
        if self.kind == 'text':
            limit = 200 if self.target['kind'] == 'title' or self.target.get('field') == 'label' else 2000 if self.target.get('field') == 'caption' else 4095 if self.target['kind'] == 'spreadsheet-cell' else 32768
            string(value, 'parameter value', limit, required=self.required or self.target['kind'] == 'title')
        elif self.kind == 'boolean':
            if type(value) is not bool:
                raise ValueError('Boolean parameter requires a boolean')
        elif type(value) not in (int, float) or not math.isfinite(value):
            raise ValueError('Decimal parameter requires a finite number')

    def wire(self):
        result = dict(key=self.key, label=self.label, type=self.kind, required=self.required, target=self.target)
        if self.default is not None:
            result['default'] = self.default
        return result


@dataclass(frozen=True)
class TemplateDefinition:
    name: str
    description: str
    kind: str
    collections: tuple[str, ...]
    document: NotebookDocument
    parameters: tuple[TemplateParameter, ...]

    @classmethod
    def parse(cls, value):
        fields(value, {'name', 'description', 'kind', 'collections', 'document', 'parameters'})
        name = string(value['name'], 'template name', 200, required=True)
        description = string(value['description'], 'template description', 2000)
        if value['kind'] not in ('entry', 'fragment'):
            raise ValueError('Invalid template kind')
        collections = value['collections']
        if not isinstance(collections, list) or len(collections) > 20:
            raise ValueError('Invalid template collections')
        collections = tuple(string(item, 'collection label', 100, required=True) for item in collections)
        if len(set(collections)) != len(collections):
            raise ValueError('Duplicate collection label')
        document = NotebookDocument.parse(value['document'])
        parameters = value['parameters']
        if not isinstance(parameters, list) or len(parameters) > 50:
            raise ValueError('Invalid template parameters')
        parameters = tuple(TemplateParameter.parse(item, document, value['kind']) for item in parameters)
        if len({item.key for item in parameters}) != len(parameters) or len({json.dumps(item.target, sort_keys=True) for item in parameters}) != len(parameters):
            raise ValueError('Duplicate parameter key or target')
        return cls(name, description, value['kind'], collections, document, parameters)

    def wire(self):
        return dict(name=self.name, description=self.description, kind=self.kind, collections=list(self.collections),
                    document=self.document.wire(), parameters=[item.wire() for item in self.parameters])


def parse_template_origin(value):
    """Portable lineage, not a claim of external authentication or template availability."""
    fields(value, {'templateId', 'revision', 'instanceId', 'parameterValues', 'idMap'})
    block_id(value['templateId'])
    block_id(value['instanceId'])
    integer(value['revision'], 'template revision')
    parameters = value['parameterValues']
    if not isinstance(parameters, dict) or len(parameters) > 50:
        raise ValueError('Invalid template parameter lineage')
    for key, item in parameters.items():
        block_id(key)
        if isinstance(item, str):
            string(item, 'template parameter value')
        elif type(item) is bool:
            pass
        elif type(item) not in (int, float) or not math.isfinite(item):
            raise ValueError('Invalid template parameter lineage value')
    identities = value['idMap']
    if not isinstance(identities, dict) or len(identities) > 10000:
        raise ValueError('Invalid template identity mapping')
    for source, destination in identities.items():
        block_id(source)
        block_id(destination)
    if len(set(identities.values())) != len(identities):
        raise ValueError('Duplicate instantiated identity')
    return value


def preserve_template_origins(before, after):
    """Existing lineage cannot be edited in place; removing an instance is permitted."""
    def document_nodes(document):
        yield from nodes(document['content'])
        from workspace import NotebookProcedure
        for value in document.get('procedures', ()):
            for root in NotebookProcedure.parse(value).content_roots():
                yield from nodes(root)

    def origins(document):
        result = {}
        candidates = [document.get('templateOrigin')] + [node.get('attrs', {}).get('templateOrigin') for node in document_nodes(document)]
        for origin in candidates:
            if origin is not None:
                identity = origin['instanceId']
                if identity in result and result[identity] != origin:
                    raise ValueError('Conflicting template lineage')
                result[identity] = origin
        return result
    if before.get('templateOrigin') is not None and before['templateOrigin'] != after.get('templateOrigin'):
        raise ValueError('Entry template lineage is immutable')
    after_blocks = {node.get('attrs', {}).get('blockId'): node for node in document_nodes(after)}
    for node in document_nodes(before):
        attrs = node.get('attrs', {})
        if attrs.get('templateOrigin') is not None and attrs.get('blockId') in after_blocks:
            if after_blocks[attrs['blockId']].get('attrs', {}).get('templateOrigin') != attrs['templateOrigin']:
                raise ValueError('Block template lineage is immutable')
    previous, current = origins(before), origins(after)
    for identity in previous.keys() & current.keys():
        if previous[identity] != current[identity]:
            raise ValueError('Template lineage is immutable')


class TemplateStore:
    def __init__(self, entries):
        self.path = entries.path
        with closing(self._connect()) as connection, connection:
            connection.execute('''CREATE TABLE IF NOT EXISTS notebook_templates (
                template_id TEXT PRIMARY KEY, archived INTEGER NOT NULL DEFAULT 0)''')
            connection.execute('''CREATE TABLE IF NOT EXISTS notebook_template_revisions (
                template_id TEXT NOT NULL, revision INTEGER NOT NULL, published_at TEXT NOT NULL,
                definition TEXT NOT NULL, PRIMARY KEY(template_id, revision))''')

    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _wire(row, summary=False):
        definition = json.loads(row['definition'])
        if summary:
            definition.pop('document')
            definition.pop('parameters')
        return dict(id=row['template_id'], revision=row['revision'], publishedAt=row['published_at'], archived=bool(row['archived']), **definition)

    def list(self):
        with closing(self._connect()) as connection:
            rows = connection.execute('''SELECT r.*, t.archived FROM notebook_template_revisions r
                JOIN notebook_templates t USING(template_id) WHERE (r.template_id,r.revision) IN
                (SELECT template_id, MAX(revision) FROM notebook_template_revisions GROUP BY template_id)
                ORDER BY published_at DESC, template_id''')
            return [self._wire(row, summary=True) for row in rows]

    def read(self, identity, revision=None):
        with closing(self._connect()) as connection:
            return self._read(connection, identity, revision)

    def _read(self, connection, identity, revision=None):
        row = connection.execute('''SELECT r.*, t.archived FROM notebook_template_revisions r
            JOIN notebook_templates t USING(template_id) WHERE template_id = ? AND (? IS NULL OR revision = ?)
            ORDER BY revision DESC LIMIT 1''', (identity, revision, revision)).fetchone()
        if row is None:
            raise MissingTemplate('Template or revision not found')
        return self._wire(row)

    def publish(self, definition, identity=None, expected_revision=None):
        with closing(self._connect()) as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            revision = 1
            if identity is None:
                identity = uuid4().hex
                connection.execute('INSERT INTO notebook_templates VALUES (?, 0)', (identity,))
            else:
                current = self._read(connection, identity)
                if current['revision'] != expected_revision:
                    raise RevisionConflict(current['revision'])
                if current['archived']:
                    raise ValueError('Restore the archived template before publishing a revision')
                if current['kind'] != definition.kind:
                    raise ValueError('A template cannot change between entry and fragment')
                revision = current['revision'] + 1
            published = datetime.now(timezone.utc).isoformat(timespec='microseconds')
            connection.execute('INSERT INTO notebook_template_revisions VALUES (?, ?, ?, ?)',
                               (identity, revision, published, json.dumps(definition.wire(), ensure_ascii=False, allow_nan=False)))
            return self._read(connection, identity, revision)

    def archive(self, identity, archived):
        if type(archived) is not bool:
            raise ValueError('Archived must be boolean')
        with closing(self._connect()) as connection, connection:
            self._read(connection, identity)
            connection.execute('UPDATE notebook_templates SET archived = ? WHERE template_id = ?', (int(archived), identity))
            return self._read(connection, identity)
