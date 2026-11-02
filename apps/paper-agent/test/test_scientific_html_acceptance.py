"""The manual real-corpus probe is opt-in and publishes metadata only."""
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from manual.scientific_html import CORPUS, URL, coverage, main
from paper_agent.arxiv_html import parse_arxiv_html

from scientific_html_diagnostics import response_summary
from paper_agent.resource_fetch import PublicMetadata, SourceResponse
from paper_agent.model import Invalid

SOURCE = (Path(__file__).parent / 'fixtures/scientific-document.html').read_bytes()


class ScientificHtmlAcceptanceTests(unittest.TestCase):
    def test_projection_verifies_structure_without_exporting_source_content(self):
        raw = SOURCE.replace(b'<td>Baseline</td>', b'<td><a href="#bib1">Baseline</a></td>')
        document = parse_arxiv_html(raw, URL)
        report = coverage(document, raw)
        self.assertEqual(report['citationTargets'], {'source-anchor': 4, 'unresolved': 1})
        self.assertEqual(report['blockKinds']['table'], 1)
        self.assertEqual(report['tableCells'], 10)
        self.assertEqual(report['missingItems'], 0)
        self.assertGreaterEqual(report['typedReadWindows'], len(document.blocks))
        self.assertEqual(report['scientificAcceptance'], 'unverified')
        self.assertEqual(report['imageObservation'], 'not-observed')
        self.assertFalse(report['sourceBytesExported'])
        public = json.dumps(report)
        for private in ('Synthetic', 'Baseline', 'Candidate', 'µL', '<article', 'x1.png'):
            self.assertNotIn(private, public)
        self.assertEqual(set(report), {'documentId', 'source', 'manifest', 'parseStatus', 'warnings',
            'blockKinds', 'tableCells', 'sourceLocators', 'citationTargets', 'typedReadWindows',
            'missingItems', 'incompleteWindows', 'checks', 'scientificAcceptance', 'pdfAlignment',
            'imageObservation', 'sourceBytesExported'})

    def test_changed_original_or_missing_corpus_structure_cannot_pass(self):
        document = parse_arxiv_html(SOURCE, URL)
        with self.assertRaises(ValueError):
            coverage(document, SOURCE + b' ')
        raw = b'<meta name="citation_arxiv_id" content="2606.03979v2"><article class="ltx_document"><h1>Fixture</h1><p>Only abstract</p></article>'
        with self.assertRaisesRegex(ValueError, 'Missing expected corpus structure'):
            coverage(parse_arxiv_html(raw, URL), raw)

    def test_fixed_cases_preserve_identity_and_all_six_structure_requirements(self):
        self.assertEqual({name: case.arxiv_id for name, case in CORPUS.items()}, {
            'd5': '2606.03979v2', 'pc-gym': '2410.22093v4', 'controlgym': '2311.18736v2'})
        for name, case in CORPUS.items():
            with self.subTest(case=name):
                self.assertEqual(case.required_kinds,
                                 ('heading', 'paragraph', 'equation', 'table', 'figure', 'reference'))
                raw = SOURCE.replace(b'2606.03979v2', case.arxiv_id.encode())
                document = parse_arxiv_html(raw, case.url)
                self.assertEqual(coverage(document, raw, case)['source']['url'], case.url)
                if name != 'd5':
                    with self.assertRaisesRegex(ValueError, 'Unexpected source version'):
                        coverage(document, raw)

    def test_selected_case_exports_only_summary_and_removes_originals(self):
        case = CORPUS['pc-gym']
        raw = SOURCE.replace(b'2606.03979v2', case.arxiv_id.encode())
        temporary_roots = []

        def acquired(_owner, arguments, *_rest):
            directory, url, _, _ = arguments
            self.assertEqual(url, case.url)
            root = Path(directory)
            temporary_roots.append(root)
            (root / 'source.html').write_bytes(raw)
            (root / 'document.json').write_text(json.dumps(parse_arxiv_html(raw, url).to_dict()))
            return ('complete', '')

        with tempfile.TemporaryDirectory() as directory, patch(
                'manual.scientific_html.acquire_bounded', side_effect=acquired), contextlib.redirect_stdout(io.StringIO()):
            output = Path(directory) / 'result.json'
            self.assertEqual(main(['--allow-official-html', '--case', 'pc-gym', '--output', str(output)]), 0)
            report = json.loads(output.read_text())
            self.assertEqual(report['outcome'], 'passed')
            self.assertEqual(report['requestedUrl'], case.url)
            self.assertEqual(report['requiredKinds'], list(case.required_kinds))
            self.assertNotIn('Synthetic', output.read_text())
            self.assertEqual(list(Path(directory).iterdir()), [output])
        self.assertTrue(temporary_roots)
        self.assertTrue(all(not root.exists() for root in temporary_roots))

    def test_response_diagnostic_does_not_admit_banner_or_publish_source_text(self):
        raw = SOURCE.replace(b'<meta name="citation_arxiv_id" content="2606.03979v2">', b'')
        raw = raw.replace(b'</head>', b'<meta property="og:url" content="https://arxiv.org/html/2606.03979v2"></head>')
        raw = raw.replace(b'<body>', b'<body><div class="arxiv-identifier">arXiv:2606.03979v2 PRIVATE HEADER</div>'
                          b'<script>arXiv:9999.00001v1 PRIVATE SCRIPT</script>')
        response = SourceResponse(URL, raw, 'text/html')
        summary = response_summary(response)
        self.assertEqual(summary['identityMetadata'][0]['field'], 'og:url')
        self.assertEqual(summary['identityMetadata'][0]['ids'], ['2606.03979v2'])
        self.assertEqual(summary['outsideArticleMarkerCount'], 1)
        self.assertEqual(summary['outsideArticleMarkers'][0]['path'][-1],
                         {'tag': 'div', 'classes': ['arxiv-identifier']})
        self.assertEqual(summary['identityAdmission'], 'diagnostic-only')
        for private in ('PRIVATE', 'Synthetic', 'Baseline', '9999.00001', '<article'):
            self.assertNotIn(private, json.dumps(summary))

        def acquired(owner, arguments, *_rest):
            with patch.object(PublicMetadata, 'fetch_html', return_value=response) as fetch:
                with self.assertRaises(Invalid) as error:
                    owner(type('Output', (), {'send': lambda self, value: None})(), *arguments)
                self.assertEqual(fetch.call_count, 1)
                self.assertIn('does not establish', error.exception.detail)
                return ('failed', error.exception.detail)

        with tempfile.TemporaryDirectory() as directory, patch(
                'manual.scientific_html.acquire_bounded', side_effect=acquired), contextlib.redirect_stdout(io.StringIO()):
            output = Path(directory) / 'result.json'
            self.assertEqual(main(['--allow-official-html', '--output', str(output)]), 1)
            report = json.loads(output.read_text())
            self.assertEqual(report['outcome'], 'acquisition-not-completed')
            self.assertEqual(report['acquisitionDiagnostic'], summary)
            self.assertNotIn('documentId', report)

    def test_response_diagnostics_have_fixed_output_bounds_and_exclude_article_identity(self):
        raw = (b'<html><head>' + b'<meta name="citation_arxiv_id" content="2606.03979v2">' * 40
               + b'</head><body>' + b'<div class="arxiv-identifier">arXiv:2606.03979v2</div>' * 40
               + b'<article class="ltx_document"><p>arXiv:9999.00001v1 PRIVATE</p></article>'
               + b'<div>arXiv:2606.03979v' + b'2' * 1000 + b'</div></body></html>')
        summary = response_summary(SourceResponse(URL, raw, 'text/html'))
        self.assertEqual(summary['identityMetadataCount'], 40)
        self.assertEqual(len(summary['identityMetadata']), 32)
        self.assertEqual(summary['outsideArticleMarkerCount'], 40)
        self.assertEqual(len(summary['outsideArticleMarkers']), 32)
        self.assertLess(len(json.dumps(summary)), 32768)
        self.assertNotIn('9999.00001', json.dumps(summary))
        self.assertNotIn('PRIVATE', json.dumps(summary))

    def test_identity_diagnostics_retain_only_known_page_furniture_classes(self):
        for known in ('ltx_page_header', 'ltx_page_footer', 'ltx_header', 'infobox', 'ltx_page_content'):
            with self.subTest(known=known):
                raw = (f'<div class="{known} author_private ltx_unknown">arXiv:2606.03979v2</div>'
                       '<article class="ltx_document"><div class="ltx_page_header">arXiv:9999.00001v1</div></article>').encode()
                summary = response_summary(SourceResponse(URL, raw, 'text/html'))
                self.assertEqual(summary['outsideArticleMarkerCount'], 1)
                self.assertEqual(summary['outsideArticleMarkers'][0]['path'][-1]['classes'], [known])
                for excluded in ('author_private', 'ltx_unknown', '9999.00001'):
                    self.assertNotIn(excluded, json.dumps(summary))

    def test_identity_diagnostic_reports_only_official_scaffold_ids(self):
        for identifier in ('infobox', 'watermark-tr', 'license-tr', 'private-unknown'):
            raw = f'<div id="{identifier}">arXiv:2606.03979v2</div>'.encode()
            position = response_summary(SourceResponse(URL, raw, 'text/html'))['outsideArticleMarkers'][0]['path'][-1]
            self.assertEqual(position.get('id'), identifier if identifier != 'private-unknown' else None)

    def test_arbitrary_case_is_rejected_before_acquisition(self):
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stderr(io.StringIO()):
            output = Path(directory) / 'result.json'
            with self.assertRaises(SystemExit) as error:
                main(['--allow-official-html', '--case', 'https://example.com/', '--output', str(output)])
            self.assertEqual(error.exception.code, 2)
            self.assertFalse(output.exists())

    def test_optimized_python_still_rejects_changed_bytes_and_missing_structure(self):
        script = """
from pathlib import Path
from manual.scientific_html import URL, coverage
from paper_agent.arxiv_html import parse_arxiv_html
raw = Path('fixtures/scientific-document.html').read_bytes()
short = b'<meta name="citation_arxiv_id" content="2606.03979v2"><article class="ltx_document"><h1>Fixture</h1><p>Only abstract</p></article>'
for document, original in ((parse_arxiv_html(raw, URL), raw + b' '),
                           (parse_arxiv_html(short, URL), short)):
    try:
        coverage(document, original)
    except ValueError:
        continue
    raise SystemExit('Invalid corpus passed with optimization')
"""
        result = subprocess.run([sys.executable, '-B', '-O', '-c', script],
                                cwd=Path(__file__).parent, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)

    def test_missing_opt_in_stops_before_output_or_acquisition(self):
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stderr(io.StringIO()):
            output = Path(directory) / 'result.json'
            with self.assertRaises(SystemExit) as error:
                main(['--output', str(output)])
            self.assertEqual(error.exception.code, 2)
            self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
