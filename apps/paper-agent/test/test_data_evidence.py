"""Data references cannot mint Paper quotations or turn execution into acceptance."""
import json
import tempfile
import unittest

from test_research import NOW, reading, request as research_request, report_value
from paper_agent.data_evidence import request
from paper_agent.model import Invalid, PaperSnapshot, digest
from paper_agent.store import ResearchStore
from paper_agent.pdf import PdfDocument, PdfPage


class DataEvidenceTests(unittest.TestCase):
    def test_canonical_claim_data_reference_and_restart(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            paper = store.save_paper(PaperSnapshot.from_reading(reading(), NOW))
            original = b'Synthetic original PDF bytes for an observation test'
            document = PdfDocument.create(paper.id, digest(original), paper.url,
                (PdfPage(1, 100, 100, 'Exact original evidence.'),), NOW)
            store.save_pdf(document, original)
            intent = store.prepare(research_request([paper], fullText=True, question='original evidence'), NOW)
            report_data = report_value(intent)
            report_data['sections'][0]['evidence'][0]['passageId'] = intent.passages[0].id
            report = store.save_report(intent.id, json.dumps(report_data), NOW)
            ref = report.report.sections[0].evidence[0]
            claim = dict(text='Synthetic arithmetic needs review', stance='limitation', reportId=report.id,
                         paperId=paper.id, passageId=ref.passage_id, evidenceIndex=0)
            query = dict(id='a' * 64, intent=dict(snapshotId='b' * 64, definitionId='c' * 64),
                         receipt=dict(status='completed', queryId='a' * 64, resultId='d' * 64))
            body = dict(operation='bind', claim=claim, query=query)
            link = request(store, body, internal=True)
            self.assertEqual(link['claim']['quote'], ref.quote)
            self.assertEqual(link['source']['contentDigest'], paper.content_digest)
            self.assertEqual(link['source']['fileDigest'], document.file_digest)
            updated = b'Later PDF under unchanged paper metadata'
            store.save_pdf(PdfDocument.create(paper.id, digest(updated), paper.url,
                (PdfPage(1, 100, 100, 'Changed evidence.'),), '2026-11-12T00:00:00Z'), updated)
            self.assertEqual(request(store, body, internal=True), link)
            self.assertEqual(link['acceptance'], 'needs_review')
            self.assertNotIn('receipt', link)
            self.assertEqual(request(ResearchStore(root), {'operation': 'list'})['links'], [link])
            for patch, internal in [({}, False), ({'claim': claim | {'quote': 'fabricated'}}, True),
                    ({'query': query | {'receipt': query['receipt'] | {'status': 'failed'}}}, True),
                    ({'query': query | {'id': 'e' * 64}}, True)]:
                with self.subTest(patch=patch, internal=internal), self.assertRaises(Invalid):
                    request(store, body | patch, internal=internal)
