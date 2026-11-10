"""Bounded partial-success changes; replay returns the original per-item outcomes."""
from contextlib import closing
from dataclasses import asdict, dataclass
import json
from hashlib import sha256

from document import block_id, fields, string
from reviews import Command, MissingReviewObject, ReviewConflict, parse_command
from store import MissingEntry


@dataclass(frozen=True)
class ReviewBatch:
    request_id: str
    actor: str
    changes: tuple[Command, ...]

    @classmethod
    def parse(cls, value):
        data = fields(value, {'action', 'requestId', 'actorDisplay', 'changes'})
        request_id = block_id(data['requestId'])
        actor = string(data['actorDisplay'], 'local actor label', 120, required=True).strip()
        if not isinstance(data['changes'], list) or not 1 <= len(data['changes']) <= 100:
            raise ValueError('A bulk operation needs 1–100 explicit changes')
        allowed = ('resolve-thread', 'reopen-thread', 'set-task-status', 'reassign-task', 'transition-review', 'request-review')
        changes = []
        for index, item in enumerate(data['changes']):
            if not isinstance(item, dict) or item.get('action') not in allowed or {'requestId', 'actorDisplay'} & item.keys():
                raise ValueError('Invalid bulk change; each item uses the same local actor')
            # Child IDs are derived by the transport, never supplied by a second caller.
            changes.append(parse_command({**item, 'requestId': f'{sha256(request_id.encode()).hexdigest()}-item-{index}', 'actorDisplay': actor}))
        identities = [item.identity for item in changes if hasattr(item, 'identity')]
        if len(set(identities)) != len(identities):
            raise ValueError('Choose each local record only once per bulk operation')
        return cls(request_id, actor, tuple(changes))


class ReviewBatchStore:
    def __init__(self, reviews):
        self.reviews = reviews
        with closing(reviews.store._connect()) as connection, connection:
            connection.execute('''CREATE TABLE IF NOT EXISTS notebook_review_batches (
                entry_id TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
                results TEXT NOT NULL, PRIMARY KEY(entry_id,request_id))''')

    def apply(self, entry_id, value):
        batch = ReviewBatch.parse(value)
        fingerprint = json.dumps(asdict(batch), sort_keys=True, ensure_ascii=False)
        with closing(self.reviews.store._connect()) as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            self.reviews.store._read(connection, entry_id)
            receipt = connection.execute('SELECT * FROM notebook_review_batches WHERE entry_id=? AND request_id=?',
                                         (entry_id, batch.request_id)).fetchone()
            if receipt:
                if receipt['fingerprint'] != fingerprint:
                    raise ValueError('This bulk request ID was already used for a different change')
                return {**self.reviews._read(connection, entry_id), 'bulkResults': json.loads(receipt['results']), 'replayed': True}
            existing = connection.execute('SELECT request_id FROM notebook_review_requests WHERE entry_id=? AND request_id=?',
                                          (entry_id, batch.request_id)).fetchone()
            if existing:
                raise ValueError('This request ID was already used for a different change')
            results = []
            for index, command in enumerate(batch.changes):
                connection.execute('SAVEPOINT review_item')
                identity = getattr(command, 'identity', None)
                try:
                    result = self.reviews._apply(connection, entry_id, command)
                    results.append({'index': index, 'id': result['recordId'], 'ok': True, 'replayed': result['replayed']})
                except (ReviewConflict, MissingReviewObject, MissingEntry, ValueError) as error:
                    connection.execute('ROLLBACK TO review_item')
                    results.append({'index': index, 'id': identity, 'ok': False, 'detail': str(error),
                                    'code': 'review-conflict' if isinstance(error, ReviewConflict) else 'not-found' if isinstance(error, (MissingEntry, MissingReviewObject)) else 'invalid-request',
                                    **({'currentVersion': error.current_version} if isinstance(error, ReviewConflict) else {})})
                finally:
                    connection.execute('RELEASE review_item')
            connection.execute('INSERT INTO notebook_review_requests VALUES (?,?,?,?)',
                               (entry_id, batch.request_id, fingerprint, batch.request_id))
            connection.execute('INSERT INTO notebook_review_batches VALUES (?,?,?,?)',
                               (entry_id, batch.request_id, fingerprint, json.dumps(results)))
            return {**self.reviews._read(connection, entry_id), 'bulkResults': results, 'replayed': False}
