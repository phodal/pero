"""The manual real-corpus probe is opt-in and publishes metadata only."""
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from manual.scientific_html import URL, coverage, main
from paper_agent.arxiv_html import parse_arxiv_html

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
