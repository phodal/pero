"""Local review records never become independent identity or newer-revision approval."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from document import NotebookDocument
from reviews import (Anchor, Comment, CommentThread, LocalReview, MissingReviewObject,
                     ReviewConflict, ReviewStore, change_record, parse_command)
from store import EntryStore, MissingEntry
from server import handler


def document(text='Original source'):
    return NotebookDocument.parse({'schemaVersion': 1, 'title': 'Review experiment', 'content': {
        'type': 'doc', 'content': [{'type': 'paragraph', 'attrs': {'blockId': 'source'},
                                  'content': [{'type': 'text', 'text': text}]}]}})


def command(action, **values):
    return {'action': action, 'requestId': 'request-1', 'expectedVersion': 0, 'actorDisplay': 'Local scientist', **values}


class ReviewTransitionTest(unittest.TestCase):
    def test_formal_transition_matrix_and_retraction_preserve_the_decision(self):
        review = LocalReview('review', 1, Anchor(1), 'Local scientist', 'requested', '', None, 't0', 't0')
        for status, allowed in [('requested', ['in_progress', 'approved', 'changes_requested', 'retracted']),
                                ('in_progress', ['approved', 'changes_requested', 'retracted']),
                                ('approved', ['retracted']), ('changes_requested', ['retracted']), ('retracted', [])]:
            for target in ('in_progress', 'approved', 'changes_requested', 'retracted'):
                with self.subTest(status=status, target=target):
                    update = parse_command(command('transition-review', expectedVersion=1, id='review', status=target,
                                                   note='I inspected the saved revision.', confirmedLocalDecision=True))
                    if target in allowed:
                        self.assertEqual(change_record(replace(review, status=status), update, 't1', 'event').status, target)
                    else:
                        with self.assertRaises(ValueError):
                            change_record(replace(review, status=status), update, 't1', 'event')
        approve = parse_command(command('transition-review', expectedVersion=1, id='review', status='approved',
                                        note='Verified the recorded method.', confirmedLocalDecision=True))
        approved = change_record(review, approve, 't1', 'unused')
        retract = parse_command(command('transition-review', expectedVersion=2, id='review', status='retracted',
                                        note='Found an incorrect amount.', confirmedLocalDecision=True))
        withdrawn = change_record(approved, retract, 't2', 'unused')
        self.assertEqual((withdrawn.decision_at, withdrawn.decision_status, withdrawn.decision_reason),
                         ('t1', 'approved', 'Verified the recorded method.'))
        self.assertEqual(withdrawn.note, 'Found an incorrect amount.')

    def test_input_guards_and_identity_scope(self):
        good = command('request-review', revision=1, reviewerDisplay='Local scientist', mode='local_self_review')
        for change in ({'expectedVersion': True}, {'expectedVersion': 1}, {'revision': 0},
                       {'reviewerDisplay': 'A colleague'}, {'mode': 'independent'}, {'unexpected': True}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                parse_command({**good, **change})
        decision = command('transition-review', id='review', expectedVersion=1, status='approved', note='Checked',
                           confirmedLocalDecision=True)
        for change in ({'confirmedLocalDecision': False}, {'confirmedLocalDecision': 'true'}, {'note': ''}, {'status': 'requested'}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                parse_command({**decision, **change})
        review = change_record(None, parse_command(good), 't0', 'review')
        for change, error in [({'expectedVersion': 2}, ReviewConflict), ({'actorDisplay': 'A colleague'}, ValueError)]:
            with self.subTest(change=change), self.assertRaises(error):
                change_record(review, parse_command({**decision, **change}), 't1', 'unused')
        for deadline in ('2026-02-30', '2026-1-1', 'tomorrow', None):
            with self.subTest(deadline=deadline), self.assertRaises(ValueError):
                parse_command(command('create-task', revision=1, title='Check', ownerDisplay='Local scientist', deadline=deadline))

    def test_thread_reply_edit_resolve_and_reopen(self):
        thread = CommentThread('thread', 1, Anchor(1, 'source'), 'open', (Comment('first', 'A', 'Local scientist', 't0'),), 't0')
        reply = parse_command(command('reply', id='thread', expectedVersion=1, text='B'))
        thread = change_record(thread, reply, 't1', 'second')
        edited = parse_command(command('edit-comment', id='thread', commentId='first', expectedVersion=2, text='A corrected'))
        thread = change_record(thread, edited, 't2', 'unused')
        self.assertEqual([(item.text, item.edited_at) for item in thread.comments], [('A corrected', 't2'), ('B', None)])
        resolve = parse_command(command('resolve-thread', id='thread', expectedVersion=3))
        thread = change_record(thread, resolve, 't3', 'unused')
        with self.assertRaisesRegex(ValueError, 'Reopen'):
            change_record(thread, replace(reply, expected_version=4), 't4', 'third')
        reopen = parse_command(command('reopen-thread', id='thread', expectedVersion=4))
        thread = change_record(thread, reopen, 't4', 'unused')
        self.assertEqual(thread.status, 'open')


class ReviewStoreTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.entries = EntryStore(self.directory.name)
        self.entry = self.entries.create(document())
        self.reviews = ReviewStore(self.entries)

    def apply(self, action, **values):
        return self.reviews.apply(self.entry.identity, command(action, **values))

    def test_revision_pinning_staleness_fresh_request_and_reopen(self):
        created = self.apply('request-review', revision=1, reviewerDisplay='Local scientist', mode='local_self_review')
        original_id = created['recordId']
        approved = self.apply('transition-review', requestId='approve', id=original_id, expectedVersion=1,
                              status='approved', note='Read revision one', confirmedLocalDecision=True)
        self.assertFalse(approved['reviews'][0]['stale'])
        self.entries.commit(self.entry.identity, 1, lambda _old: document('Edited values'))
        reopened = ReviewStore(EntryStore(self.directory.name)).read(self.entry.identity)
        self.assertEqual((reopened['reviews'][0]['status'], reopened['reviews'][0]['anchor']['revision'], reopened['reviews'][0]['stale']),
                         ('approved', 1, True))
        fresh = self.apply('request-review', requestId='fresh', revision=2, reviewerDisplay='Local scientist',
                           mode='local_self_review', previousReviewId=original_id)
        self.assertEqual(len(fresh['reviews']), 2)
        self.assertEqual((fresh['reviews'][0]['status'], fresh['reviews'][0]['stale']), ('requested', False))
        self.assertEqual(fresh['reviews'][0]['previousReviewId'], original_id)
        self.assertEqual(fresh['reviews'][1]['decisionReason'], 'Read revision one')
        self.assertEqual([event['action'] for event in fresh['activity']], ['request-review', 'transition-review', 'request-review'])

    def test_comments_keep_deleted_anchor_and_quoted_context(self):
        created = self.apply('create-thread', revision=1, blockId='source', quote='Original', text='Check this value')
        first = created['threads'][0]
        self.assertEqual(first['anchorStatus'], 'current')
        self.entries.commit(self.entry.identity, 1, lambda _old: document('New content'))
        self.assertEqual(self.reviews.read(self.entry.identity)['threads'][0]['anchorStatus'], 'changed')
        other = NotebookDocument.parse({'schemaVersion': 1, 'title': 'Different block', 'content': {'type': 'doc', 'content': [
            {'type': 'paragraph', 'attrs': {'blockId': 'replacement'}}]}})
        self.entries.commit(self.entry.identity, 2, lambda _old: other)
        retained = self.reviews.read(self.entry.identity)['threads'][0]
        self.assertEqual((retained['anchorStatus'], retained['anchor']['quote'], retained['comments'][0]['text']),
                         ('missing', 'Original', 'Check this value'))
        self.assertIsNotNone(self.entries.read(self.entry.identity, 1).document.block('source'))

    def test_validation_is_atomic_and_records_belong_to_one_entry(self):
        for values, error in [({'revision': 2}, MissingEntry), ({'revision': 1, 'blockId': 'absent'}, MissingReviewObject),
                              ({'revision': 1, 'blockId': 'source', 'quote': 'Not there'}, ValueError)]:
            with self.subTest(values=values), self.assertRaises(error):
                self.apply('create-thread', text='Question', **values)
        self.assertEqual(self.reviews.read(self.entry.identity)['activity'], [])
        first = self.apply('create-thread', revision=1, text='Question')['threads'][0]
        other = self.entries.create(document('Another notebook'))
        with self.assertRaises(MissingReviewObject):
            self.reviews.apply(other.identity, command('reply', id=first['id'], expectedVersion=1, text='Wrong notebook'))
        with self.assertRaises(MissingReviewObject):
            self.apply('request-review', requestId='bad-parent', revision=1, mode='local_self_review',
                       reviewerDisplay='Local scientist', previousReviewId='missing')
        self.assertEqual(len(self.reviews.read(self.entry.identity)['activity']), 1)

    def test_tasks_persist_actual_status_owner_and_deadline_without_execution(self):
        created = self.apply('create-task', revision=1, blockId='source', title='Check units',
                             description='Compare source paper', ownerDisplay='Local scientist', deadline='2026-11-12')
        task = created['tasks'][0]
        for index, status in enumerate(('in_progress', 'done', 'todo', 'cancelled')):
            result = self.apply('update-task', requestId=f'update-{index}', id=task['id'], expectedVersion=index + 1,
                                title='Check units', description='Compare source paper', ownerDisplay='Local scientist',
                                deadline='2026-11-12', status=status)
            self.assertEqual(result['tasks'][0]['status'], status)
        task = ReviewStore(EntryStore(self.directory.name)).read(self.entry.identity)['tasks'][0]
        self.assertEqual((task['scope'], task['deadline'], task['version']), ('notebook_local', '2026-11-12', 5))

    def test_authenticated_http_routes_map_missing_conflicts_and_idempotent_retry(self):
        with ThreadingHTTPServer(('127.0.0.1', 0), handler(self.entries, 'review-secret')) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                path = f'/api/entries/{self.entry.identity}/review-workspace'
                def request(method, payload=None, authorized=True):
                    connection = HTTPConnection('127.0.0.1', server.server_port, timeout=3)
                    try:
                        headers = {'Content-Type': 'application/json'}
                        if authorized:
                            headers['X-Pero-App-Token'] = 'review-secret'
                        connection.request(method, path, json.dumps(payload) if payload else None, headers)
                        response = connection.getresponse()
                        return response.status, json.loads(response.read())
                    finally:
                        connection.close()
                self.assertEqual(request('GET', authorized=False)[0], 401)
                self.assertEqual(request('GET')[1]['threads'], [])
                create = command('create-thread', revision=1, blockId='source', text='Persist over HTTP')
                status, result = request('POST', create)
                self.assertEqual(status, 200)
                self.assertEqual(request('POST', create)[1]['recordId'], result['recordId'])
                update = command('resolve-thread', id=result['recordId'], requestId='resolve', expectedVersion=1)
                self.assertEqual(request('POST', update)[0], 200)
                status, conflict = request('POST', {**update, 'requestId': 'competing-update'})
                self.assertEqual((status, conflict['code'], conflict['currentVersion']), (409, 'review-conflict', 2))
                status, missing = request('POST', {**update, 'requestId': 'missing', 'id': 'missing'})
                self.assertEqual((status, missing['code']), (404, 'not-found'))
                status, invalid = request('POST', command('transition-review', id='missing', expectedVersion=1,
                    note='No invented approval', status='approved', confirmedLocalDecision=False))
                self.assertEqual((status, invalid['code']), (400, 'invalid-request'))
                self.assertEqual(len(request('GET')[1]['activity']), 2)
            finally:
                server.shutdown()
                thread.join(timeout=3)

    def test_idempotent_retry_and_competing_changes(self):
        created = self.apply('create-thread', revision=1, text='Question')
        replay = self.apply('create-thread', revision=1, text='Question')
        self.assertEqual(created['recordId'], replay['recordId'])
        self.assertTrue(replay['replayed'])
        self.assertEqual(len(replay['activity']), 1)
        with self.assertRaisesRegex(ValueError, 'different change'):
            self.apply('create-thread', revision=1, text='Different request using the same identity')
        barrier = threading.Barrier(2)
        def reply(number):
            barrier.wait(timeout=3)
            try:
                return self.apply('reply', id=created['recordId'], expectedVersion=1, requestId=f'reply-{number}', text=f'Reply {number}')
            except ReviewConflict as error:
                return error.current_version
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(reply, (1, 2)))
        self.assertEqual(outcomes.count(2), 1)
        state = self.reviews.read(self.entry.identity)
        self.assertEqual(len(state['threads'][0]['comments']), 2)
        self.assertEqual(len(state['activity']), 2)


if __name__ == '__main__':
    unittest.main()
