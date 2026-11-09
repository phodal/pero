"""Revision-pinned local discussion, to-dos and explicit human self-review.

These records have no authenticated person identity, remote invitations, execution
lifecycle or electronic-signature semantics. Display labels identify only what
this local operator entered. The immutable event log records real local changes.
"""

from contextlib import closing
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
import json
from typing import Literal
from uuid import uuid4

from document import block_id, calendar_date, fields, integer, string


class MissingReviewObject(Exception):
    pass


class ReviewConflict(Exception):
    def __init__(self, current_version):
        super().__init__('This local record changed. Refresh before applying your retained input.')
        self.current_version = current_version


TaskStatus = Literal['todo', 'in_progress', 'done', 'cancelled']
ReviewStatus = Literal['requested', 'in_progress', 'approved', 'changes_requested', 'rejected', 'retracted']
TASK_STATUSES = ('todo', 'in_progress', 'done', 'cancelled')
REVIEW_TRANSITIONS = {
    'requested': ('in_progress', 'approved', 'changes_requested', 'rejected', 'retracted'),
    'in_progress': ('approved', 'changes_requested', 'rejected', 'retracted'),
    'approved': ('retracted',),
    'changes_requested': ('retracted',),
    'rejected': ('retracted',),
    'retracted': (),
}


@dataclass(frozen=True)
class Anchor:
    revision: int
    block_id: str | None = None
    quote: str = ''

    @classmethod
    def parse(cls, data):
        revision = integer(data['revision'], 'anchor revision')
        block = block_id(data['blockId']) if data.get('blockId') is not None else None
        quote = string(data.get('quote', ''), 'anchor quote', 2000)
        if quote and not block:
            raise ValueError('A quote requires a block anchor')
        return cls(revision, block, quote)

    def wire(self):
        return {'revision': self.revision, 'blockId': self.block_id, 'quote': self.quote}


@dataclass(frozen=True)
class Command:
    action: str
    request_id: str
    expected_version: int
    actor: str


@dataclass(frozen=True)
class CreateThread(Command):
    anchor: Anchor
    text: str


@dataclass(frozen=True)
class Reply(Command):
    identity: str
    text: str


@dataclass(frozen=True)
class EditComment(Reply):
    comment_id: str


@dataclass(frozen=True)
class SetThreadStatus(Command):
    identity: str


@dataclass(frozen=True)
class CreateTask(Command):
    anchor: Anchor
    title: str
    description: str
    owner: str
    deadline: str


@dataclass(frozen=True)
class UpdateTask(Command):
    identity: str
    title: str
    description: str
    owner: str
    deadline: str
    status: TaskStatus


@dataclass(frozen=True)
class SetTaskStatus(Command):
    identity: str
    status: TaskStatus


@dataclass(frozen=True)
class ReassignTask(Command):
    identity: str
    owner: str
    reason: str


@dataclass(frozen=True)
class RequestReview(Command):
    anchor: Anchor
    reviewer: str
    note: str
    previous_id: str | None


@dataclass(frozen=True)
class TransitionReview(Command):
    identity: str
    status: ReviewStatus
    note: str


def parse_command(value):
    """The single external-input boundary. Unknown fields/actions are rejected."""
    if not isinstance(value, dict):
        raise ValueError('A review workspace command must be an object')
    action = value.get('action')
    common = {'action', 'requestId', 'expectedVersion', 'actorDisplay'}
    requirements = {
        'create-thread': ({'revision', 'text'}, {'blockId', 'quote'}),
        'reply': ({'id', 'text'}, set()),
        'edit-comment': ({'id', 'commentId', 'text'}, set()),
        'resolve-thread': ({'id'}, set()), 'reopen-thread': ({'id'}, set()),
        'create-task': ({'revision', 'title', 'ownerDisplay'}, {'blockId', 'quote', 'description', 'deadline'}),
        'update-task': ({'id', 'title', 'ownerDisplay', 'status'}, {'description', 'deadline'}),
        'set-task-status': ({'id', 'status'}, set()),
        'reassign-task': ({'id', 'ownerDisplay', 'reason'}, set()),
        'request-review': ({'revision', 'reviewerDisplay', 'mode'}, {'note', 'previousReviewId'}),
        'transition-review': ({'id', 'status', 'note', 'confirmedLocalDecision'}, set()),
    }
    if not isinstance(action, str) or action not in requirements:
        raise ValueError('Unknown review workspace action')
    required, optional = requirements[action]
    data = fields(value, common | required, optional)
    request = block_id(data['requestId'])
    expected = integer(data['expectedVersion'], 'expected version', minimum=0)
    actor = string(data['actorDisplay'], 'local actor display label', 120, required=True).strip()
    base = (action, request, expected, actor)
    if action.startswith('create-') or action == 'request-review':
        if expected != 0:
            raise ValueError('New records require expectedVersion 0')
    else:
        integer(expected, 'expected version')
    if action == 'create-thread':
        return CreateThread(*base, Anchor.parse(data), string(data['text'], 'comment', 8000, required=True))
    if action in ('reply', 'edit-comment'):
        args = (*base, block_id(data['id']), string(data['text'], 'comment', 8000, required=True))
        return EditComment(*args, block_id(data['commentId'])) if action == 'edit-comment' else Reply(*args)
    if action in ('resolve-thread', 'reopen-thread'):
        return SetThreadStatus(*base, block_id(data['id']))
    if action in ('create-task', 'update-task'):
        title = string(data['title'], 'task title', 200, required=True)
        description = string(data.get('description', ''), 'task description', 8000)
        owner = string(data['ownerDisplay'], 'local task owner label', 120, required=True)
        deadline = string(data.get('deadline', ''), 'deadline', 10)
        calendar_date(deadline)
        if action == 'create-task':
            return CreateTask(*base, Anchor.parse(data), title, description, owner, deadline)
        if not isinstance(data['status'], str) or data['status'] not in TASK_STATUSES:
            raise ValueError('Invalid local task status')
        return UpdateTask(*base, block_id(data['id']), title, description, owner, deadline, data['status'])
    if action == 'set-task-status':
        if not isinstance(data['status'], str) or data['status'] not in TASK_STATUSES:
            raise ValueError('Invalid local task status')
        return SetTaskStatus(*base, block_id(data['id']), data['status'])
    if action == 'reassign-task':
        return ReassignTask(*base, block_id(data['id']),
                            string(data['ownerDisplay'], 'owner label', 120, required=True).strip(),
                            string(data['reason'], 'reassignment reason', 8000, required=True))
    if action == 'request-review':
        reviewer = string(data['reviewerDisplay'], 'local reviewer label', 120, required=True).strip()
        if data['mode'] != 'local_self_review' or reviewer != actor:
            raise ValueError('Only self-review by this local operator is available; another person cannot be impersonated')
        previous = block_id(data['previousReviewId']) if data.get('previousReviewId') is not None else None
        return RequestReview(*base, Anchor.parse(data), reviewer, string(data.get('note', ''), 'review note', 8000), previous)
    if not isinstance(data['status'], str) or data['status'] not in REVIEW_TRANSITIONS or data['status'] == 'requested':
        raise ValueError('Invalid review transition')
    if data['confirmedLocalDecision'] is not True:
        raise ValueError('Explicit confirmation of your own local review action is required')
    return TransitionReview(*base, block_id(data['id']), data['status'],
                            string(data['note'], 'decision reason', 8000, required=True))


@dataclass(frozen=True)
class Comment:
    id: str
    text: str
    author_display: str
    created_at: str
    edited_at: str | None = None

    def wire(self):
        return {'id': self.id, 'text': self.text, 'authorDisplay': self.author_display,
                'createdAt': self.created_at, 'editedAt': self.edited_at, 'identityScope': 'local_operator'}


@dataclass(frozen=True)
class CommentThread:
    id: str
    version: int
    anchor: Anchor
    status: str
    comments: tuple[Comment, ...]
    updated_at: str

    def wire(self):
        return {'id': self.id, 'version': self.version, 'anchor': self.anchor.wire(),
                'status': self.status, 'comments': [item.wire() for item in self.comments], 'updatedAt': self.updated_at}


@dataclass(frozen=True)
class LocalTask:
    id: str
    version: int
    anchor: Anchor
    title: str
    description: str
    owner: str
    deadline: str
    status: TaskStatus
    created_at: str
    updated_at: str

    def wire(self):
        return {'id': self.id, 'version': self.version, 'anchor': self.anchor.wire(), 'title': self.title,
                'description': self.description, 'ownerDisplay': self.owner, 'deadline': self.deadline,
                'status': self.status, 'createdAt': self.created_at, 'updatedAt': self.updated_at, 'scope': 'notebook_local'}


@dataclass(frozen=True)
class LocalReview:
    id: str
    version: int
    anchor: Anchor
    reviewer: str
    status: ReviewStatus
    note: str
    previous_id: str | None
    created_at: str
    updated_at: str
    decision_at: str | None = None
    decision_reason: str | None = None
    decision_status: str | None = None
    decision_by: str | None = None

    def wire(self):
        return {'id': self.id, 'version': self.version, 'anchor': self.anchor.wire(),
                'reviewerDisplay': self.reviewer, 'status': self.status, 'note': self.note,
                'previousReviewId': self.previous_id, 'createdAt': self.created_at, 'updatedAt': self.updated_at,
                'decisionAt': self.decision_at, 'decisionReason': self.decision_reason,
                'decisionStatus': self.decision_status, 'decisionBy': self.decision_by, 'mode': 'local_self_review'}


Record = CommentThread | LocalTask | LocalReview


def change_record(current: Record | None, command: Command, at: str, identity: str) -> Record:
    """Pure local transition. Clocks, IDs, persistence and revision reads are outside."""
    version = current.version if current else 0
    if command.expected_version != version:
        raise ReviewConflict(version)
    if isinstance(command, CreateThread):
        return CommentThread(identity, 1, command.anchor, 'open', (Comment(identity, command.text, command.actor, at),), at)
    if isinstance(command, CreateTask):
        return LocalTask(identity, 1, command.anchor, command.title, command.description, command.owner,
                         command.deadline, 'todo', at, at)
    if isinstance(command, RequestReview):
        return LocalReview(identity, 1, command.anchor, command.reviewer, 'requested', command.note, command.previous_id, at, at)
    if isinstance(current, CommentThread):
        if isinstance(command, EditComment):
            if not any(comment.id == command.comment_id for comment in current.comments):
                raise MissingReviewObject('Comment not found in this thread')
            # All comments belong to the single local operator, never a claimed remote person.
            comments = tuple(replace(comment, text=command.text, edited_at=at)
                             if comment.id == command.comment_id else comment for comment in current.comments)
            return replace(current, comments=comments, version=version + 1, updated_at=at)
        if isinstance(command, Reply):
            if current.status != 'open':
                raise ValueError('Reopen this thread before replying')
            if len(current.comments) >= 200:
                raise ValueError('A comment thread supports at most 200 messages')
            return replace(current, comments=(*current.comments, Comment(identity, command.text, command.actor, at)),
                           version=version + 1, updated_at=at)
        if isinstance(command, SetThreadStatus):
            status = 'resolved' if command.action == 'resolve-thread' else 'open'
            if status == current.status:
                raise ValueError('This thread is already in that state')
            return replace(current, status=status, version=version + 1, updated_at=at)
    if isinstance(current, LocalTask) and isinstance(command, SetTaskStatus):
        if current.status == command.status:
            raise ValueError('This task is already in that state')
        return replace(current, status=command.status, version=version + 1, updated_at=at)
    if isinstance(current, LocalTask) and isinstance(command, ReassignTask):
        if current.owner == command.owner:
            raise ValueError('This task is already assigned to that label')
        return replace(current, owner=command.owner, version=version + 1, updated_at=at)
    if isinstance(current, LocalTask) and isinstance(command, UpdateTask):
        return replace(current, title=command.title, description=command.description, owner=command.owner,
                       deadline=command.deadline, status=command.status, version=version + 1, updated_at=at)
    if isinstance(current, LocalReview) and isinstance(command, TransitionReview):
        if command.actor != current.reviewer:
            raise ValueError('The local reviewer label must match the original self-review request')
        if command.status not in REVIEW_TRANSITIONS[current.status]:
            raise ValueError('That review transition is not allowed; request a fresh review instead')
        result = replace(current, status=command.status, note=command.note, version=version + 1, updated_at=at)
        if command.status in ('approved', 'changes_requested', 'rejected'):
            result = replace(result, decision_at=at, decision_reason=command.note,
                             decision_status=command.status, decision_by=command.actor)
        # Retraction does not overwrite the previous decision; the transition event records its reason.
        return result
    raise ValueError('The action does not apply to this local record')


def _record(table, payload):
    value = json.loads(payload)
    value['anchor'] = Anchor(**value['anchor'])
    if table == 'notebook_comment_threads':
        value['comments'] = tuple(Comment(**comment) for comment in value['comments'])
        return CommentThread(**value)
    return LocalTask(**value) if table == 'notebook_local_tasks' else LocalReview(**value)


def _table(command):
    if isinstance(command, (CreateThread, Reply, SetThreadStatus)):
        return 'notebook_comment_threads'
    if isinstance(command, (CreateTask, UpdateTask, SetTaskStatus, ReassignTask)):
        return 'notebook_local_tasks'
    return 'notebook_review_records'


def _text(node):
    return node.get('text', '') + ''.join(_text(child) for child in node.get('content', []))


class ReviewStore:
    """A local domain store sharing EntryStore's SQLite transaction boundary."""

    def __init__(self, store):
        self.store = store
        with closing(store._connect()) as connection, connection:
            for table in ('notebook_comment_threads', 'notebook_local_tasks', 'notebook_review_records'):
                connection.execute(f'''CREATE TABLE IF NOT EXISTS {table} (
                    entry_id TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
                    PRIMARY KEY(entry_id, id))''')
            connection.execute('''CREATE TABLE IF NOT EXISTS notebook_review_activity (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT NOT NULL,
                at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, record_id TEXT NOT NULL,
                revision INTEGER NOT NULL, version INTEGER NOT NULL, detail TEXT NOT NULL)''')
            connection.execute('''CREATE TABLE IF NOT EXISTS notebook_review_requests (
                entry_id TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
                record_id TEXT NOT NULL, PRIMARY KEY(entry_id, request_id))''')

        from review_workflows import ReviewWorkflowStore
        from review_batches import ReviewBatchStore
        self.workflows = ReviewWorkflowStore(self)
        self.batches = ReviewBatchStore(self)

    def _read(self, connection, entry_id):
        head = self.store._read(connection, entry_id)
        result = {'entryId': entry_id, 'headRevision': head.revision, 'scope': 'notebook_local'}
        for table, key in (('notebook_comment_threads', 'threads'), ('notebook_local_tasks', 'tasks'),
                           ('notebook_review_records', 'reviews')):
            records = [_record(table, row['payload']) for row in connection.execute(
                f'SELECT payload FROM {table} WHERE entry_id = ? ORDER BY rowid DESC', (entry_id,))]
            items = []
            for record in records:
                anchor = record.anchor
                status = 'current' if anchor.revision == head.revision else 'revision_changed'
                if anchor.block_id and status != 'current':
                    current_block = head.document.block(anchor.block_id)
                    if current_block is None:
                        status = 'missing'
                    else:
                        original = self.store._read(connection, entry_id, anchor.revision)
                        status = 'unchanged' if current_block == original.document.block(anchor.block_id) else 'changed'
                items.append({**record.wire(), 'stale': anchor.revision != head.revision, 'anchorStatus': status})
            result[key] = items
        rows = connection.execute('''SELECT * FROM notebook_review_activity WHERE entry_id = ?
            ORDER BY sequence DESC LIMIT 500''', (entry_id,)).fetchall()
        result['activity'] = [{'id': row['sequence'], 'at': row['at'], 'actorDisplay': row['actor'],
                               'action': row['action'], 'recordId': row['record_id'], 'revision': row['revision'],
                               'version': row['version'], 'detail': row['detail'], 'identityScope': 'local_operator'}
                              for row in rows]
        result.update(self.workflows.read(connection, entry_id, head.revision))
        result['activityLimited'] = connection.execute(
            'SELECT COUNT(*) FROM notebook_review_activity WHERE entry_id = ?', (entry_id,)).fetchone()[0] > 500
        return result

    def read(self, entry_id):
        with closing(self.store._connect()) as connection, connection:
            connection.execute('BEGIN')
            return self._read(connection, entry_id)

    def apply(self, entry_id, value):
        from review_workflows import WORKFLOW_ACTIONS
        if isinstance(value, dict) and value.get('action') in WORKFLOW_ACTIONS:
            return self.workflows.apply(entry_id, value)
        if isinstance(value, dict) and value.get('action') == 'bulk-change':
            return self.batches.apply(entry_id, value)
        command = parse_command(value)
        with closing(self.store._connect()) as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            result = self._apply(connection, entry_id, command)
            return {**self._read(connection, entry_id), **result}

    def _apply(self, connection, entry_id, command):
        fingerprint = json.dumps(asdict(command), sort_keys=True, ensure_ascii=False)
        table = _table(command)
        self.store._read(connection, entry_id)
        receipt = connection.execute('''SELECT fingerprint, record_id FROM notebook_review_requests
            WHERE entry_id = ? AND request_id = ?''', (entry_id, command.request_id)).fetchone()
        if receipt:
            if receipt['fingerprint'] != fingerprint:
                raise ValueError('This request ID was already used for a different change')
            return {'recordId': receipt['record_id'], 'replayed': True}
        creating = isinstance(command, (CreateThread, CreateTask, RequestReview))
        current = None
        if creating:
            anchor = command.anchor
            pinned = self.store._read(connection, entry_id, anchor.revision)
            if anchor.block_id:
                block = pinned.document.block(anchor.block_id)
                if block is None:
                    raise MissingReviewObject('Anchor block is absent from the selected saved revision')
                if anchor.quote and anchor.quote not in _text(block):
                    raise ValueError('The quoted text is not in this block at the selected saved revision')
            if isinstance(command, RequestReview) and command.previous_id:
                previous = connection.execute(f'SELECT payload FROM {table} WHERE entry_id = ? AND id = ?',
                                              (entry_id, command.previous_id)).fetchone()
                if previous is None:
                    raise MissingReviewObject('Previous review not found in this entry')
            count = connection.execute(f'SELECT COUNT(*) FROM {table} WHERE entry_id = ?', (entry_id,)).fetchone()[0]
            if count >= 1000:
                raise ValueError('This entry has reached the limit of 1,000 local records of this kind')
        else:
            row = connection.execute(f'SELECT payload FROM {table} WHERE entry_id = ? AND id = ?',
                                     (entry_id, command.identity)).fetchone()
            if row is None:
                raise MissingReviewObject('Local record not found in this entry')
            current = _record(table, row['payload'])
        at = datetime.now(timezone.utc).isoformat(timespec='microseconds')
        record = change_record(current, command, at, uuid4().hex)
        connection.execute(f'''INSERT INTO {table} (entry_id,id,payload) VALUES (?,?,?)
            ON CONFLICT(entry_id,id) DO UPDATE SET payload=excluded.payload''',
            (entry_id, record.id, json.dumps(asdict(record), ensure_ascii=False)))
        detail = (command.note if isinstance(command, (RequestReview, TransitionReview)) else
                  command.text if isinstance(command, (CreateThread, Reply)) else
                  f'{record.title}: {record.status}' if isinstance(record, LocalTask) else record.status)
        if isinstance(command, ReassignTask):
            detail = json.dumps({'previousOwner': current.owner, 'owner': record.owner, 'reason': command.reason}, ensure_ascii=False)
        connection.execute('''INSERT INTO notebook_review_activity
            (entry_id,at,actor,action,record_id,revision,version,detail) VALUES (?,?,?,?,?,?,?,?)''',
            (entry_id, at, command.actor, command.action, record.id, record.anchor.revision, record.version, detail))
        connection.execute('INSERT INTO notebook_review_requests VALUES (?,?,?,?)',
                           (entry_id, command.request_id, fingerprint, record.id))
        return {'recordId': record.id, 'replayed': False}
