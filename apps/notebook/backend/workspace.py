"""Local record metadata and human procedure notes, separate from Lab execution."""

from dataclasses import dataclass
import math
import re
from procedure_parameters import ProcedureParameter, parse_parameters


def text(value, name, maximum):
    if not isinstance(value, str) or len(value) > maximum:
        raise ValueError(f'Invalid {name}')
    return value


def identity(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', value):
        raise ValueError('Invalid procedure identity')
    return value


def shape(value, keys):
    if not isinstance(value, dict) or value.keys() != keys:
        raise ValueError('Invalid workspace fields')
    return value


def collection(value, maximum):
    if not isinstance(value, list) or len(value) > maximum:
        raise ValueError('Invalid workspace collection')
    return value


@dataclass(frozen=True)
class NotebookMetadata:
    project: str
    author: str
    tags: tuple[str, ...]

    @classmethod
    def parse(cls, value):
        shape(value, {'project', 'author', 'tags'})
        return cls(text(value['project'], 'project label', 200),
                   text(value['author'], 'author display name', 200),
                   tuple(text(tag, 'tag', 100) for tag in collection(value['tags'], 50)))

    def wire(self):
        return dict(project=self.project, author=self.author, tags=list(self.tags))


def claim_identity(value, identities):
    value = identity(value)
    if value in identities:
        raise ValueError('Duplicate procedure row identity')
    identities.add(value)
    return value


def rich_content(value, identities):
    # Exactly the Notes node/mark/file boundary, with shared global IDs.
    from document import _node
    _node(value, {'doc'}, identities)
    return value


@dataclass(frozen=True)
class MaterialSource:
    catalog_id: str
    record_id: str
    version: int
    schema_id: str
    schema_revision: int

    @classmethod
    def parse(cls, value):
        shape(value, {'source', 'catalogId', 'recordId', 'version', 'schemaId', 'schemaRevision'})
        if value['source'] != 'notebook-local-catalog' or any(
                type(value[key]) is not int or not 1 <= value[key] <= 2147483647
                for key in ('version', 'schemaRevision')):
            raise ValueError('Invalid material source')
        return cls(identity(value['catalogId']), identity(value['recordId']), value['version'],
                   identity(value['schemaId']), value['schemaRevision'])

    def wire(self):
        return dict(source='notebook-local-catalog', catalogId=self.catalog_id, recordId=self.record_id,
                    version=self.version, schemaId=self.schema_id, schemaRevision=self.schema_revision)


@dataclass(frozen=True)
class ProcedureMaterial:
    id: str
    name: str
    quantity: str
    source: MaterialSource | None = None
    content: dict | None = None
    children: tuple['ProcedureMaterial', ...] | None = None

    @classmethod
    def parse(cls, value, identities, budget, depth=1):
        required = {'id', 'name', 'quantity'}
        if not isinstance(value, dict) or not required <= value.keys() or value.keys() - required - {'source', 'content', 'children'}:
            raise ValueError('Invalid material fields')
        budget[0] += 1
        if depth > 4 or budget[0] > 100:
            raise ValueError('Material hierarchy exceeds limit')
        row_id = claim_identity(value['id'], identities)
        source = MaterialSource.parse(value['source']) if 'source' in value else None
        content = rich_content(value['content'], identities) if 'content' in value else None
        children = tuple(cls.parse(item, identities, budget, depth + 1) for item in collection(value['children'], 100)) if 'children' in value else None
        return cls(row_id, text(value['name'], 'material name', 200),
                   text(value['quantity'], 'material quantity', 200), source, content, children)

    def descendants(self):
        yield self
        for child in self.children or ():
            yield from child.descendants()

    def wire(self):
        return dict(id=self.id, name=self.name, quantity=self.quantity,
                    **({'source': self.source.wire()} if self.source else {}),
                    **({'content': self.content} if self.content is not None else {}),
                    **({'children': [item.wire() for item in self.children]} if self.children is not None else {}))


@dataclass(frozen=True)
class ProcedureStep:
    id: str
    text: str
    level: str
    critical: bool
    pause: bool
    minutes: float | None
    completed: bool
    kind: str | None = None
    content: dict | None = None
    timer: dict | None = None

    @classmethod
    def parse(cls, value, identities=None):
        required = {'id', 'text', 'level', 'critical', 'pause', 'minutes', 'completed'}
        if not isinstance(value, dict) or not required <= value.keys() or value.keys() - required - {'kind', 'content', 'timer'}:
            raise ValueError('Invalid procedure step fields')
        identities = identities if identities is not None else set()
        row_id = claim_identity(value['id'], identities)
        kind = value.get('kind')
        if 'kind' in value and kind not in ('header', 'step', 'description', 'image', 'table', 'timer'):
            raise ValueError('Invalid procedure step kind')
        content = value.get('content')
        if 'content' in value:
            rich_content(content, identities)
        timer = value.get('timer')
        if 'timer' in value:
            shape(timer, {'elapsedMs', 'startedAt'})
            if kind != 'timer' or type(timer['elapsedMs']) is not int or not 0 <= timer['elapsedMs'] <= 9007199254740991:
                raise ValueError('Invalid procedure elapsed time')
            if timer['startedAt'] is not None and (type(timer['startedAt']) is not int or not 0 <= timer['startedAt'] <= 9007199254740991):
                raise ValueError('Invalid procedure start time')
        if value['level'] not in ('step', 'section', 'substep'):
            raise ValueError('Invalid procedure step level')
        if any(type(value[key]) is not bool for key in ('critical', 'pause', 'completed')):
            raise ValueError('Invalid procedure step state')
        minutes = value['minutes']
        if minutes is not None and (type(minutes) not in (int, float)
                                    or not math.isfinite(minutes) or not 0 <= minutes <= 10080):
            raise ValueError('Invalid procedure timer duration')
        return cls(row_id, text(value['text'], 'procedure step', 32768),
                   value['level'], value['critical'], value['pause'], minutes, value['completed'], kind, content, timer)

    def wire(self):
        return dict(id=self.id, text=self.text, level=self.level, critical=self.critical,
                    pause=self.pause, minutes=self.minutes, completed=self.completed,
                    **({'kind': self.kind} if self.kind is not None else {}),
                    **({'content': self.content} if self.content is not None else {}),
                    **({'timer': self.timer} if self.timer is not None else {}))


@dataclass(frozen=True)
class NotebookProcedure:
    id: str
    title: str
    description: str
    materials: tuple[ProcedureMaterial, ...]
    steps: tuple[ProcedureStep, ...]
    introduction: dict | None = None
    parameters: tuple[ProcedureParameter, ...] | None = None

    @classmethod
    def parse(cls, value, identities=None):
        required = {'id', 'title', 'description', 'materials', 'steps'}
        if not isinstance(value, dict) or not required <= value.keys() or value.keys() - required - {'introduction', 'parameters'}:
            raise ValueError('Invalid procedure fields')
        identities = identities if identities is not None else set()
        row_id = claim_identity(value['id'], identities)
        introduction = rich_content(value['introduction'], identities) if 'introduction' in value else None
        budget = [0]
        materials = tuple(ProcedureMaterial.parse(item, identities, budget) for item in collection(value['materials'], 100))
        steps = tuple(ProcedureStep.parse(item, identities) for item in collection(value['steps'], 500))
        parameters = parse_parameters(value['parameters'], identities) if 'parameters' in value else None
        return cls(row_id, text(value['title'], 'procedure title', 200),
                   text(value['description'], 'procedure description', 32768), materials, steps, introduction, parameters)

    def content_roots(self):
        if self.introduction is not None:
            yield self.introduction
        for material in self.materials:
            for item in material.descendants():
                if item.content is not None:
                    yield item.content
        for step in self.steps:
            if step.content is not None:
                yield step.content

    def wire(self):
        return dict(id=self.id, title=self.title, description=self.description,
                    materials=[item.wire() for item in self.materials], steps=[item.wire() for item in self.steps],
                    **({'introduction': self.introduction} if self.introduction is not None else {}),
                    **({'parameters': [item.wire() for item in self.parameters]} if self.parameters is not None else {}))


def parse_procedures(value, identities=None):
    identities = identities if identities is not None else set()
    return tuple(NotebookProcedure.parse(item, identities) for item in collection(value, 50))
