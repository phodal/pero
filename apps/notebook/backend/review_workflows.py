"""Named local review plans and pinned runs. Labels are never authenticated users."""
from contextlib import closing
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
import json
from uuid import uuid4

from document import block_id, fields, integer, string
from reviews import MissingReviewObject, ReviewConflict

WORKFLOW_ACTIONS = ('save-workflow', 'request-workflow', 'decide-workflow', 'reassign-workflow', 'withdraw-workflow')
DECISIONS = ('approved', 'changes_requested', 'rejected')


@dataclass(frozen=True)
class ReviewStage:
    id: str
    name: str
    participants: tuple[str, ...]

    @classmethod
    def parse(cls, value):
        value = fields(value, {'id', 'name', 'participants'})
        participants = value['participants']
        if not isinstance(participants, list) or not 1 <= len(participants) <= 20:
            raise ValueError('Each stage needs 1–20 local participant labels')
        labels = tuple(string(item, 'participant label', 120, required=True).strip() for item in participants)
        if len(set(labels)) != len(labels):
            raise ValueError('Participant labels must be distinct within a stage')
        return cls(block_id(value['id']), string(value['name'], 'stage name', 120, required=True).strip(), labels)


@dataclass(frozen=True)
class ReviewWorkflow:
    id: str
    version: int
    name: str
    stages: tuple[ReviewStage, ...]
    created_at: str
    author: str

    def wire(self):
        return {'id': self.id, 'version': self.version, 'name': self.name,
                'stages': [asdict(stage) for stage in self.stages], 'createdAt': self.created_at,
                'authorDisplay': self.author, 'identityScope': 'unverified_local_label'}


@dataclass(frozen=True)
class ReviewAssignment:
    id: str
    stage_id: str
    participant: str
    status: str = 'pending'
    decided_at: str | None = None
    reason: str | None = None
    actor: str | None = None

    def wire(self):
        return {'id': self.id, 'stageId': self.stage_id, 'participantDisplay': self.participant,
                'status': self.status, 'decidedAt': self.decided_at, 'reason': self.reason,
                'actorDisplay': self.actor, 'identityScope': 'unverified_local_label'}


@dataclass(frozen=True)
class ReviewRun:
    id: str
    version: int
    revision: int
    workflow: ReviewWorkflow
    assignments: tuple[ReviewAssignment, ...]
    status: str
    requester: str
    note: str
    previous_id: str | None
    created_at: str
    updated_at: str

    @property
    def active_stage(self):
        if self.status != 'requested':
            return None
        return next((stage.id for stage in self.workflow.stages if any(
            item.stage_id == stage.id and item.status == 'pending' for item in self.assignments)), None)

    def wire(self, head):
        return {'id': self.id, 'version': self.version, 'revision': self.revision,
                'workflow': self.workflow.wire(), 'assignments': [item.wire() for item in self.assignments],
                'status': self.status, 'activeStageId': self.active_stage, 'requesterDisplay': self.requester,
                'note': self.note, 'previousRunId': self.previous_id, 'createdAt': self.created_at,
                'updatedAt': self.updated_at, 'stale': self.revision != head,
                'mode': 'local_workflow', 'identityScope': 'unverified_local_label'}


@dataclass(frozen=True)
class WorkflowCommand:
    action: str
    request_id: str
    expected_version: int
    actor: str
    identity: str | None = None


@dataclass(frozen=True)
class SaveWorkflow(WorkflowCommand):
    name: str = ''
    stages: tuple[ReviewStage, ...] = ()


@dataclass(frozen=True)
class RequestWorkflow(WorkflowCommand):
    revision: int = 1
    workflow_id: str = ''
    workflow_version: int = 1
    note: str = ''
    previous_id: str | None = None


@dataclass(frozen=True)
class ChangeWorkflow(WorkflowCommand):
    assignment_id: str | None = None
    decision: str | None = None
    participant: str | None = None
    reason: str = ''


def parse_workflow_command(value):
    if not isinstance(value, dict) or value.get('action') not in WORKFLOW_ACTIONS:
        raise ValueError('Unknown local workflow action')
    action = value['action']
    common = {'action', 'requestId', 'expectedVersion', 'actorDisplay'}
    requirements = {
        'save-workflow': ({'name', 'stages'}, {'id'}),
        'request-workflow': ({'revision', 'workflowId', 'workflowVersion'}, {'note', 'previousRunId'}),
        'decide-workflow': ({'id', 'assignmentId', 'decision', 'reason', 'confirmedLocalDecision'}, set()),
        'reassign-workflow': ({'id', 'assignmentId', 'participantDisplay', 'reason'}, set()),
        'withdraw-workflow': ({'id', 'reason'}, set()),
    }
    required, optional = requirements[action]
    data = fields(value, common | required, optional)
    base = (action, block_id(data['requestId']), integer(data['expectedVersion'], 'expected version', minimum=0),
            string(data['actorDisplay'], 'your local label', 120, required=True).strip(),
            block_id(data['id']) if data.get('id') is not None else None)
    if action == 'save-workflow':
        if not isinstance(data['stages'], list) or not 1 <= len(data['stages']) <= 10:
            raise ValueError('A workflow needs 1–10 ordered stages')
        stages = tuple(ReviewStage.parse(stage) for stage in data['stages'])
        if len({stage.id for stage in stages}) != len(stages):
            raise ValueError('Stage IDs must be distinct')
        return SaveWorkflow(*base, string(data['name'], 'workflow name', 120, required=True).strip(), stages)
    if action == 'request-workflow':
        if base[2] != 0:
            raise ValueError('New review runs require expectedVersion 0')
        return RequestWorkflow(*base, integer(data['revision'], 'saved revision'), block_id(data['workflowId']),
                               integer(data['workflowVersion'], 'workflow version'),
                               string(data.get('note', ''), 'review note', 8000),
                               block_id(data['previousRunId']) if data.get('previousRunId') is not None else None)
    integer(base[2], 'expected version')
    reason = string(data['reason'], 'reason', 8000, required=True)
    assignment = block_id(data['assignmentId']) if 'assignmentId' in data else None
    if action == 'decide-workflow':
        if data['confirmedLocalDecision'] is not True:
            raise ValueError('Confirm that this is your own local decision, not a decision on another person’s behalf')
        if data['decision'] not in DECISIONS:
            raise ValueError('Unknown review decision')
        return ChangeWorkflow(*base, assignment, data['decision'], reason=reason)
    participant = string(data['participantDisplay'], 'participant label', 120, required=True).strip() if 'participantDisplay' in data else None
    return ChangeWorkflow(*base, assignment, participant=participant, reason=reason)


def save_workflow(current, command: SaveWorkflow, at, identity):
    if command.expected_version != (current.version if current else 0):
        raise ReviewConflict(current.version if current else 0)
    return ReviewWorkflow(current.id if current else identity, command.expected_version + 1,
                          command.name, command.stages, at, command.actor)


def request_workflow(config: ReviewWorkflow, command: RequestWorkflow, at, identity):
    assignments = tuple(ReviewAssignment(f's{stage_index}-p{index}', stage.id, label)
                        for stage_index, stage in enumerate(config.stages) for index, label in enumerate(stage.participants))
    return ReviewRun(identity, 1, command.revision, config, assignments, 'requested', command.actor,
                     command.note, command.previous_id, at, at)


def change_workflow(current: ReviewRun, command: ChangeWorkflow, at):
    """Sequential stages; labels inside one stage run in parallel and all must approve."""
    if current.version != command.expected_version:
        raise ReviewConflict(current.version)
    if command.action == 'withdraw-workflow':
        if current.status == 'withdrawn':
            raise ValueError('This run is already withdrawn')
        if command.actor != current.requester:
            raise ValueError('Use your original requester label to withdraw this local run')
        return replace(current, status='withdrawn', note=command.reason, version=current.version + 1, updated_at=at)
    if current.status != 'requested':
        raise ValueError('This run is closed; request a fresh review to preserve its history')
    assignment = next((item for item in current.assignments if item.id == command.assignment_id), None)
    if assignment is None:
        raise MissingReviewObject('Assignment not found in this review run')
    if assignment.status != 'pending':
        raise ValueError('A recorded decision cannot be changed or reassigned; request a fresh review')
    if command.action == 'reassign-workflow':
        if any(item.stage_id == assignment.stage_id and item.participant == command.participant for item in current.assignments):
            raise ValueError('That label is already assigned to this stage')
        changed = replace(assignment, participant=command.participant)
    else:
        if assignment.stage_id != current.active_stage:
            raise ValueError('Complete the earlier stage before recording this decision')
        if command.actor != assignment.participant:
            raise ValueError('Use your own assigned label; another participant cannot be impersonated')
        changed = replace(assignment, status=command.decision, decided_at=at, reason=command.reason, actor=command.actor)
    assignments = tuple(changed if item.id == assignment.id else item for item in current.assignments)
    status = command.decision if command.decision in ('changes_requested', 'rejected') else (
        'approved' if all(item.status == 'approved' for item in assignments) else 'requested')
    return replace(current, assignments=assignments, status=status, version=current.version + 1, updated_at=at)


def decode_config(value):
    return ReviewWorkflow(**{**value, 'stages': tuple(ReviewStage(**{**stage, 'participants': tuple(stage['participants'])}) for stage in value['stages'])})


def decode_run(payload):
    value = json.loads(payload)
    return ReviewRun(**{**value, 'workflow': decode_config(value['workflow']),
                        'assignments': tuple(ReviewAssignment(**item) for item in value['assignments'])})


class ReviewWorkflowStore:
    def __init__(self, reviews):
        self.reviews = reviews
        with closing(reviews.store._connect()) as connection, connection:
            connection.execute('''CREATE TABLE IF NOT EXISTS notebook_workflow_configs (
                entry_id TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL,
                PRIMARY KEY(entry_id,id,version))''')
            connection.execute('''CREATE TABLE IF NOT EXISTS notebook_workflow_runs (
                entry_id TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(entry_id,id))''')

    def read(self, connection, entry_id, head):
        configs = [decode_config(json.loads(row['payload'])).wire() for row in connection.execute('''
            SELECT payload FROM notebook_workflow_configs WHERE entry_id=? ORDER BY rowid DESC''', (entry_id,))]
        runs = [decode_run(row['payload']).wire(head) for row in connection.execute('''
            SELECT payload FROM notebook_workflow_runs WHERE entry_id=? ORDER BY rowid DESC''', (entry_id,))]
        return {'workflowConfigs': configs, 'workflowRuns': runs}

    def apply(self, entry_id, value):
        command = parse_workflow_command(value)
        fingerprint = json.dumps(asdict(command), sort_keys=True, ensure_ascii=False)
        with closing(self.reviews.store._connect()) as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            head = self.reviews.store._read(connection, entry_id)
            receipt = connection.execute('SELECT * FROM notebook_review_requests WHERE entry_id=? AND request_id=?',
                                         (entry_id, command.request_id)).fetchone()
            if receipt:
                if receipt['fingerprint'] != fingerprint:
                    raise ValueError('This request ID was already used for a different change')
                return {**self.reviews._read(connection, entry_id), 'recordId': receipt['record_id'], 'replayed': True}
            at, identity = datetime.now(timezone.utc).isoformat(timespec='microseconds'), uuid4().hex
            before = None
            if isinstance(command, SaveWorkflow):
                if command.identity:
                    row = connection.execute('''SELECT payload FROM notebook_workflow_configs WHERE entry_id=? AND id=?
                        ORDER BY version DESC LIMIT 1''', (entry_id, command.identity)).fetchone()
                    if row is None:
                        raise MissingReviewObject('Workflow not found in this entry')
                    before = decode_config(json.loads(row['payload']))
                record = save_workflow(before, command, at, identity)
                connection.execute('INSERT INTO notebook_workflow_configs VALUES (?,?,?,?)',
                                   (entry_id, record.id, record.version, json.dumps(asdict(record))))
                revision, detail = head.revision, json.dumps(record.wire(), ensure_ascii=False)
            else:
                if isinstance(command, RequestWorkflow):
                    self.reviews.store._read(connection, entry_id, command.revision)
                    row = connection.execute('SELECT payload FROM notebook_workflow_configs WHERE entry_id=? AND id=? AND version=?',
                                             (entry_id, command.workflow_id, command.workflow_version)).fetchone()
                    if row is None:
                        raise MissingReviewObject('That saved workflow version does not exist in this entry')
                    if command.previous_id and connection.execute('SELECT id FROM notebook_workflow_runs WHERE entry_id=? AND id=?',
                                                                 (entry_id, command.previous_id)).fetchone() is None:
                        raise MissingReviewObject('Previous review run not found in this entry')
                    record = request_workflow(decode_config(json.loads(row['payload'])), command, at, identity)
                else:
                    row = connection.execute('SELECT payload FROM notebook_workflow_runs WHERE entry_id=? AND id=?',
                                             (entry_id, command.identity)).fetchone()
                    if row is None:
                        raise MissingReviewObject('Review run not found in this entry')
                    before = decode_run(row['payload'])
                    record = change_workflow(before, command, at)
                connection.execute('''INSERT INTO notebook_workflow_runs VALUES (?,?,?)
                    ON CONFLICT(entry_id,id) DO UPDATE SET payload=excluded.payload''',
                    (entry_id, record.id, json.dumps(asdict(record))))
                revision = record.revision
                prior = next((item for item in before.assignments if item.id == command.assignment_id), None) if isinstance(command, ChangeWorkflow) and before else None
                detail = json.dumps({'command': asdict(command), 'previousAssignment': asdict(prior) if prior else None,
                                     'status': record.status, 'workflowId': record.workflow.id, 'workflowVersion': record.workflow.version}, ensure_ascii=False)
            connection.execute('''INSERT INTO notebook_review_activity
                (entry_id,at,actor,action,record_id,revision,version,detail) VALUES (?,?,?,?,?,?,?,?)''',
                (entry_id, at, command.actor, command.action, record.id, revision, record.version, detail))
            connection.execute('INSERT INTO notebook_review_requests VALUES (?,?,?,?)',
                               (entry_id, command.request_id, fingerprint, record.id))
            return {**self.reviews._read(connection, entry_id), 'recordId': record.id, 'replayed': False}
