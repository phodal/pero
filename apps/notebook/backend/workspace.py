"""Local record metadata and human procedure notes, separate from Lab execution."""

from dataclasses import dataclass
import math
import re


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


@dataclass(frozen=True)
class ProcedureMaterial:
    id: str
    name: str
    quantity: str

    @classmethod
    def parse(cls, value):
        shape(value, {'id', 'name', 'quantity'})
        return cls(identity(value['id']), text(value['name'], 'material name', 200),
                   text(value['quantity'], 'material quantity', 200))

    def wire(self):
        return dict(id=self.id, name=self.name, quantity=self.quantity)


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
        kind = value.get('kind')
        if 'kind' in value and kind not in ('header', 'step', 'description', 'image', 'table', 'timer'):
            raise ValueError('Invalid procedure step kind')
        content = value.get('content')
        if 'content' in value:
            # Same node/mark/file/table boundary as Notes, not a parallel editor schema.
            from document import _node
            _node(content, {'doc'}, identities if identities is not None else set())
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
        return cls(identity(value['id']), text(value['text'], 'procedure step', 32768),
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

    @classmethod
    def parse(cls, value, identities=None):
        shape(value, {'id', 'title', 'description', 'materials', 'steps'})
        materials = tuple(ProcedureMaterial.parse(item) for item in collection(value['materials'], 100))
        identities = identities if identities is not None else set()
        steps = tuple(ProcedureStep.parse(item, identities) for item in collection(value['steps'], 500))
        ids = [item.id for item in (*materials, *steps)]
        ids.append(identity(value['id']))
        if len(set(ids)) != len(ids) or any(item in identities for item in ids):
            raise ValueError('Duplicate procedure row identity')
        identities.update(ids)
        return cls(identity(value['id']), text(value['title'], 'procedure title', 200),
                   text(value['description'], 'procedure description', 32768), materials, steps)

    def wire(self):
        return dict(id=self.id, title=self.title, description=self.description,
                    materials=[item.wire() for item in self.materials], steps=[item.wire() for item in self.steps])


def parse_procedures(value, identities=None):
    identities = identities if identities is not None else set()
    procedures = tuple(NotebookProcedure.parse(item, identities) for item in collection(value, 50))
    if len({item.id for item in procedures}) != len(procedures):
        raise ValueError('Duplicate procedure identity')
    return procedures
