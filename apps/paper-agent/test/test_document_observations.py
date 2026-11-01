"""Scientific reads use the existing observed-source ledger, never a second journal."""
from dataclasses import replace
from pathlib import Path
import tempfile
import unittest

from test_paper_documents import HtmlTransport, NOW, SOURCE, save_bundle
from paper_agent.model import Invalid, digest
from paper_agent.paper_documents import PaperDocuments
from paper_agent.source_reports import (SourceObservation, document_window, observed,
    record_document_observation, source_report, verify_observation)
from paper_agent.store import ResearchStore


class DocumentObservations(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = ResearchStore(self.directory.name)
        self.calls = Path(self.directory.name) / 'calls'
        self.documents = PaperDocuments(self.store, HtmlTransport(SOURCE, str(self.calls)))
        self.request = save_bundle(self.store, True)
        self.document = self.documents.prepare(self.request, NOW)
        self.receipt = self.documents._receipt(self.document.id)

    def read(self, block, start=0, limit=4800):
        return record_document_observation(self.store, self.receipt, self.document,
                                          self.document.read(block.id, start, limit))

    def observation(self, result):
        return observed(self.store, result['observationId'], self.request['bundleId'])

    def report(self, operation, **values):
        return source_report(self.store, dict(operation=operation, bundleId=self.request['bundleId'], **values), NOW)

    def test_typed_windows_idempotence_exact_scope_and_metadata_only_figures(self):
        for kind in ('paragraph', 'table', 'equation', 'figure'):
            block = next(b for b in self.document.blocks if b.kind == kind)
            result = self.read(block)
            self.assertEqual(result['evidenceAdmission'], 'tool-observed-scope')
            self.assertEqual(result['observationId'], self.read(block)['observationId'])
            observation = self.observation(result)
            scope = observation.documentScopes[0]
            self.assertEqual(scope.contentDigest, digest(document_window(result)))
            self.assertTrue(verify_observation(self.store, observation))
            self.assertFalse(verify_observation(self.store, replace(observation,
                documentScopes=(replace(scope, contentDigest='0' * 64),))))
            self.assertFalse(verify_observation(self.store, replace(observation,
                documentScopes=(replace(scope, parserRevision='different-parser'),))))
            if kind == 'figure':
                self.assertEqual(observation.to_dict()['anchor']['visualReview'], 'not_reviewed')
        paragraph = next(b for b in self.document.blocks if b.kind == 'paragraph' and len(b.text) > 4)
        small = self.read(paragraph, 1, 3)
        scope = self.observation(small).documentScopes[0]
        self.assertEqual((scope.start, scope.end), (1, 4))
        self.assertTrue(verify_observation(self.store, self.observation(small)))
        self.assertEqual(self.calls.read_text(), '1')

    def test_small_structured_windows_and_caption_only_are_exact_not_visual(self):
        table = next(b for b in self.document.blocks if b.kind == 'table')
        result = self.read(table, limit=400)
        self.assertLess(result['end'], result['totalItems'])
        self.assertTrue(verify_observation(self.store, self.observation(result)))
        projection = document_window(result)
        self.assertEqual(projection, document_window(dict(result, complete=False,
            parseStatus='partial', limitations=['different UI warning'], observationId='not-part-of-window')))
        self.documents.transport.data = SOURCE.replace(b'<img src="x1.png" alt="Synthetic diagram">', b'')
        self.document = self.documents.prepare(dict(self.request, refresh=True), 'later')
        self.receipt = self.documents._receipt(self.document.id)
        figure = next(b for b in self.document.blocks if b.kind == 'figure')
        result = self.read(figure)
        self.assertEqual((result['start'], result['end'], result['items']), (0, 0, []))
        self.assertTrue(result['context'])
        observation = self.observation(result)
        self.assertTrue(verify_observation(self.store, observation))
        self.assertEqual(observation.to_dict()['anchor']['visualReview'], 'not_reviewed')

    def test_empty_missing_and_nonread_operations_create_no_observation(self):
        self.document.outline()
        self.assertEqual(self.store._list('source-observations'), [])
        paragraph = next(b for b in self.document.blocks if b.kind == 'paragraph')
        self.assertNotIn('observationId', self.read(paragraph, len(paragraph.text)))
        table = next(b for b in self.document.blocks if b.kind == 'table')
        missing = self.read(table, limit=1)
        self.assertTrue(missing['missing'])
        self.assertNotIn('observationId', missing)
        self.assertEqual(self.store._list('source-observations'), [])

    def test_historical_authorization_offline_report_and_bad_original_availability(self):
        table = next(b for b in self.document.blocks if b.kind == 'table')
        result = self.read(table)
        report = self.report('create', title='Original table', observationIds=[result['observationId']])
        save_bundle(self.store, False, 'v3')
        self.assertTrue(verify_observation(self.store, self.observation(result)))
        self.assertEqual(self.report('read', reportId=report['id']), report)
        with self.assertRaises(Invalid):
            observed(self.store, result['observationId'], '0' * 64)
        path = self.store.root / 'scientific-documents' / (self.document.id + '.json')
        original = path.read_bytes()
        record = self.store._read('scientific-documents', self.document.id)
        record['sourceBytes'] = 'YmFk'
        self.store.imports._replace('scientific-documents', self.document.id, record)
        self.assertFalse(self.report('read', reportId=report['id'])['currentAvailability'][0]['available'])
        with self.assertRaises(Invalid):
            self.report('create', title='New report from corrupt source', observationIds=[result['observationId']])
        path.unlink()
        self.assertFalse(self.report('read', reportId=report['id'])['currentAvailability'][0]['available'])
        path.write_bytes(original)
        self.assertTrue(self.report('read', reportId=report['id'])['currentAvailability'][0]['available'])
        self.assertEqual(self.calls.read_text(), '1')

    def test_original_html_exact_unicode_window_is_not_a_typed_block(self):
        text = SOURCE.decode('utf-8')
        start = text.index('中文')
        raw = dict(documentId=self.document.id, sourceDigest=self.document.source.digest,
                   blockId='', unit='original-html', start=start, end=start + 17, content=text[start:start + 17])
        result = record_document_observation(self.store, self.receipt, self.document, raw)
        repeated = record_document_observation(self.store, self.receipt, self.document, raw)
        self.assertEqual(result['observationId'], repeated['observationId'])
        observation = self.observation(result)
        scope = observation.documentScopes[0]
        self.assertEqual((scope.blockId, scope.unit, scope.start, scope.end), ('', 'original-html', start, start + 17))
        self.assertTrue(verify_observation(self.store, observation))
        self.assertNotEqual(document_window(raw), document_window(dict(raw, unit='characters')))
        self.assertFalse(verify_observation(self.store, replace(observation,
            documentScopes=(replace(scope, end=start + 4800),))))
        self.assertFalse(verify_observation(self.store, replace(observation,
            documentScopes=(replace(scope, blockId=self.document.blocks[0].id),))))
        empty = record_document_observation(self.store, self.receipt, self.document,
                                           dict(raw, start=len(text), end=len(text), content=''))
        self.assertNotIn('observationId', empty)
        report = self.report('create', title='Raw markup window', observationIds=[result['observationId']])
        # A newer parse/source never rebinds an old original window.
        self.documents.transport.data = SOURCE + b'\n'
        newer = self.documents.prepare(dict(self.request, refresh=True), 'later')
        self.assertNotEqual(newer.id, scope.documentId)
        self.assertTrue(verify_observation(self.store, observation))
        self.assertFalse(verify_observation(self.store, replace(observation,
            documentScopes=(replace(scope, documentId=newer.id),))))
        save_bundle(self.store, False, 'v3')
        self.assertEqual(self.report('read', reportId=report['id']), report)
        path = self.store.root / 'scientific-documents' / (self.document.id + '.json')
        saved = path.read_bytes()
        record = self.store._read('scientific-documents', self.document.id)
        record['sourceBytes'] = 'YmFk'
        self.store.imports._replace('scientific-documents', self.document.id, record)
        self.assertFalse(self.report('read', reportId=report['id'])['currentAvailability'][0]['available'])
        with self.assertRaises(Invalid):
            self.report('create', title='Unavailable raw markup', observationIds=[result['observationId']])
        path.unlink()
        self.assertFalse(self.report('read', reportId=report['id'])['currentAvailability'][0]['available'])
        path.write_bytes(saved)
        self.assertEqual(self.report('read', reportId=report['id']), report)
        self.assertEqual(self.calls.read_text(), '2')

    def test_legacy_positive_and_negative_observation_identity_is_unchanged(self):
        for consulted in (None, False, True):
            legacy = dict(bundleId='a' * 64, resourceId='b' * 64, kind='source_pdf_comparison',
                sources=[], pdfs=[], pdfResourceId='c' * 64, previewSha256=None,
                comparisonStatus='unresolved', reason='no exact match', archiveDigest='d' * 64)
            if consulted is not None:
                legacy.update(pdfConsulted=consulted)
                if consulted:
                    legacy['consultedPdf'] = dict(documentId='e' * 64, fileDigest='f' * 64)
            observation = SourceObservation.from_record(legacy)
            self.assertEqual(observation.to_record(), legacy)
            self.assertEqual(observation.id, digest(legacy))
            self.assertEqual(observation.legacy_pdf_scope_unknown, consulted is None)


if __name__ == '__main__':
    unittest.main()
