"""Manual record invariants and one authenticated persistence seam; no science runs."""
import copy
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest

from test_research import NOW, reading, request, report_value
from paper_agent.model import Invalid, PaperSnapshot
from paper_agent.research_record_commands import record_command
from paper_agent.store import ResearchStore


def draft(papers, **changes):
    return dict(operation='create', question='Which method fits?', scope='Synthetic local comparison',
                inclusion='Known conditions', exclusion='Missing conditions', paperIds=[p.id for p in papers],
                decisions=[dict(paperId=p.id, decision='pending', reason='Needs review') for p in papers],
                evidence=[], **changes)


class ResearchRecords(unittest.TestCase):
    def test_revision_screening_evidence_review_and_reopen(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            papers = [store.save_paper(PaperSnapshot.from_reading(reading(sourceId=str(i)), NOW)) for i in range(2)]
            intent = store.prepare(request(papers), NOW)
            report = store.save_report(intent.id, json.dumps(report_value(intent)), NOW)
            value = draft(papers, parentId=None)
            value['evidence'] = [dict(paperId=papers[0].id, reportId=report.id, stance='counterevidence', note='Only a synthetic finding')]
            first = record_command(store, value, NOW)
            amended = {**value, 'scope': 'Narrower conditions', 'parentId': first['id'],
                       'review': dict(decision='rejected', note='Unresolved applicability')}
            second = record_command(store, amended, NOW)
            reopened = ResearchStore(root)
            self.assertEqual(record_command(reopened, {'operation': 'read', 'recordId': first['id']}, NOW)['scope'], value['scope'])
            self.assertEqual(second['parentId'], first['id'])
            self.assertEqual(second['review']['identityScope'], 'local-user-declared')
            self.assertEqual(second['verification'], 'not_run')
            self.assertEqual(len(record_command(reopened, {'operation': 'list'}, NOW)['records']), 2)
            for mutate in (
                lambda v: v.update(paperIds=[papers[0].id, papers[0].id]),
                lambda v: v['decisions'].pop(),
                lambda v: v['decisions'][0].update(reason=''),
                lambda v: v['decisions'][1].update(paperId=papers[0].id),
                lambda v: v['evidence'][0].update(paperId=papers[1].id),
                lambda v: v['evidence'][0].update(reportId='0' * 64),
                lambda v: v['evidence'][0].update(reportId=None),
                lambda v: v.update(verification='PASS'),
                lambda v: v.update(parentId='0' * 64),
                lambda v: v.update(review=dict(decision='accepted', note='OK', identityScope='independent')),
            ):
                invalid = copy.deepcopy(value)
                mutate(invalid)
                with self.subTest(value=invalid), self.assertRaises(Invalid):
                    record_command(store, invalid, NOW)
            # The Agent schema enforces shape/length; the domain still owns hex IDs
            # and saved-owner references (never provider source IDs).
            for identity in ('g' * 64, 'A' * 64, 'a' * 63, 'a' * 65, papers[0].source_id):
                for command in (
                    {**value, 'parentId': identity},
                    {**value, 'paperIds': [identity]},
                    {**value, 'decisions': [dict(paperId=identity, decision='pending', reason='Review')]},
                    {**value, 'evidence': [dict(paperId=identity, reportId=report.id, stance='support', note='Review')]},
                    {**value, 'evidence': [dict(paperId=papers[0].id, reportId=identity, stance='support', note='Review')]},
                    dict(operation='read', recordId=identity),
                    dict(operation='select', recordId=first['id'], paperIds=[identity]),
                ):
                    with self.subTest(command=command), self.assertRaises(Invalid):
                        record_command(store, command, NOW)
            # A missing evidence gap needs no forged report/observation.
            gap = draft(papers)
            gap['evidence'] = [dict(paperId=papers[1].id, stance='gap', note='No observed result')]
            for nullable in ({}, {'reportId': None}):
                gap['evidence'][0].update(nullable)
                self.assertIsNone(record_command(store, gap, NOW)['evidence'][0]['reportId'])

    def test_actual_saved_change_selection_and_private_export(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            paper = store.save_paper(PaperSnapshot.from_reading(reading(), NOW))
            record = record_command(store, draft([paper]), NOW)
            command = dict(operation='impact', recordId=record['id'])
            self.assertEqual(record_command(store, command, NOW)['items'][0]['status'], 'unchanged')
            changed = store.save_paper(PaperSnapshot.from_reading(reading(content='New actual saved fixture bytes'), NOW))
            impact = record_command(store, command, NOW)
            self.assertEqual(impact['items'][0]['candidatePaperIds'], [changed.id])
            self.assertEqual(impact['items'][0]['status'], 'changed')
            self.assertEqual(impact['upstreamStatus'], 'unknown')
            selected = record_command(store, dict(operation='select', recordId=record['id'], paperIds=[paper.id]), NOW)
            self.assertEqual(selected['execution'], 'not_requested')
            self.assertEqual(selected['verification'], 'not_run')
            reopened = record_command(ResearchStore(root), dict(operation='read', recordId=record['id']), NOW)
            self.assertEqual(reopened['selections'], [selected])
            for invalid_ids in ([changed.id], [{}], [[]], [None], [1], ['bad'], [paper.id, paper.id]):
                with self.subTest(paperIds=invalid_ids), self.assertRaises(Invalid):
                    record_command(store, dict(operation='select', recordId=record['id'], paperIds=invalid_ids), NOW)
            exported = record_command(store, dict(operation='export', recordId=record['id']), NOW)
            for private in ('Which method fits?', paper.content, root, paper.url):
                self.assertNotIn(private, json.dumps(exported))
            (store.root / 'papers' / (paper.id + '.json')).unlink()
            self.assertEqual(record_command(store, command, NOW)['items'][0]['status'], 'unknown')
            with self.assertRaises(Invalid):
                record_command(store, dict(operation='export', recordId=record['id']), NOW)
            self.assertEqual(record_command(store, dict(operation='read', recordId=record['id']), NOW)['id'], record['id'])
            self.assertFalse((store.root / 'studies').exists())

    def test_report_citations_across_sections_experiments_and_matrix(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            paper = store.save_paper(PaperSnapshot.from_reading(reading(), NOW))
            intent = store.prepare(request([paper]), NOW)
            for location in ('section', 'experiment', 'matrix', 'labels-only'):
                with self.subTest(location=location):
                    value = report_value(intent)
                    value['title'] = location
                    evidence = value['sections'][0].pop('evidence')
                    value['experiments'] = [dict(title='Not run', paperIds=[paper.id], evidence=[],
                        status='not-run', files=[], commands=[], expected='Not run', observed='Not run', limitations='Synthetic')]
                    value['matrix'] = dict(columns=[dict(id='finding', label='Finding')], cells=[
                        dict(paperId=paper.id, columnId='finding', value='', status='missing', evidence=[])])
                    if location == 'section':
                        value['sections'][0]['evidence'] = evidence
                    elif location == 'experiment':
                        value['experiments'][0]['evidence'] = evidence
                    elif location == 'matrix':
                        value['matrix']['cells'][0].update(value='Exact original evidence.', status='supported', evidence=evidence)
                    report = store.save_report(intent.id, json.dumps(value), NOW)
                    command = draft([paper])
                    command['evidence'] = [dict(paperId=paper.id, reportId=report.id, stance='support', note='Synthetic citation')]
                    if location == 'labels-only':
                        with self.assertRaisesRegex(Invalid, 'no cited evidence'):
                            record_command(store, command, NOW)
                    else:
                        record = record_command(store, command, NOW)
                        self.assertEqual(record['evidence'][0]['reportId'], report.id)

    def test_digest_changes_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            paper = store.save_paper(PaperSnapshot.from_reading(reading(), NOW))
            intent = store.prepare(request([paper]), NOW)
            report = store.save_report(intent.id, json.dumps(report_value(intent)), NOW)
            value = draft([paper])
            value['evidence'] = [dict(paperId=paper.id, reportId=report.id, stance='support', note='Local interpretation')]
            record = record_command(store, value, NOW)
            path = store.root / 'reports' / (report.id + '.json')
            alias = store.root / 'reports' / ('f' * 64 + '.json')
            alias.write_bytes(path.read_bytes())
            wrong = copy.deepcopy(value)
            wrong['evidence'][0]['reportId'] = 'f' * 64
            with self.assertRaises(Invalid):
                record_command(store, wrong, NOW)
            alias.unlink()
            original = store.root / 'papers' / (paper.id + '.json')
            alias = store.root / 'papers' / ('e' * 64 + '.json')
            alias.write_bytes(original.read_bytes())
            wrong = copy.deepcopy(value)
            wrong['paperIds'] = ['e' * 64]
            with self.assertRaises(Invalid):
                record_command(store, wrong, NOW)
            alias.unlink()
            tampered = json.loads(path.read_text())
            tampered['title'] = 'Changed report'
            path.write_text(json.dumps(tampered))
            for command in (value, dict(operation='export', recordId=record['id'])):
                with self.assertRaises(Invalid):
                    record_command(store, command, NOW)
            path = store.root / 'research-records' / (record['id'] + '.json')
            tampered = json.loads(path.read_text())
            tampered['scope'] = 'Overwritten'
            path.write_text(json.dumps(tampered))
            with self.assertRaises(Invalid):
                record_command(store, dict(operation='read', recordId=record['id']), NOW)

    def test_authenticated_api_and_cli_share_persistence(self):
        from paper_agent.http import handler
        from paper_agent.research_commands import execute
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            paper = store.save_paper(PaperSnapshot.from_reading(reading(), NOW))
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler(store, 'test-token'))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            def post(value, token='test-token'):
                conn = HTTPConnection('127.0.0.1', server.server_port, timeout=3)
                conn.request('POST', '/api/research/record', json.dumps(value),
                             {'X-Pero-App-Token': token, 'Content-Type': 'application/json'})
                response = conn.getresponse()
                result = response.status, json.loads(response.read())
                conn.close()
                return result
            try:
                self.assertEqual(post(draft([paper]), 'wrong')[0], 401)
                self.assertEqual(execute(store, 'record', dict(operation='list'))['records'], [])
                status, record = post(draft([paper]))
                self.assertEqual(status, 200)
                reopened = execute(ResearchStore(root), 'record', dict(operation='read', recordId=record['id']))
                self.assertEqual(reopened['id'], record['id'])
            finally:
                server.shutdown()
                thread.join(timeout=3)
                server.server_close()
