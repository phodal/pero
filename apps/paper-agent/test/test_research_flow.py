"""Source import, bounded retrieval, follow-up context and manual corrections."""
import json
import tempfile
import unittest

from paper_agent.local_pdf import LocalPdf
from paper_agent.model import Invalid, ResearchInput, ResearchRequest
from paper_agent.pdf_files import PdfFiles
from paper_agent.research import RetrievalBatch, QueryProposal
from paper_agent.store import ResearchStore
from test_pdf import NOW, pdf_fixture


class ResearchFlow(unittest.TestCase):
    def test_local_pdf_identity_and_retrieval_conversation(self):
        files = PdfFiles()
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            upload = LocalPdf.parse(pdf_fixture(), 'Method.pdf')
            paper = store.import_pdf(upload, files, NOW)
            self.assertEqual(store.import_pdf(LocalPdf.parse(upload.data, 'renamed.pdf'), files, NOW), paper)
            self.assertEqual(paper.url, 'urn:sha256:' + upload.file_digest)
            self.assertEqual(store.pdf_bytes(store.paper_pdf(paper.id)), upload.data)
            request = ResearchRequest.parse(dict(question='第二页的方法是什么？', paperIds=[paper.id], requestId='bounded-research', fullText=True))
            plan = store.research_plan(request, NOW)
            batch = store.search_plan(plan.id, '先整理检索词。\n{"query":"unmatchedword"}')
            self.assertFalse(batch.passages)
            with self.assertRaises(Invalid): QueryProposal.parse('{"query":"one"} {"query":"two"}')
            batch = store.select_research(batch.id, json.dumps(dict(passageIds=[], followupQuery='Second page', gaps=['Need original method evidence'])))
            self.assertIsInstance(batch, RetrievalBatch)
            passage = batch.passages[0]
            with self.assertRaises(Invalid):
                store.select_research(batch.id, json.dumps(dict(passageIds=['0' * 64])))
            intent = store.select_research(batch.id, json.dumps(dict(passageIds=[passage.id], followupQuery='third query', gaps=['No GPU measurements'])))
            self.assertIsInstance(intent, ResearchInput)
            self.assertEqual(len(intent.retrieval.queries), 2)
            self.assertIn('Search budget exhausted.', intent.retrieval.gaps)
            quote = 'Second page. Exact original evidence.'
            ref = dict(paperId=paper.id, passageId=passage.id, quote=quote)
            raw = dict(schema='pero.paper-agent-report.v1', intentId=intent.id, title='Method answer',
                       sections=[dict(heading='Method',content='The method is described on the second page.',paperIds=[paper.id],evidence=[ref])],
                       experiments=[],limitations='No GPU experiment',matrix=dict(columns=[dict(id='method',label='Method')],
                       cells=[dict(paperId=paper.id,columnId='method',value='Original value',status='supported',evidence=[ref])]))
            saved = store.save_report(intent.id, json.dumps(raw), NOW)
            followup = ResearchRequest.parse(dict(question='它的限制呢？',paperIds=[paper.id],requestId='followup',fullText=True,parentIntentId=intent.id))
            next_plan = store.research_plan(followup, NOW)
            self.assertIn(request.question, next_plan.prompt())
            self.assertIn('second page', next_plan.prompt())
            self.assertEqual(next_plan.conversation[0].intent_id, intent.id)
            self.assertEqual(store.prepare(request, 'later'), intent)
            original = store.report(saved.id).to_dict()
            edit = dict(cell={**raw['matrix']['cells'][0], 'value':'Corrected value'},reason='Checked the source')
            shown = store.edit_matrix(saved.id, edit, NOW)
            self.assertEqual(shown['matrix']['cells'][0]['value'], 'Corrected value')
            self.assertEqual(shown['revisions'][0]['version'], 1)
            edit['cell']['value'] = 'Second correction'
            self.assertEqual(store.edit_matrix(saved.id, edit, NOW)['revisions'][-1]['version'], 2)
            self.assertEqual(store.report(saved.id).to_dict(), original)
            corrected_context = store.research_plan(ResearchRequest.parse({**followup.to_dict(), 'requestId':'after-correction'}), NOW)
            self.assertIn('Second correction', corrected_context.conversation[0].answer)
            self.assertIn('manually corrected', corrected_context.conversation[0].answer)
            self.assertNotIn('Second correction', store.retrieval_batch(batch.id).plan.prompt())
            reopened = ResearchStore(root)
            self.assertEqual(reopened.report_matrix(saved.id)['matrix']['cells'][0]['value'], 'Second correction')
            exported = json.loads(store.export(saved.id, 'json')['content'])
            self.assertEqual(exported['matrix']['cells'][0]['value'], 'Original value')
            self.assertEqual(exported['editedMatrix']['cells'][0]['value'], 'Second correction')
            self.assertIn('Manual matrix corrections', store.export(saved.id, 'markdown')['content'])
            edit['cell']['evidence'][0]['quote'] = 'Invented quotation'
            with self.assertRaises(Invalid): store.edit_matrix(saved.id, edit, NOW)

    def test_unsupported_question_has_no_fabricated_answer(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            paper = store.import_pdf(LocalPdf.parse(pdf_fixture(), 'source.pdf'), PdfFiles(), NOW)
            plan = store.research_plan(ResearchRequest.parse(dict(question='unsupported',paperIds=[paper.id],requestId='no-evidence',fullText=True)), NOW)
            batch = store.search_plan(plan.id, '{"query":"neveroccurs"}')
            with self.assertRaisesRegex(Invalid, 'No supporting PDF evidence'):
                store.select_research(batch.id, '{"passageIds":[],"followupQuery":null,"gaps":["Absent from retrieved evidence"]}')
            self.assertFalse(store.library()['reports'])
            with self.assertRaises(Invalid): LocalPdf.parse(b'not a PDF', 'file.pdf')
