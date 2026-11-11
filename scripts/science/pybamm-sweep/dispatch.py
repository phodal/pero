"""A fixed task list and projection of existing Run evidence, never a scheduler."""
from dataclasses import asdict, dataclass
import json

from contract import MethodIdentity, Result, digest, encoded
from check import check

PREFIX = 'PERO_PYBAMM_RESULT '
ACCEPTANCE = 'Compare all 61 samples with the frozen sequential reference; scientific acceptance remains separate.'


def task_prompt(experiment: str, sha256: str) -> str:
    return 'PERO_PYBAMM_V1 ' + encoded({'experiment': experiment, 'method_sha256': sha256}).decode()


@dataclass(frozen=True)
class Binding:
    experiment: str
    worker: str
    task: str = ''
    run: str = ''


@dataclass(frozen=True)
class Batch:
    name: str
    origin: str
    project: str
    workspace: str
    agent: str
    method_sha256: str
    items: tuple[Binding, ...]

    @classmethod
    def parse(cls, value, identity: MethodIdentity):
        raw = dict(value)
        raw['items'] = tuple(Binding(**item) for item in raw['items'])
        batch = cls(**raw)
        if (batch.method_sha256 != identity.sha256 or
                tuple(i.experiment for i in batch.items) != tuple(e.id for e in identity.method.experiments)
                or len({i.worker for i in batch.items}) != 2 or not all(i.worker for i in batch.items)):
            raise ValueError('Batch must bind the current frozen six inputs to two explicit Workers')
        return batch

    @property
    def key(self):
        # Task/Run receipts can be recovered after a lost client response/file write.
        scope = asdict(self)
        scope['items'] = [(i.experiment, i.worker) for i in self.items]
        return 'pybamm-' + digest(encoded(scope))[:48]

    def spec(self, item: Binding):
        return {'title': f'{self.name}: {item.experiment}',
                'prompt': task_prompt(item.experiment, self.method_sha256), 'acceptance': ACCEPTANCE,
                'project_id': self.project, 'workspace_key': self.workspace, 'agent_id': self.agent,
                'tags': [self.key]}


@dataclass(frozen=True)
class Observation:
    run: str
    worker: str
    generation: int
    status: str
    summary: str
    prompt: str
    result_messages: tuple[str, ...]
    truncated: bool

    @classmethod
    def parse(cls, detail):
        run = detail.get('run')
        if not run:
            return cls('', '', 0, 'missing', 'No Run recorded', '', (), False)
        messages = tuple(event['data']['content']['text'][len(PREFIX):]
                         for event in detail.get('events', [])
                         if event.get('kind') == 'session_update'
                         and event.get('data', {}).get('sessionUpdate') == 'agent_message_chunk'
                         and event.get('data', {}).get('content', {}).get('text', '').startswith(PREFIX))
        return cls(run['id'], run.get('worker_id', ''), run['generation'], run['status'],
                   run.get('summary', ''), run['spec']['prompt'], messages,
                   detail.get('events_truncated', False))


@dataclass(frozen=True)
class Row:
    experiment: str
    task: str
    run: str
    worker: str
    generation: int
    state: str
    verification: str
    reason: str
    result_sha256: str = ''
    result_path: str = ''
    hostname: str = ''


def summarize(binding: Binding, observed: Observation, reference: Result | None,
              identity: MethodIdentity) -> Row:
    row = Row(binding.experiment, binding.task, observed.run, observed.worker, observed.generation,
              observed.status, 'not_checked', observed.summary)
    from dataclasses import replace
    if observed.run != binding.run or observed.prompt != task_prompt(binding.experiment, identity.sha256):
        return replace(row, verification='needs_review', reason='Current Run/input differs from frozen binding')
    if observed.status != 'succeeded':
        return row
    if observed.worker != binding.worker:
        return replace(row, verification='needs_review', reason='Result belongs to a different Worker')
    if not observed.result_messages or observed.truncated:
        return replace(row, verification='missing', reason='Result event missing or event history truncated')
    # Repeated identical delivery is one result; conflicting payloads are never last-write-wins.
    messages = set(observed.result_messages)
    if len(messages) != 1:
        return replace(row, verification='needs_review', reason='Conflicting result events')
    try:
        envelope = json.loads(next(iter(messages)))
        content = envelope['content']
        if digest(content.encode()) != envelope['sha256']:
            raise ValueError('Result file digest mismatch')
        result = Result.parse(json.loads(content))
        if result.experiment.id != binding.experiment:
            raise ValueError('Result experiment differs from Task binding')
        errors = check(result, reference, identity) if reference else ('Reference missing',)
    except (ValueError, KeyError, TypeError) as error:
        return replace(row, verification='needs_review', reason=str(error))
    return replace(row, verification='consistent' if not errors else 'needs_review', reason='; '.join(errors),
                   result_sha256=envelope['sha256'], result_path=envelope['path'], hostname=result.hostname)
