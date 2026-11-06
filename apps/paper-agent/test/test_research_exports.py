"""Large research deliveries stay readable and pinned to an exact checkpoint."""
import hashlib
import json
import tempfile
import unittest

from test_research import NOW, reading
from test_studies import final_report
from paper_agent.model import PaperSnapshot, PdfPassage, digest
from paper_agent.pdf import PdfDocument, PdfPage
from paper_agent.research_program_store import ResearchPrograms
from paper_agent.store import ResearchStore


class ResearchExportAcceptance(unittest.TestCase):
    def test_large_evidence_parts_are_valid_and_exact_after_checkpoint_advance(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            paper = store.save_paper(PaperSnapshot.from_reading(reading(), NOW))
            pdf = b'large-export observed-source fixture'
            document = PdfDocument.create(paper.id, digest(pdf), paper.url,
                (PdfPage(1, 600, 800, 'Formal method. Exact original evidence.'),), NOW)
            store.save_pdf(document, pdf)
            programs = ResearchPrograms(store)
            state = programs.command(dict(operation='create', requestId='large-export',
                question='Can a large evidence table retain its exact observations?',
                scope='Synthetic export acceptance', inclusion='Observed source passages',
                exclusion='Unobserved claims', seedPaperIds=[paper.id], acquisition='saved_only'), NOW)

            def perform(operation, operation_id, **fields):
                return programs.command(dict(operation=operation, operationId=operation_id,
                    programId=state['id'], expectedCheckpoint=state['checkpoint'], **fields), NOW)

            state = perform('prepare-study', 'prepare-export',
                candidateIds=[state['candidates'][0]['id']], question='Read the original source')
            study_id = state['study']['id']
            state = perform('study-step', 'read-export',
                document=dict(studyId=study_id, action='read', paperId=paper.id, page=1))
            passage = PdfPassage.from_record(state['result']['observation']['passages'][0])
            state = perform('study-step', 'save-export-report',
                document=dict(studyId=study_id, action='finalize', report=final_report(store.study(study_id), passage)))
            report_id = state['result']['reportId']
            # Multibyte text and JSON punctuation exercise byte-sized boundaries without
            # changing the exact citation retained by the saved reading report.
            claim_texts = [f'Observation {index:02d}: ' + '数据"边界\\校验\n' * 400 + 'End.' for index in range(64)]
            state = perform('commit-round', 'large-export-round', question='Export all interpretations',
                reportIds=[report_id], claims=[dict(text=text, stance='limitation', reportId=report_id,
                    paperId=paper.id, passageId=passage.id, quote=passage.content[:40]) for text in claim_texts],
                gaps=['Scientific review is still required.'], nextAction='Review the exported evidence parts.')
            checkpoint = state['checkpoint']
            request = dict(programId=state['id'], checkpoint=checkpoint)
            exported = programs.command(dict(operation='export', **request), NOW)
            summary = next(part['content'] for part in exported['documents'] if part['slot'] == 'report')[:2000]
            self.assertIn('Final execution accounting: not yet recorded', summary)
            self.assertNotIn('Model attempts: 0', summary)
            self.assertNotIn('Stop reason: not_started', summary)
            evidence = [part for part in exported['documents']
                        if part['slot'] == 'evidence' or part['slot'].startswith('evidence-')]
            self.assertGreater(len(evidence), 1, 'the fixture must exceed one evidence part')
            self.assertGreater(sum(len(part['content'].encode()) for part in evidence), 160 * 1024)
            claims = []
            for index, part in enumerate(evidence, 1):
                parsed = json.loads(part['content'])
                self.assertEqual(parsed['checkpoint'], checkpoint)
                self.assertEqual(parsed['acceptance'], 'needs_review')
                self.assertEqual(parsed['part'], index)
                claims.extend(parsed['claims'])
            self.assertEqual([claim['text'] for claim in claims], claim_texts)
            self.assertTrue(all(claim['quote'] == passage.content[:40] for claim in claims))

            manifest = programs.command(dict(operation='export-manifest', **request), NOW)
            self.assertEqual(manifest['documents'],
                [{key: value for key, value in part.items() if key != 'content'} for part in exported['documents']])
            self.assertTrue(all('content' not in part for part in manifest['documents']))
            state = perform('finish', 'finish-export', reason='ready_for_review')
            self.assertNotEqual(state['checkpoint'], checkpoint)
            restored = ResearchPrograms(ResearchStore(root))
            self.assertEqual(restored.command(dict(operation='export-manifest', **request), NOW), manifest)
            for expected in exported['documents']:
                with self.subTest(slot=expected['slot']):
                    actual = restored.command(dict(operation='export', slot=expected['slot'], **request), NOW)
                    self.assertEqual(actual['checkpoint'], checkpoint)
                    self.assertEqual(actual['documents'], [expected])
                    self.assertEqual(hashlib.sha256(actual['documents'][0]['content'].encode()).hexdigest(),
                                     expected['sha256'])
