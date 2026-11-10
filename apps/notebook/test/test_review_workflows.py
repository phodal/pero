"""Original local workflow semantics, with real SQLite/HTTP transport coverage."""
from dataclasses import replace
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
import threading
import unittest

from test_reviews import document, command
import test_reviews as fixtures
from reviews import ReviewConflict, MissingReviewObject, ReviewStore
from review_workflows import (ReviewStage, ReviewWorkflow, change_workflow, parse_workflow_command,
                              request_workflow, save_workflow)
from store import EntryStore
from server import handler


def config_command(**values):
    return command('save-workflow', name='Scientific local review', stages=[
        {'id': 'method', 'name': 'Method', 'participants': ['Local scientist', 'Local peer']},
        {'id': 'release', 'name': 'Release', 'participants': ['Local scientist']}], **values)


def decision(run, assignment='s0-p0', **values):
    return command('decide-workflow', id=run.id, expectedVersion=run.version, assignmentId=assignment,
                   decision='approved', reason='I checked the pinned revision', confirmedLocalDecision=True, **values)


class WorkflowCoreTest(unittest.TestCase):
    def setUp(self):
        self.config = save_workflow(None, parse_workflow_command(config_command()), 't0', 'flow')
        request = parse_workflow_command(command('request-workflow', revision=1, workflowId='flow', workflowVersion=1))
        self.run = request_workflow(self.config, request, 't1', 'run')

    def test_ordered_stages_and_parallel_decisions(self):
        for slot, actor, error in [('s1-p0', 'Local scientist', 'earlier stage'), ('s0-p1', 'Local scientist', 'impersonated')]:
            with self.subTest(slot=slot), self.assertRaisesRegex(ValueError, error):
                change_workflow(self.run, parse_workflow_command(decision(self.run, slot, actorDisplay=actor)), 't2')
        first = change_workflow(self.run, parse_workflow_command(decision(self.run)), 't2')
        self.assertEqual((first.status, first.active_stage), ('requested', 'method'))
        second = change_workflow(first, parse_workflow_command(decision(first, 's0-p1', actorDisplay='Local peer')), 't3')
        self.assertEqual(second.active_stage, 'release')
        complete = change_workflow(second, parse_workflow_command(decision(second, 's1-p0')), 't4')
        self.assertEqual((complete.status, complete.active_stage), ('approved', None))
        self.assertEqual([item.decided_at for item in complete.assignments], ['t2', 't3', 't4'])
        self.assertEqual(self.run.assignments[0].status, 'pending')

    def test_reassignment_keeps_configuration_and_completed_decisions(self):
        first = change_workflow(self.run, parse_workflow_command(decision(self.run)), 't2')
        base = command('reassign-workflow', id=first.id, expectedVersion=first.version, assignmentId='s0-p1',
                       participantDisplay='Replacement label', reason='Participant unavailable')
        changed = change_workflow(first, parse_workflow_command(base), 't3')
        self.assertEqual(changed.workflow.stages[0].participants, ('Local scientist', 'Local peer'))
        self.assertEqual(changed.assignments[1].participant, 'Replacement label')
        self.assertEqual(changed.assignments[0], first.assignments[0])
        for patch, error in [({'assignmentId': 's0-p0'}, 'recorded decision'), ({'participantDisplay': 'Local scientist'}, 'already assigned')]:
            with self.subTest(patch=patch), self.assertRaisesRegex(ValueError, error):
                change_workflow(first, parse_workflow_command({**base, **patch}), 't3')

    def test_terminal_decisions_withdrawal_and_conflict(self):
        for status in ('changes_requested', 'rejected'):
            with self.subTest(status=status):
                stopped = change_workflow(self.run, parse_workflow_command({**decision(self.run), 'decision': status}), 't2')
                self.assertEqual((stopped.status, stopped.active_stage), (status, None))
                with self.assertRaisesRegex(ValueError, 'closed'):
                    change_workflow(stopped, parse_workflow_command(decision(stopped, 's1-p0')), 't3')
                withdrawn = change_workflow(stopped, parse_workflow_command(command('withdraw-workflow', id='run',
                    expectedVersion=2, reason='Superseded by corrected revision')), 't3')
                self.assertEqual(withdrawn.assignments, stopped.assignments)
                self.assertEqual(withdrawn.status, 'withdrawn')
        with self.assertRaises(ReviewConflict):
            change_workflow(self.run, parse_workflow_command({**decision(self.run), 'expectedVersion': 4}), 't2')
        with self.assertRaisesRegex(ValueError, 'requester'):
            change_workflow(self.run, parse_workflow_command(command('withdraw-workflow', id='run', expectedVersion=1,
                            reason='Cancel', actorDisplay='Other label')), 't2')

    def test_invalid_workflow_inputs_never_create_permissive_defaults(self):
        for patch in ({'stages': []}, {'stages': [{'id': 'a', 'name': 'One', 'participants': []}]},
                      {'stages': [{'id': 'a', 'name': 'One', 'participants': ['Same', ' Same ']}]},
                      {'name': ''}, {'extra': True}, {'expectedVersion': True}):
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                parse_workflow_command({**config_command(), **patch})
        for patch in ({'confirmedLocalDecision': False}, {'decision': 'delivered'}, {'reason': ''}):
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                parse_workflow_command({**decision(self.run), **patch})
        with self.assertRaisesRegex(ValueError, 'distinct'):
            stages = config_command()['stages']
            parse_workflow_command({**config_command(), 'stages': [stages[0], stages[0]]})


class WorkflowStoreTest(unittest.TestCase):
    setUp = fixtures.ReviewStoreTest.setUp
    apply = fixtures.ReviewStoreTest.apply

    def test_config_snapshots_run_history_staleness_reopen_and_request_replay(self):
        saved = self.reviews.apply(self.entry.identity, config_command())
        config = saved['workflowConfigs'][0]
        request = command('request-workflow', requestId='start', revision=1, workflowId=config['id'], workflowVersion=1)
        run = self.reviews.apply(self.entry.identity, request)['workflowRuns'][0]
        updated = self.reviews.apply(self.entry.identity, {**config_command(), 'requestId': 'change-plan', 'id': config['id'],
            'expectedVersion': 1, 'name': 'Changed future plan', 'stages': [{'id': 'new', 'name': 'One', 'participants': ['New label']}]})
        self.assertEqual(updated['workflowRuns'][0]['workflow']['name'], 'Scientific local review')
        self.assertEqual(len(updated['workflowConfigs']), 2)
        self.entries.commit(self.entry.identity, 1, lambda _old: document('New source'))
        reopened = ReviewStore(EntryStore(self.directory.name)).read(self.entry.identity)
        self.assertTrue(reopened['workflowRuns'][0]['stale'])
        replay = self.reviews.apply(self.entry.identity, request)
        self.assertTrue(replay['replayed'])
        self.assertEqual(len(replay['workflowRuns']), 1)
        self.assertEqual(len(replay['activity']), 3)
        with self.assertRaisesRegex(ValueError, 'different change'):
            self.reviews.apply(self.entry.identity, {**request, 'revision': 2})
        fresh = self.reviews.apply(self.entry.identity, {**request, 'requestId': 'fresh', 'revision': 2, 'previousRunId': run['id']})
        self.assertEqual(fresh['workflowRuns'][0]['previousRunId'], run['id'])
        self.assertFalse(fresh['workflowRuns'][0]['stale'])
        self.assertEqual(fresh['workflowRuns'][0]['workflow']['version'], 1)
        other = self.entries.create(document('Other'))
        with self.assertRaises(MissingReviewObject):
            self.reviews.apply(other.identity, request)
        with self.assertRaises(ReviewConflict):
            self.reviews.apply(self.entry.identity, {**config_command(), 'id': config['id'], 'expectedVersion': 1, 'requestId': 'stale-config'})

    def test_reassignment_and_decision_events_remain_after_reload(self):
        config = self.reviews.apply(self.entry.identity, config_command())['workflowConfigs'][0]
        run = self.apply('request-workflow', requestId='start', revision=1, workflowId=config['id'], workflowVersion=1)['workflowRuns'][0]
        assigned = self.apply('reassign-workflow', requestId='assign', id=run['id'], expectedVersion=1,
            assignmentId='s0-p1', participantDisplay='Replacement', reason='Scheduling change')
        detail = json.loads(assigned['activity'][0]['detail'])
        self.assertEqual(detail['previousAssignment']['participant'], 'Local peer')
        self.assertEqual(detail['command']['participant'], 'Replacement')
        decided = self.apply('decide-workflow', requestId='approve', id=run['id'], expectedVersion=2,
            assignmentId='s0-p0', decision='approved', reason='Checked source', confirmedLocalDecision=True)
        self.assertEqual(decided['workflowRuns'][0]['assignments'][0]['identityScope'], 'unverified_local_label')
        self.assertEqual(ReviewStore(EntryStore(self.directory.name)).read(self.entry.identity)['workflowRuns'], decided['workflowRuns'])

    def test_bulk_partial_success_is_durable_idempotent_and_preserves_fields(self):
        first = self.apply('create-task', title='First', ownerDisplay='Local scientist', revision=1)['tasks'][0]
        second = self.apply('create-task', requestId='second', title='Second', ownerDisplay='Local scientist', revision=1)['tasks'][0]
        self.apply('set-task-status', requestId='advance', expectedVersion=1, id=second['id'], status='in_progress')
        batch = {'action': 'bulk-change', 'requestId': 'batch', 'actorDisplay': 'Local scientist', 'changes': [
            {'action': 'set-task-status', 'id': first['id'], 'expectedVersion': 1, 'status': 'done'},
            {'action': 'set-task-status', 'id': second['id'], 'expectedVersion': 1, 'status': 'done'},
            {'action': 'resolve-thread', 'id': 'missing', 'expectedVersion': 1}]}
        changed = self.reviews.apply(self.entry.identity, batch)
        self.assertEqual([item['ok'] for item in changed['bulkResults']], [True, False, False])
        self.assertEqual([item.get('code') for item in changed['bulkResults']], [None, 'review-conflict', 'not-found'])
        replay = ReviewStore(EntryStore(self.directory.name)).apply(self.entry.identity, batch)
        self.assertTrue(replay['replayed'])
        self.assertEqual(replay['bulkResults'], changed['bulkResults'])
        self.assertEqual(len(replay['activity']), 4)
        self.assertEqual({item['title']: item['status'] for item in replay['tasks']}, {'First': 'done', 'Second': 'in_progress'})
        with self.assertRaisesRegex(ValueError, 'different change'):
            self.reviews.apply(self.entry.identity, {**batch, 'changes': batch['changes'][:1]})
        reassigned = self.reviews.apply(self.entry.identity, {**batch, 'requestId': 'assign-batch', 'changes': [
            {'action': 'reassign-task', 'id': first['id'], 'expectedVersion': 2, 'ownerDisplay': 'New owner', 'reason': 'Coverage'}]})
        task = next(item for item in reassigned['tasks'] if item['id'] == first['id'])
        self.assertEqual((task['title'], task['status'], task['ownerDisplay']), ('First', 'done', 'New owner'))
        self.assertIn('Coverage', reassigned['activity'][0]['detail'])

    def test_bulk_comments_requests_and_retractions_reuse_domain_rules(self):
        thread = self.apply('create-thread', revision=1, text='Question')['recordId']
        batch = {'action': 'bulk-change', 'requestId': 'first-batch', 'actorDisplay': 'Local scientist', 'changes': [
            {'action': 'resolve-thread', 'id': thread, 'expectedVersion': 1},
            {'action': 'request-review', 'expectedVersion': 0, 'revision': 1, 'mode': 'local_self_review', 'reviewerDisplay': 'Local scientist'}]}
        first = self.reviews.apply(self.entry.identity, batch)
        review = first['reviews'][0]
        second = self.reviews.apply(self.entry.identity, {**batch, 'requestId': 'second-batch', 'changes': [
            {'action': 'reopen-thread', 'id': thread, 'expectedVersion': 2},
            {'action': 'transition-review', 'id': review['id'], 'expectedVersion': 1, 'status': 'retracted',
             'note': 'Starting a new review', 'confirmedLocalDecision': True}]})
        self.assertTrue(all(item['ok'] for item in second['bulkResults']))
        self.assertEqual(second['threads'][0]['status'], 'open')
        self.assertEqual(second['reviews'][0]['status'], 'retracted')

    def test_http_workflow_configuration_selection_conflict_and_batch_outcomes(self):
        with ThreadingHTTPServer(('127.0.0.1', 0), handler(self.entries, 'workflow-secret')) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            def post(payload):
                connection = HTTPConnection('127.0.0.1', server.server_port, timeout=3)
                try:
                    connection.request('POST', f'/api/entries/{self.entry.identity}/review-workspace', json.dumps(payload),
                                       {'Content-Type': 'application/json', 'X-Pero-App-Token': 'workflow-secret'})
                    response = connection.getresponse()
                    return response.status, json.loads(response.read())
                finally:
                    connection.close()
            try:
                status, saved = post(config_command()); self.assertEqual(status, 200)
                config = saved['workflowConfigs'][0]
                request = command('request-workflow', requestId='request-run', revision=1, workflowId=config['id'], workflowVersion=1)
                status, result = post(request); self.assertEqual(status, 200)
                run = result['workflowRuns'][0]
                wrong = command('decide-workflow', requestId='wrong-identity', id=run['id'], expectedVersion=1,
                    assignmentId='s0-p1', decision='approved', reason='No impersonation', confirmedLocalDecision=True)
                self.assertEqual(post(wrong)[0], 400)
                accepted = {**wrong, 'requestId': 'own', 'assignmentId': 's0-p0'}
                self.assertEqual(post(accepted)[0], 200)
                self.assertTrue(post(accepted)[1]['replayed'])
                self.assertEqual(post({**accepted, 'requestId': 'conflict'})[0], 409)
                self.assertEqual(post({**request, 'requestId': 'missing', 'workflowVersion': 77})[0], 404)
                status, results = post({'action': 'bulk-change', 'actorDisplay': 'Local scientist', 'requestId': 'partial',
                    'changes': [{'action': 'resolve-thread', 'id': 'missing', 'expectedVersion': 1}]})
                self.assertEqual(status, 200); self.assertFalse(results['bulkResults'][0]['ok'])
            finally:
                server.shutdown(); thread.join(timeout=3)


if __name__ == '__main__':
    unittest.main()
