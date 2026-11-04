"""Real local HTTP/store/OCR wiring using a generated, synthetic raster PDF."""
from contextlib import contextmanager
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from paper_agent.http import handler
from paper_agent.model import digest
from paper_agent.store import ResearchStore
from test_numeric_extraction import scan_fixture
from test_pdf import pdf_fixture

NOW = '2026-11-04T00:00:00Z'
SECRET = 'synthetic-test-token'


@contextmanager
def serve(directory):
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler(ResearchStore(directory), SECRET, now=lambda: NOW))
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        yield server.server_address
    finally:
        server.shutdown()
        server.server_close()
        worker.join()


def candidate(source, value, reviewed=False, previous=None):
    item = dict(identity=dict(metric='synthetic value', condition='synthetic test', series='A', statistic='point', unit='units'),
                sourceKind=source, method='visual', role='paper_reported', rawText=str(value), value=value,
                semanticConfirmed=True, unitConfirmed=reviewed, transcriptionConfirmed=reviewed,
                seriesReliable=False, directionReliable=False)
    if source == 'figure':
        item['axis'] = dict(ticks=[dict(pixel=0, rawText='0', value=0), dict(pixel=1000, rawText='100', value=100)],
            scale='linear', scaleConfirmed=True, unitConfirmed=reviewed, multiplierConfirmed=reviewed,
            transcriptionConfirmed=reviewed, multiplier=1, pixel=value * 10)
    if reviewed:
        item.update(method='manual', reviewer='Synthetic integration reviewer',
                    reason='Synthetic correction workflow only; not real-paper scientific acceptance.')
    if previous:
        item['previousId'] = previous
    return item


class NumericRecordsHttpTests(unittest.TestCase):
    def request(self, address, method, path, body=None, expected=200, authenticated=True):
        headers = {'X-Pero-App-Token': SECRET} if authenticated else {}
        if isinstance(body, bytes):
            headers['Content-Type'] = 'application/pdf'
        elif body is not None:
            body = json.dumps(body).encode()
            headers['Content-Type'] = 'application/json'
        connection = HTTPConnection(*address, timeout=90)
        try:
            connection.request(method, path, body, headers)
            response = connection.getresponse()
            raw = response.read()
            payload = json.loads(raw) if response.getheader('Content-Type', '').startswith('application/json') else raw
            self.assertEqual(response.status, expected, payload)
            return payload
        finally:
            connection.close()

    def test_optional_layout_unavailable_leaves_default_reader_and_history_intact(self):
        original = pdf_fixture(phrase='Ordinary native result 12.5')
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'PERO_DOCLING_ARTIFACTS_PATH': ''}), serve(directory) as address:
            self.request(address, 'GET', '/api/numeric/layout/status', expected=401, authenticated=False)
            status = self.request(address, 'GET', '/api/numeric/layout/status')
            self.assertFalse(status['available'])
            self.assertTrue(status['reasons'])
            self.assertEqual(status['downloadPolicy'], 'never')
            paper = self.request(address, 'POST', '/api/pdf/import?filename=optional-layout.pdf', original, 201)
            pdf = self.request(address, 'GET', '/api/pdf?paperId=' + paper['id'])['document']
            figure = self.request(address, 'POST', '/api/annotations', dict(documentId=pdf['id'],
                fileDigest=pdf['fileDigest'], page=1, kind='figure',
                rects=[dict(x=0, y=0, width=1, height=1)]), 201)
            self.request(address, 'POST', '/api/numeric/layout', dict(annotationId=figure['id']), 503)
            overview = self.request(address, 'GET', '/api/numeric?annotationId=' + figure['id'])
            self.assertEqual(overview['layouts'], [])
            self.assertEqual(overview['assessments'], [])
            observed = self.request(address, 'POST', '/api/numeric/extract', dict(annotationId=figure['id']), 201)
            self.assertEqual(observed['result']['classification'], 'native')
            self.assertIn('12.5', observed['result']['nativePageText'])
            self.assertEqual(self.request(address, 'GET', '/api/pdf/' + pdf['id'] + '/file'), original)

    @unittest.skipUnless(os.environ.get('PAPER_AGENT_REAL_DOCLING') == '1', 'Opt in to provisioned local Docling and real scan')
    def test_real_layout_http_persists_review_only_structure_and_reopens_original(self):
        corpus = Path(os.environ['PAPER_AGENT_NUMERIC_CORPUS_DIR'])
        original = (corpus / '19930083484.pdf').read_bytes()
        self.assertEqual(digest(original), 'd03f1dabbc5fecbc8333443794ba9c33fb6632c2af9efd0237d76a96528829b8')
        with tempfile.TemporaryDirectory() as directory:
            isolated_python = os.environ.get('PAPER_AGENT_DOCLING_PYTHON')
            if isolated_python:
                configuration = Path(directory) / 'research-v1' / 'docling-runtime.json'
                configuration.parent.mkdir(parents=True)
                configuration.write_text(json.dumps(dict(
                    python=isolated_python, artifactsPath=os.environ['PERO_DOCLING_ARTIFACTS_PATH'])))
            with serve(directory) as address:
                status = self.request(address, 'GET', '/api/numeric/layout/status')
                self.assertTrue(status['available'], status['reasons'])
                paper = self.request(address, 'POST', '/api/pdf/import?filename=TN2825-original.pdf', original, 201)
                pdf = self.request(address, 'GET', '/api/pdf?paperId=' + paper['id'])['document']
                figure = self.request(address, 'POST', '/api/annotations', dict(documentId=pdf['id'],
                    fileDigest=pdf['fileDigest'], page=28, kind='figure',
                    rects=[dict(x=.27, y=.12, width=.46, height=.63)]), 201)
                saved = self.request(address, 'POST', '/api/numeric/layout', dict(annotationId=figure['id']), 201)
                result = saved['result']
                self.assertEqual(result['sourceSha256'], pdf['fileDigest'])
                self.assertEqual(result['nativePageText'], pdf['pages'][27]['text'])
                self.assertEqual(result['layout']['textKind'], 'full_page_ocr_docling')
                self.assertEqual(result['scientificAcceptance'], 'unverified')
                self.assertEqual(result['pageRange'], [28, 28])
                self.assertTrue(result['rawExport']['pictures'])
                anchored = [p for p in result['layout']['pictures'] if p['layoutStatus'] == 'anchored']
                self.assertTrue(anchored)
                self.assertTrue(any(r['role'] == 'caption' and r['status'] == 'resolved-text'
                                    for p in anchored for r in p['relationships']))
                self.assertEqual(saved['selectedAnchor'], figure['anchor'])
                if isolated_python:
                    self.assertNotIn('docling', sys.modules)
                    self.assertNotIn('torch', sys.modules)
            with serve(directory) as address:
                self.assertEqual(self.request(address, 'GET', saved['recordUrl']), saved)
                overview = self.request(address, 'GET', '/api/numeric?annotationId=' + figure['id'])
                self.assertEqual(overview['layouts'], [saved])
                self.assertEqual(overview['assessments'], [])
                self.assertEqual(overview['references'], [])
                self.assertEqual(self.request(address, 'GET', '/api/pdf/' + pdf['id'] + '/file'), original)

    def test_scan_review_correction_freeze_and_restart_preserve_audit(self):
        original = scan_fixture()
        with tempfile.TemporaryDirectory() as directory:
            with serve(directory) as address:
                self.request(address, 'GET', '/api/numeric?annotationId=anything', expected=401, authenticated=False)
                paper = self.request(address, 'POST', '/api/pdf/import?filename=synthetic-ocr-workflow.pdf', original, 201)
                pdf = self.request(address, 'GET', '/api/pdf?paperId=' + paper['id'])['document']
                self.assertEqual(pdf['fileDigest'], digest(original))
                self.assertEqual(pdf['pages'][0]['text'], '')
                selection = dict(documentId=pdf['id'], fileDigest=pdf['fileDigest'], page=1, kind='figure',
                                 rects=[dict(x=0, y=0, width=1, height=1)], note='Synthetic workflow fixture')
                figure = self.request(address, 'POST', '/api/annotations', selection, 201)
                other = self.request(address, 'POST', '/api/annotations',
                    dict(selection, rects=[dict(x=0, y=0, width=0.5, height=1)]), 201)
                observed = self.request(address, 'POST', '/api/numeric/extract', dict(annotationId=figure['id']), 201)
                self.assertEqual(self.request(address, 'GET', '/api/numeric/extractions/' + observed['id']), observed)
                result = observed['result']
                self.assertEqual(result['classification'], 'image_based')
                self.assertEqual(result['nativePageText'], '')
                if shutil.which('tesseract'):
                    self.assertEqual(result['ocr']['status'], 'completed', result['ocr'])
                    self.assertIn('12.50', result['ocr']['text'])
                    self.assertTrue(result['ocr']['version'])
                    self.assertTrue(result['ocr']['boxes'])
                else:
                    self.assertEqual(result['ocr']['status'], 'unavailable')
                    self.assertFalse(result['ocr']['text'])
                    self.assertTrue(result['ocr']['error'])
                crop = self.request(address, 'GET', observed['imageUrl'])
                self.assertEqual(digest(crop), result['image']['digest'])
                base = dict(annotationId=figure['id'], extractionId=observed['id'])

                # All native/OCR claims must be bound to this exact extraction;
                # naming an authoritative source never manufactures provenance.
                self.request(address, 'POST', '/api/numeric/assess',
                    dict(base, annotationId=other['id'], evidence=[candidate('caption', 15)]), 409)
                wrong_anchor = candidate('caption', 15)
                wrong_anchor['anchor'] = other['anchor']
                self.request(address, 'POST', '/api/numeric/assess', dict(base, evidence=[wrong_anchor]), 400)
                for method in ('native_text', 'ocr'):
                    unobserved = dict(candidate('caption', 987654321), method=method)
                    self.request(address, 'POST', '/api/numeric/assess', dict(base, evidence=[unobserved]), 400)
                self.request(address, 'POST', '/api/numeric/assess',
                    dict(base, evidence=[candidate('author_data', 12.5, True)]), 400)

                first = self.request(address, 'POST', '/api/numeric/assess',
                    dict(base, evidence=[candidate('figure', 12.5), candidate('caption', 15)]), 201)
                self.assertEqual(first['assessment']['status'], 'needs_review')
                self.assertEqual(first['assessment']['confidence']['level'], 'low')
                self.assertEqual(first['assessment']['captionAxisCrossCheck']['status'], 'conflict')
                self.request(address, 'POST', '/api/numeric/freeze', dict(assessmentId=first['id']), 409)
                prior = {e['sourceKind']: e['id'] for e in first['evidence']}
                corrected = self.request(address, 'POST', '/api/numeric/assess', dict(base,
                    previousAssessmentId=first['id'], evidence=[candidate(source, 12.5, True, prior[source])
                    for source in ('figure', 'caption')]), 201)
                self.assertEqual(corrected['assessment']['status'], 'numeric_ready', corrected)
                self.assertEqual(corrected['assessment']['captionAxisCrossCheck']['status'], 'no_conflict')
                self.assertEqual(len(corrected['evidence']), 4)
                self.assertTrue(all(e['extractionId'] == observed['id'] for e in first['evidence']))
                self.assertTrue(all(e['extractionId'] == observed['id'] for e in corrected['evidence']))
                self.assertTrue(any(e['method'] == 'manual' for e in corrected['evidence']))
                self.assertTrue(corrected['assessment']['conflicts'])
                self.assertTrue(all(c['resolved'] for c in corrected['assessment']['conflicts']))
                frozen = self.request(address, 'POST', '/api/numeric/freeze', dict(assessmentId=corrected['id']), 201)
                self.assertEqual(frozen['reference']['scientificAcceptance'], 'not_assessed')
                self.assertEqual(frozen['reference']['value'], 12.5)
                self.assertEqual(frozen['reference']['extractionId'], observed['id'])
                # A correction appends history, never mutates an old decision.
                self.request(address, 'POST', '/api/numeric/freeze', dict(assessmentId=first['id']), 409)

            # Fresh store and HTTP handler, not a cached in-memory projection.
            with serve(directory) as address:
                reopened = self.request(address, 'GET', '/api/numeric/references/' + frozen['id'])
                self.assertEqual(reopened, frozen)
                report = self.request(address, 'GET', '/api/numeric/references/' + frozen['id'] + '/report')
                self.assertEqual(report['anchor'], figure['anchor'])
                self.assertTrue(all(e['extractionId'] == observed['id'] for e in report['assessment']['evidence']))
                self.assertEqual(len(report['extractionSources']), 1)
                source = report['extractionSources'][0]
                self.assertEqual(source['id'], observed['id'])
                self.assertEqual(source['anchor'], result['anchor'])
                self.assertEqual(source['imageUrl'], observed['imageUrl'])
                self.assertEqual(source['recordUrl'], '/api/numeric/extractions/' + observed['id'])
                self.assertEqual(self.request(address, 'GET', source['recordUrl']), observed)
                self.assertEqual(self.request(address, 'GET', source['imageUrl']), crop)
                self.assertEqual(report['acceptance'], 'unverified')
                self.assertEqual(report['assessment']['assessment']['confidence']['level'], 'medium')
                self.assertEqual(report['assessment']['assessment']['captionAxisCrossCheck']['status'], 'no_conflict')
                self.assertEqual(report['history'][0]['id'], first['id'])
                self.assertEqual(report['history'][0]['assessment']['captionAxisCrossCheck']['status'], 'conflict')
                self.assertIn('Caption and axis inconsistencies', report['markdown'])
                self.assertIn('retained in history', report['markdown'])
                old = self.request(address, 'GET', '/api/numeric/assessments/' + first['id'] + '/report')
                self.assertEqual(old['assessment']['assessment']['status'], 'needs_review')
                self.assertEqual(old['assessment']['assessment']['confidence']['level'], 'low')
                self.assertEqual(old['assessment']['assessment']['captionAxisCrossCheck']['status'], 'conflict')
                self.assertEqual(old['acceptance'], 'unverified')
                self.request(address, 'POST', '/api/numeric/freeze', dict(assessmentId=first['id']), 409)
                self.assertEqual(self.request(address, 'GET', observed['imageUrl']), crop)
                overview = self.request(address, 'GET', '/api/numeric?annotationId=' + figure['id'])
                self.assertEqual(len(overview['assessments']), 2)
                self.assertEqual(len(overview['references']), 1)
                self.assertEqual(overview['extractions'][0]['result']['nativePageText'], '')
                self.assertEqual(self.request(address, 'GET', '/api/pdf/' + pdf['id'] + '/file'), original)

    def test_native_claim_binds_whole_numeric_token_not_substring(self):
        # A sign or decimal prefix must not disappear merely because the raw
        # characters "1" occur somewhere in the regional text.
        original = pdf_fixture(phrase='Synthetic signed values -1 0.1 and decimal-comma 0,2')
        with tempfile.TemporaryDirectory() as directory, serve(directory) as address:
            paper = self.request(address, 'POST', '/api/pdf/import?filename=synthetic-token-binding.pdf', original, 201)
            pdf = self.request(address, 'GET', '/api/pdf?paperId=' + paper['id'])['document']
            figure = self.request(address, 'POST', '/api/annotations', dict(documentId=pdf['id'],
                fileDigest=pdf['fileDigest'], page=1, kind='figure',
                rects=[dict(x=0, y=0, width=1, height=1)]), 201)
            extraction = self.request(address, 'POST', '/api/numeric/extract', dict(annotationId=figure['id']), 201)
            self.assertEqual(extraction['result']['classification'], 'native')
            self.assertEqual({item['raw'] for item in extraction['result']['observations']}, {'-1', '0.1'})
            base = dict(annotationId=figure['id'], extractionId=extraction['id'])
            invented = dict(candidate('caption', 1, True), method='native_text', rawText='1')
            self.request(address, 'POST', '/api/numeric/assess', dict(base, evidence=[invented]), 400)
            comma_fragment = dict(candidate('caption', 2, True), method='native_text', rawText='2')
            self.request(address, 'POST', '/api/numeric/assess', dict(base, evidence=[comma_fragment]), 400)
            preserved = dict(candidate('caption', -1, True), method='native_text', rawText='-1')
            accepted = self.request(address, 'POST', '/api/numeric/assess', dict(base, evidence=[preserved]), 201)
            self.assertEqual(accepted['evidence'][0]['rawText'], '-1')
            self.assertEqual(accepted['evidence'][0]['value'], -1)

    def test_known_conflicts_cannot_be_omitted_or_newly_frozen(self):
        with tempfile.TemporaryDirectory() as directory, serve(directory) as address:
            paper = self.request(address, 'POST', '/api/pdf/import?filename=synthetic-known-history.pdf', scan_fixture(), 201)
            pdf = self.request(address, 'GET', '/api/pdf?paperId=' + paper['id'])['document']
            figure = self.request(address, 'POST', '/api/annotations', dict(documentId=pdf['id'],
                fileDigest=pdf['fileDigest'], page=1, kind='figure',
                rects=[dict(x=0, y=0, width=1, height=1)]), 201)
            ordered = []

            def assess(value, series):
                evidence = candidate('caption', value, True)
                evidence['identity']['series'] = series
                record = self.request(address, 'POST', '/api/numeric/assess',
                    dict(annotationId=figure['id'], evidence=[evidence]), 201)
                ordered.append(record['id'])
                return record

            unfrozen = assess(12.5, 'unfrozen')
            frozen_ready = assess(12.5, 'frozen')
            immutable = self.request(address, 'POST', '/api/numeric/freeze', dict(assessmentId=frozen_ready['id']), 201)
            unrelated = assess(90, 'different quantity')
            self.assertEqual(unrelated['assessment']['status'], 'numeric_ready')
            for series, ready in (('unfrozen', unfrozen), ('frozen', frozen_ready)):
                conflict = assess(15, series)  # Deliberately no previousAssessmentId.
                self.assertEqual(conflict['assessment']['status'], 'needs_review')
                self.assertEqual(len(conflict['evidence']), 2)
                self.assertTrue(set(ready['assessment']['evidenceIds']) <= set(conflict['assessment']['evidenceIds']))
                omitted = assess(12.5, series)
                self.assertEqual(omitted['assessment']['status'], 'needs_review')
                self.assertTrue(omitted['assessment']['conflicts'])
                self.request(address, 'POST', '/api/numeric/freeze', dict(assessmentId=omitted['id']), 409)
            self.request(address, 'POST', '/api/numeric/freeze', dict(assessmentId=unfrozen['id']), 409)
            self.assertEqual(self.request(address, 'POST', '/api/numeric/freeze',
                dict(assessmentId=frozen_ready['id']), 201), immutable)
            different = self.request(address, 'POST', '/api/numeric/freeze', dict(assessmentId=unrelated['id']), 201)
            self.assertEqual(different['reference']['value'], 90)
            overview = self.request(address, 'GET', '/api/numeric?annotationId=' + figure['id'])
            self.assertEqual([r['id'] for r in overview['assessments']], list(dict.fromkeys(ordered)))
            self.assertTrue(all(r['createdAt'] == NOW for r in overview['assessments']))
            # A correction cannot silently redefine a quantity's unit, nor may
            # a rejected attempt poison future independent observations.
            cross_unit = candidate('caption', 0.09, True, unrelated['evidence'][0]['id'])
            cross_unit['identity'].update(series='different quantity', unit='kilounits')
            self.request(address, 'POST', '/api/numeric/assess', dict(annotationId=figure['id'],
                previousAssessmentId=unrelated['id'], evidence=[cross_unit]), 400)
            after_rejection = self.request(address, 'GET', '/api/numeric?annotationId=' + figure['id'])
            self.assertEqual(after_rejection['assessments'], overview['assessments'])
            cross_unit.pop('previousId')
            independent = self.request(address, 'POST', '/api/numeric/assess',
                dict(annotationId=figure['id'], evidence=[cross_unit]), 201)
            self.assertEqual(independent['assessment']['status'], 'numeric_ready')
            self.assertEqual(len(independent['evidence']), 1)
            reference = self.request(address, 'POST', '/api/numeric/freeze', dict(assessmentId=independent['id']), 201)
            self.assertEqual(reference['reference']['identity']['unit'], 'kilounits')
            self.assertEqual(reference['reference']['value'], 0.09)
            sequences = [r['sequence'] for r in overview['assessments']]
            self.assertEqual(sequences, sorted(set(sequences)))


if __name__ == '__main__':
    unittest.main()
