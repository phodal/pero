"""Committed autonomous findings reuse the existing immutable research records."""
import tempfile
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

import test_research_programs as acceptance
from test_program_html import official_html_fixture
from test_research import NOW, reading
from test_scientific_document import URL
from test_studies import final_report
from paper_agent.model import Invalid, PaperSnapshot, PdfPassage, digest
from paper_agent.paper_documents import PaperDocuments
from paper_agent.pdf import PdfDocument, PdfPage
from paper_agent.research_commands import execute
from paper_agent.research_jobs import ResearchJobs
from paper_agent.research_program_store import ResearchPrograms
from paper_agent.research_record_commands import record_command
from paper_agent.store import ResearchStore


class ProgramRecordsAcceptance(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = ResearchStore(self.directory.name)
        self.programs = ResearchPrograms(self.store)

    def perform(self, operation, identity, **fields):
        command = dict(operation=operation, operationId=identity,
                       programId=self.state['id'], expectedCheckpoint=self.state['checkpoint'], **fields)
        self.state = self.programs.command(command, NOW)
        return command

    def pdf_claim(self, paper, candidate_id, number):
        self.perform('prepare-study', f'prepare-{number}', candidateIds=[candidate_id],
                     question=f'Which condition is observed in round {number}?')
        study_id = self.state['study']['id']
        self.perform('study-step', f'read-{number}',
                     document=dict(studyId=study_id, action='read', paperId=paper.id, page=number))
        passage = PdfPassage.from_record(self.state['result']['observation']['passages'][0])
        self.perform('study-step', f'finalize-{number}', document=dict(studyId=study_id,
                     action='finalize', report=final_report(self.store.study(study_id), passage)))
        return dict(text=f'Observed condition {number} remains a synthetic finding.', stance='support',
                    reportId=self.state['result']['reportId'], paperId=paper.id, passageId=passage.id)

    def test_rounds_publish_reusable_revisions_without_rewriting_or_retry_duplicates(self):
        paper = self.store.save_paper(PaperSnapshot.from_reading(reading(), NOW))
        pdf_bytes = b'immutable research record PDF fixture'
        self.store.save_pdf(PdfDocument.create(paper.id, digest(pdf_bytes), paper.url, (
            PdfPage(1, 600, 800, 'The synthetic method assumes a fixed model.'),
            PdfPage(2, 600, 800, 'The synthetic model fails under mismatch.'),
        ), NOW), pdf_bytes)
        self.state = self.programs.command(acceptance.ResearchProgramsAcceptance.plan(paper), NOW)
        candidate_id = self.state['candidates'][0]['id']
        revisions = []
        snapshots = []
        for number in (1, 2):
            claim = self.pdf_claim(paper, candidate_id, number)
            command = self.perform('commit-round', f'commit-{number}',
                question=f'Which condition is observed in round {number}?',
                reportIds=[claim['reportId']], claims=[claim], gaps=['Independent replication missing'],
                nextAction='Find independent counterevidence')
            round_ids = self.state['rounds'][-1]['researchRecordIds']
            self.assertEqual(len(round_ids), 1)
            revisions.extend(round_ids)
            self.assertEqual(self.state['researchRecordIds'], revisions)
            record = record_command(self.store, dict(operation='read', recordId=round_ids[0]), NOW)
            snapshots.append(record)
            self.assertEqual(record['parentId'], revisions[-2] if number == 2 else None)
            self.assertEqual(record['review']['decision'], 'needs_review')
            self.assertEqual(record['verification'], 'not_run')
            self.assertEqual(record['paperIds'], [paper.id])
            self.assertEqual([link['reportId'] for link in record['evidence']], [claim['reportId']])
            self.assertNotIn('sourceKind', record['evidence'][0])
            self.assertEqual(self.programs.command(command, NOW), self.state)
            self.assertEqual(len(record_command(self.store, dict(operation='list'), NOW)['records']), number)

        reopened = ResearchStore(self.directory.name)
        for record in snapshots:
            self.assertEqual(record_command(reopened, dict(operation='read', recordId=record['id']), NOW), record)
        restored = ResearchPrograms(reopened).command(dict(operation='read', programId=self.state['id']), NOW)
        self.assertEqual(restored['researchRecordIds'], revisions)
        self.assertEqual(restored['acceptance'], 'needs_review')

    def test_exhausted_round_budget_cannot_publish_an_orphan_revision(self):
        paper = self.store.save_paper(PaperSnapshot.from_reading(reading(), NOW))
        original = b'bounded revision synthetic PDF'
        self.store.save_pdf(PdfDocument.create(paper.id, digest(original), paper.url,
            (PdfPage(1, 600, 800, 'The synthetic evidence remains unverified.'),), NOW), original)
        self.state = self.programs.command(acceptance.ResearchProgramsAcceptance.plan(
            paper, limits=dict(rounds=1, reads=2)), NOW)
        claim = self.pdf_claim(paper, self.state['candidates'][0]['id'], 1)
        command = self.perform('commit-round', 'last-allowed-round', question='Which condition was observed?',
            reportIds=[claim['reportId']], claims=[claim], gaps=['Independent replication missing'],
            nextAction='Read independent evidence')
        self.assertEqual(self.state['stopReason'], 'round_limit')
        saved_records = record_command(self.store, dict(operation='list'), NOW)['records']
        self.assertEqual(len(saved_records), 1)
        rejected = {**command, 'operationId': 'over-budget-round', 'expectedCheckpoint': self.state['checkpoint']}
        with self.assertRaises(Invalid):
            self.programs.command(rejected, NOW)
        self.assertEqual(record_command(self.store, dict(operation='list'), NOW)['records'], saved_records)
        reopened = ResearchPrograms(ResearchStore(self.directory.name)).command(
            dict(operation='read', programId=self.state['id']), NOW)
        self.assertEqual(reopened['checkpoint'], self.state['checkpoint'])
        self.assertEqual(reopened['usage']['rounds'], 1)
        self.assertEqual(reopened['researchRecordIds'], self.state['researchRecordIds'])

    def test_html_record_references_the_observed_source_report_without_pdf_evidence(self):
        paper = self.store.save_paper(PaperSnapshot.from_reading(dict(
            source='alphaxiv', sourceId=URL.rsplit('/', 1)[-1], title='Synthetic structured paper',
            url=URL.replace('/html/', '/abs/'), contentKind='abstract', content='Synthetic original abstract.'), NOW))
        self.state = self.programs.command(acceptance.ResearchProgramsAcceptance.plan(
            paper, acquisition='public_fulltext'), NOW)
        jobs = ResearchJobs(self.programs, worker=official_html_fixture)
        self.addCleanup(jobs.close)
        self.programs.jobs = jobs
        started = jobs.command(dict(operation='acquire', representation='html', programId=self.state['id'],
            candidateId=self.state['candidates'][0]['id'], expectedCheckpoint=self.state['checkpoint'],
            operationId='acquire-html'), NOW)
        process = jobs.running[started['job']['id']][1]
        process.join(timeout=10)
        self.assertFalse(process.is_alive())
        self.state = jobs.command(dict(operation='poll', programId=self.state['id'], jobId=started['job']['id']), NOW)
        self.assertEqual(self.state['job']['status'], 'completed')
        candidate = self.state['candidates'][0]
        document, _ = PaperDocuments(self.store).read(candidate['htmlDocumentId'])
        block = next(block for block in document.blocks if block.kind == 'paragraph' and block.text.strip())
        self.perform('source-step', 'html-read', candidateId=candidate['id'],
                     document=dict(operation='read', documentId=document.id, blockId=block.id, limit=4800))
        observation = self.state['result']
        self.perform('source-report', 'html-report', bundleId=observation['bundleId'],
                     title='Observed HTML condition', observationIds=[observation['observationId']])
        report = self.state['sourceReport']
        claim = dict(sourceKind='html', text='The fixture contains this observed condition.', stance='support',
                     reportId=report['id'], paperId=paper.id, observationId=observation['observationId'],
                     documentId=document.id, blockId=block.id, quote=observation['content'])
        self.perform('commit-round', 'html-commit', question='Which condition was observed?',
                     reportIds=[report['id']], claims=[claim], gaps=['Independent verification missing'],
                     nextAction='Read counterevidence')
        identity, = self.state['rounds'][0]['researchRecordIds']
        reopened = ResearchStore(self.directory.name)
        record = record_command(reopened, dict(operation='read', recordId=identity), NOW)
        link, = record['evidence']
        self.assertEqual(link['sourceKind'], 'html')
        self.assertEqual((link['paperId'], link['reportId']), (paper.id, report['id']))
        self.assertEqual(record['verification'], 'not_run')
        self.assertEqual(record['review']['decision'], 'needs_review')
        self.assertEqual(execute(reopened, 'source-report', dict(operation='read',
            bundleId=observation['bundleId'], reportId=link['reportId'])), report)
        self.assertEqual(reopened.library()['reports'], [])
        self.assertIsNone(reopened.paper_pdf(paper.id))
        record_command(reopened, dict(operation='export', recordId=identity), NOW)
        wrong_owner = {key: record[key] for key in (
            'question', 'scope', 'inclusion', 'exclusion', 'paperIds', 'decisions', 'evidence')}
        wrong_owner['evidence'] = [{**link, 'sourceKind': 'pdf'}]
        with self.assertRaises(Invalid):
            record_command(reopened, dict(operation='create', **wrong_owner), NOW)
        unrelated = reopened.save_paper(PaperSnapshot.from_reading(reading(sourceId='unrelated-paper'), NOW))
        wrong_owner.update(paperIds=[unrelated.id],
            decisions=[dict(paperId=unrelated.id, decision='include', reason='Unrelated local source')],
            evidence=[{**link, 'paperId': unrelated.id}])
        with self.assertRaises(Invalid):
            record_command(reopened, dict(operation='create', **wrong_owner), NOW)

    def test_commit_recovers_after_record_persistence_without_creating_another_revision(self):
        for interrupted_at in ('operation_receipt', 'program_head'):
            with self.subTest(interrupted_at=interrupted_at), tempfile.TemporaryDirectory() as root:
                self.store = ResearchStore(root)
                self.programs = ResearchPrograms(self.store)
                paper = self.store.save_paper(PaperSnapshot.from_reading(reading(), NOW))
                original = b'record recovery synthetic PDF'
                self.store.save_pdf(PdfDocument.create(paper.id, digest(original), paper.url,
                    (PdfPage(1, 600, 800, 'The synthetic evidence remains unverified.'),), NOW), original)
                self.state = self.programs.command(acceptance.ResearchProgramsAcceptance.plan(paper), NOW)
                claim = self.pdf_claim(paper, self.state['candidates'][0]['id'], 1)
                command = dict(operation='commit-round', operationId='recover-round', programId=self.state['id'],
                    expectedCheckpoint=self.state['checkpoint'], question='Which condition was observed?',
                    reportIds=[claim['reportId']], claims=[claim], gaps=['Independent replication missing'],
                    nextAction='Read independent evidence')
                write = self.programs._write

                def fail_at_publication(path, value):
                    selected = (path.name == 'head.json' if interrupted_at == 'program_head'
                                else path.parent.name == 'operations' and path.suffix == '.json'
                                and '.pending' not in path.name)
                    if selected:
                        raise OSError('Synthetic interruption before publication')
                    return write(path, value)

                with patch.object(self.programs, '_write', side_effect=fail_at_publication):
                    with self.assertRaisesRegex(OSError, 'Synthetic interruption'):
                        self.programs.command(command, NOW)
                persisted = record_command(self.store, dict(operation='list'), NOW)['records']
                self.assertEqual(len(persisted), 1)
                later = (datetime.fromisoformat(NOW.replace('Z', '+00:00')) + timedelta(minutes=1)).isoformat()
                reopened = ResearchStore(root)
                recovered = ResearchPrograms(reopened).command(command, later)
                self.assertEqual(recovered['usage']['rounds'], 1)
                self.assertEqual(recovered['researchRecordIds'], [persisted[0]['id']])
                self.assertEqual(record_command(reopened, dict(operation='list'), later)['records'], persisted)
                current = ResearchPrograms(ResearchStore(root)).command(
                    dict(operation='read', programId=self.state['id']), later)
                self.assertEqual(current['checkpoint'], recovered['checkpoint'])
                self.assertEqual(current['researchRecordIds'], recovered['researchRecordIds'])
                self.assertEqual(ResearchPrograms(reopened).command(command, later), recovered)


if __name__ == '__main__':
    unittest.main()
