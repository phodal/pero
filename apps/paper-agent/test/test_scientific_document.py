"""Scientific content, provenance, hostile HTML and bounded read contracts."""
from dataclasses import replace
from hashlib import sha256
from html.parser import HTMLParser
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from paper_agent.arxiv_html import parse_arxiv_html, safe_link
from paper_agent.document_html import render_document
from paper_agent.scientific_document import DocumentError, ParseLimits, ScientificDocument

URL = 'https://arxiv.org/html/2606.03979v2'
SOURCE = (Path(__file__).parent / 'fixtures/scientific-document.html').read_bytes()


def article(content, attributes=''):
    return ('<article class="ltx_document" ' + attributes + '><h1>Fixture</h1>' + content + '</article>').encode()


class RenderTags(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.attrs = [], []

    def handle_starttag(self, tag, attrs):
        self.tags.append(tag)
        self.attrs.extend(attrs)


class ScientificDocumentTests(unittest.TestCase):
    def test_content_relationships_and_source_are_preserved(self):
        doc = parse_arxiv_html(SOURCE, URL, 'saved-paper')
        self.assertEqual(doc.source.digest, sha256(SOURCE).hexdigest())
        self.assertEqual(doc.source.arxiv_id, '2606.03979v2')
        self.assertEqual(doc.to_dict()['pdfAlignment'], 'unavailable')
        self.assertEqual(doc.to_dict()['scientificAcceptance'], 'unverified')
        kinds = {b.kind for b in doc.blocks}
        self.assertTrue({'title', 'heading', 'paragraph', 'equation', 'table', 'figure',
                         'code', 'footnote', 'list-item', 'reference'} <= kinds)
        self.assertNotIn('Not part of the paper', ''.join(b.text for b in doc.blocks))
        method = next(b for b in doc.blocks if b.text == '1 Method')
        paragraph = next(b for b in doc.blocks if '中文' in b.text)
        self.assertEqual(paragraph.section_id, method.id)
        self.assertIn('S1', method.anchors)
        math = next(t for t in paragraph.content if t.kind == 'math')
        self.assertEqual(math.latex, 'x^2')
        self.assertIn('<msup>', math.mathml)
        self.assertEqual(sum(t.text == 'x2' for t in paragraph.content), 1)
        self.assertNotIn('annotation', math.mathml)
        self.assertIn('−1.20 µL', paragraph.text)
        table = next(b for b in doc.blocks if b.kind == 'table')
        self.assertEqual([(c.row, c.column, c.row_span, c.column_span) for c in table.cells[:4]],
                         [(0, 0, 2, 1), (0, 1, 1, 2), (1, 1, 1, 1), (1, 2, 1, 1)])
        self.assertEqual([c.text for c in table.cells[4:7]], ['Baseline', '−1.20', 'µL'])
        self.assertEqual(table.cells[8].content[0].latex, '\\alpha')
        figure = next(b for b in doc.blocks if b.kind == 'figure')
        self.assertEqual(figure.images[0].url, URL + '/x1.png')
        self.assertIn('image-bytes-not-acquired', doc.warnings)
        self.assertIn('unresolved-reference', doc.warnings)
        code = next(b for b in doc.blocks if b.kind == 'code')
        self.assertIn('\n    print(x)\n', code.text)
        self.assertLess(next(i for i,b in enumerate(doc.blocks) if b.text == 'Appendix A'),
                        next(i for i,b in enumerate(doc.blocks) if b.kind == 'reference'))

    def test_repeatable_identity_and_old_parse_roundtrip(self):
        doc = parse_arxiv_html(SOURCE, URL, 'paper')
        record = json.loads(json.dumps(doc.to_dict()))
        self.assertEqual(ScientificDocument.from_record(record), doc)
        self.assertEqual(parse_arxiv_html(SOURCE, URL, 'paper').id, doc.id)
        self.assertNotEqual(replace(doc, parser='another-parser.v2').id, doc.id)
        self.assertNotEqual(parse_arxiv_html(SOURCE + b'\n', URL, 'paper').id, doc.id)
        self.assertNotEqual(parse_arxiv_html(SOURCE, URL, 'other-paper').id, doc.id)
        record['blocks'][0]['content'][0]['text'] = 'tampered'
        with self.assertRaisesRegex(DocumentError, 'integrity'):
            ScientificDocument.from_record(record)

    def test_bounded_read_is_not_admitted_pdf_evidence(self):
        doc = parse_arxiv_html(article('<p id="p">abcdefghij</p>'), URL)
        block = doc.blocks[-1]
        first = doc.read(block.id, limit=4)
        second = doc.read(block.id, start=first['nextStart'], limit=4)
        last = doc.read(block.id, start=second['nextStart'], limit=4)
        self.assertEqual(first['content'] + second['content'] + last['content'], block.text)
        self.assertIsNone(last['nextStart'])
        self.assertEqual(first['evidenceAdmission'], 'not-observed-in-study')
        self.assertEqual(first['source']['digest'], sha256(article('<p id="p">abcdefghij</p>')).hexdigest())
        for start, limit in ((-1, 4), (11, 4), (True, 4), (0, 4801), (0, 0)):
            with self.subTest(start=start, limit=limit), self.assertRaises(DocumentError):
                doc.read(block.id, start, limit)
        with self.assertRaises(DocumentError):
            doc.read('not-in-document')

    def test_source_version_and_error_pages_fail_closed(self):
        cases = [
            (SOURCE, 'https://arxiv.org/html/2606.03979'),
            (SOURCE, 'http://arxiv.org/html/2606.03979v2'),
            (SOURCE, 'https://arxiv.org.evil.invalid/html/2606.03979v2'),
            (SOURCE, 'https://user:pass@arxiv.org/html/2606.03979v2'),
            (SOURCE, URL + '?latest=true'),
            (SOURCE.replace(b'2606.03979v2', b'2606.03979v1'), URL),
            (b'<h1>Not found</h1>', URL),
            (article(''), URL),
            (article('<p>one</p>') + article('<p>two</p>'), URL),
            (b'\xff', URL),
        ]
        for data, url in cases:
            with self.subTest(url=url, data=data[:30]), self.assertRaises(DocumentError):
                parse_arxiv_html(data, url)

    def test_all_resource_limits_reject_instead_of_truncating(self):
        cases = [
            (SOURCE, ParseLimits(max_bytes=20)),
            (SOURCE, ParseLimits(max_nodes=5)),
            (article('<div>' * 10 + 'deep' + '</div>' * 10), ParseLimits(max_depth=5)),
            (SOURCE, ParseLimits(max_blocks=2)),
            (SOURCE, ParseLimits(max_text=30)),
            (SOURCE, ParseLimits(max_table_slots=2)),
        ]
        for data, limits in cases:
            with self.subTest(limits=limits), self.assertRaises(DocumentError) as error:
                parse_arxiv_html(data, URL, limits=limits)
            self.assertEqual(error.exception.status, 413)

    def test_unsafe_html_cannot_become_active_export_content(self):
        raw = article('''<p onclick="steal()">Safe &lt;script&gt; text
        <a href="javascript:steal()">unsafe</a><a href="https://user:secret@example.org">secret link</a>
        <math alttext="x"><mi onclick="steal()">x</mi><annotation-xml><script>steal()</script></annotation-xml></math></p>
        <script src="https://evil.invalid/a.js">steal()</script><iframe src="https://evil.invalid"></iframe>
        <svg onload="steal()"><script>steal()</script></svg><img src="https://evil.invalid/pixel">
        <form action="https://evil.invalid"><input value="secret"></form>''')
        doc = parse_arxiv_html(raw, URL)
        output = render_document(doc)
        tags = RenderTags()
        tags.feed(output)
        self.assertFalse({'script', 'iframe', 'svg', 'form', 'input', 'img'} & set(tags.tags))
        self.assertFalse(any(key.startswith('on') or key == 'src' for key, _ in tags.attrs))
        self.assertNotIn('javascript:', output)
        self.assertNotIn('user:secret', output)
        self.assertIn('&lt;script&gt;', output)
        self.assertIn("default-src 'none'", output)
        self.assertIn('active-content-omitted', doc.warnings)
        self.assertIn('unsafe-link-omitted', doc.warnings)

    def test_export_has_real_reference_targets_and_no_automatic_network_assets(self):
        doc = parse_arxiv_html(SOURCE, URL)
        output = render_document(doc)
        reference = next(b for b in doc.blocks if b.kind == 'reference')
        self.assertIn(f'href="#{reference.id}"', output)
        self.assertIn('rowspan="2"', output)
        self.assertIn('−1.20', output)
        self.assertIn('<math', output)
        self.assertNotIn('<img', output)
        self.assertIn('PDF alignment unavailable', output)
        self.assertIn(doc.source.digest, output)

    def test_nested_tables_and_algorithms_do_not_claim_reconstructed_structure(self):
        doc = parse_arxiv_html(article('''<table id="t"><tr><td>outer<table><tr><td>inner</td></tr></table></td></tr></table>
        <div class="ltx_algorithm"><p>Step A</p><p>Step B</p></div>'''), URL)
        table = next(b for b in doc.blocks if b.kind == 'table')
        self.assertFalse(table.cells)
        self.assertIn('outer', table.text)
        self.assertIn('inner', table.text)
        self.assertIn('nested-or-multiple-tables-as-text', doc.warnings)
        self.assertIn('theorem-or-algorithm-as-text', doc.warnings)

    def test_ambiguous_reference_is_not_silently_assigned(self):
        doc = parse_arxiv_html(article('<p id="dup">first</p><p id="dup">second</p><p><a href="#dup">which?</a></p>'), URL)
        self.assertIn('ambiguous-source-anchor', doc.warnings)
        self.assertNotIn('href="#b000002"', render_document(doc))
        self.assertNotIn('href="#b000003"', render_document(doc))

    def test_math_in_links_and_annotation_only_latex_survive(self):
        doc = parse_arxiv_html(article('''<p><a href="#p"><math><semantics><mi>x</mi>
        <annotation encoding="application/x-tex">x</annotation></semantics></math></a></p><p id="p">target</p>'''), URL)
        token = doc.blocks[1].content[0]
        self.assertEqual((token.kind, token.latex, token.target), ('math', 'x', 'p'))
        self.assertIn('<math', render_document(doc))

    def test_bad_links_are_inert(self):
        for link in ('javascript:alert(1)', 'data:text/html,x', '//evil.invalid',
                     'https://example.org:bad/x', 'https://[broken', 'https://example.org/\nx'):
            with self.subTest(link=link):
                self.assertEqual(safe_link(link), '')


if __name__ == '__main__':
    unittest.main()
