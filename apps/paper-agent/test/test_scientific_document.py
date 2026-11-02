"""Self-authored scientific HTML, exact source windows and bounded typed reads."""
from dataclasses import replace
from hashlib import sha256
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from paper_agent.arxiv_html import parse_arxiv_html, safe_mathml, safe_link
from paper_agent.scientific_document import DocumentError, ParseLimits, ScientificDocument, encoded

URL = 'https://arxiv.org/html/2606.03979v2'
SOURCE = (Path(__file__).parent / 'fixtures/scientific-document.html').read_bytes()


def article(content, metadata='<meta name="citation_arxiv_id" content="2606.03979v2">'):
    return (metadata + '<article class="ltx_document"><h1>Fixture</h1>' + content + '</article>').encode()


class ScientificDocumentTests(unittest.TestCase):
    def test_exact_structure_source_and_metadata(self):
        raw = SOURCE.replace(b'Synthetic author', b'<span class="ltx_personname">Synthetic author</span>')
        doc = parse_arxiv_html(raw, URL, 'saved-paper', requested_url='https://arxiv.org/abs/2606.03979')
        self.assertEqual(doc.source.digest, sha256(raw).hexdigest())
        self.assertEqual(doc.source.version, 'v2')
        self.assertEqual(doc.source.requested_url, 'https://arxiv.org/abs/2606.03979')
        self.assertEqual(doc.source_identity, 'response-explicit-version')
        self.assertEqual(doc.metadata.authors, ('Synthetic author',))
        self.assertEqual(doc.metadata.abstract, 'Deterministic fixture, not research evidence.')
        self.assertIsNone(doc.metadata.date)
        self.assertEqual(doc.to_dict()['pdfAlignment'], 'unavailable')
        self.assertEqual(doc.to_dict()['scientificAcceptance'], 'unverified')
        method = next(b for b in doc.blocks if b.text == '1 Method')
        paragraph = next(b for b in doc.blocks if '中文' in b.text)
        self.assertEqual(paragraph.section_id, method.id)
        self.assertIn('S1', method.anchors)
        math = next(t for t in paragraph.content if t.kind == 'math')
        self.assertEqual(math.latex, 'x^2')
        self.assertIn('<msup>', math.mathml)
        self.assertNotIn('annotation', math.mathml)
        table = next(b for b in doc.blocks if b.kind == 'table')
        self.assertEqual([(c.row, c.column, c.row_span, c.column_span) for c in table.cells[:4]],
                         [(0, 0, 2, 1), (0, 1, 1, 2), (1, 1, 1, 1), (1, 2, 1, 1)])
        self.assertEqual([c.text for c in table.cells[4:7]], ['Baseline', '−1.20', 'µL'])
        self.assertEqual(table.cells[8].content[0].latex, '\\alpha')
        self.assertIn('image-bytes-not-acquired', doc.warnings)
        self.assertIn('unresolved-reference', doc.warnings)
        self.assertIn('\n    print(x)\n', next(b for b in doc.blocks if b.kind == 'code').text)
        self.assertLess(next(i for i,b in enumerate(doc.blocks) if b.text == 'Appendix A'),
                        next(i for i,b in enumerate(doc.blocks) if b.kind == 'reference'))

    def test_two_column_source_retains_dom_reading_order_and_original_locators(self):
        # Presentation columns do not authorize reconstructing PDF reading order.
        self.assertIn(b'column-count: 2', SOURCE)
        doc = parse_arxiv_html(SOURCE, URL)
        expected = ['S1.p1', 'E1', 'T1', 'F1', 'code', 'note1', 'A']
        blocks = [b for b in doc.blocks if any(a in expected for a in b.anchors)]
        self.assertEqual([next(a for a in b.anchors if a in expected) for b in blocks], expected)
        self.assertEqual([b.kind for b in blocks],
                         ['paragraph', 'equation', 'table', 'figure', 'code', 'footnote', 'heading'])
        section = next(b for b in doc.blocks if b.text == '1 Method')
        self.assertTrue(all(b.section_id == section.id for b in blocks[:-1]))
        original = SOURCE.decode('utf-8')
        starts = [b.locator.start for b in blocks]
        self.assertEqual(starts, sorted(set(starts)))
        for block, anchor in zip(blocks[:-1], expected[:-1]):
            self.assertIn(f'id="{anchor}"', original[block.locator.start:block.locator.end])
        self.assertEqual(original[blocks[-1].locator.start:blocks[-1].locator.end], '<h2>Appendix A</h2>')
        citation = next(t for t in blocks[0].content if t.target == 'bib1')
        self.assertEqual(citation.target_status, 'source-anchor')
        self.assertEqual(doc.source.digest, sha256(SOURCE).hexdigest())
        self.assertEqual(doc.to_dict()['pdfAlignment'], 'unavailable')

    def test_metadata_does_not_promote_bibliography_names_or_guess_dates(self):
        doc = parse_arxiv_html(article('<div class="ltx_authors"><span class="ltx_personname">Author A</span></div><p>Body</p><div class="ltx_bibliography"><span class="ltx_personname">Referenced B</span></div>'), URL)
        self.assertEqual(doc.metadata.authors, ('Author A',))
        dated = parse_arxiv_html(article('<p>Body</p>', '<meta name="citation_publication_date" content="2026/06/01">'), URL)
        self.assertEqual(dated.metadata.date, '2026/06/01')
        ambiguous = parse_arxiv_html(article('<p>Body</p>', '<meta name="citation_publication_date" content="2026/06/01"><meta name="citation_publication_date" content="2026/07/01">'), URL)
        self.assertIsNone(ambiguous.metadata.date)
        self.assertIn('ambiguous-publication-date', ambiguous.warnings)

    def test_exact_original_html_windows_preserve_bom_and_unicode(self):
        raw = b'\xef\xbb\xbf' + article('<p id="p">中文 &amp; original\nline</p><table><tr><td>  −1.20 µL\n </td></tr></table>')
        doc = parse_arxiv_html(raw, URL)
        original = raw.decode('utf-8')
        paragraph = next(b for b in doc.blocks if b.kind == 'paragraph')
        self.assertEqual(original[paragraph.locator.start:paragraph.locator.end], '<p id="p">中文 &amp; original\nline</p>')
        self.assertEqual(paragraph.text, '中文 & original\nline')
        table = next(b for b in doc.blocks if b.kind == 'table')
        self.assertEqual(table.cells[0].text, '  −1.20 µL\n ')
        self.assertTrue(original[table.locator.start:table.locator.end].startswith('<table>'))
        self.assertEqual(paragraph.locator.end_line, 2)
        incomplete = parse_arxiv_html(article('<p>unclosed'), URL)
        self.assertIsNone(incomplete.blocks[-1].locator)
        self.assertIn('original-element-window-unavailable', incomplete.warnings)

    def test_manifest_roundtrip_identity_and_new_parse_do_not_mutate_old(self):
        doc = parse_arxiv_html(SOURCE, URL, 'paper')
        record = json.loads(json.dumps(doc.to_dict()))
        self.assertEqual(ScientificDocument.from_record(record), doc)
        self.assertEqual(parse_arxiv_html(SOURCE, URL, 'paper').id, doc.id)
        updated = replace(doc, manifest=replace(doc.manifest, parser='another-parser.v3'))
        self.assertNotEqual(updated.id, doc.id)
        self.assertNotEqual(replace(doc, manifest=replace(doc.manifest, options=(('whitespace', 'different'),))).id, doc.id)
        self.assertNotEqual(parse_arxiv_html(SOURCE + b'\n', URL, 'paper').id, doc.id)
        record['blocks'][0]['content'][0]['text'] = 'tampered'
        with self.assertRaisesRegex(DocumentError, 'integrity'):
            ScientificDocument.from_record(record)

    def test_typed_windows_cover_cells_tokens_and_images_without_false_observation(self):
        doc = parse_arxiv_html(SOURCE, URL)
        table = next(b for b in doc.blocks if b.kind == 'table')
        items, cursor = [], 0
        while cursor is not None:
            page = doc.read(table.id, cursor, 650)
            self.assertEqual(page['unit'], 'cells')
            self.assertEqual(page['missing'], [])
            self.assertLessEqual(len(encoded(page)), 32768)
            self.assertEqual(page['evidenceAdmission'], 'not-observed-in-study')
            items.extend(page['items'])
            cursor = page['nextStart']
        self.assertEqual([i['text'] for i in items], [c.text for c in table.cells])
        self.assertEqual(items[0]['row_span'], 2)
        equation = next(b for b in doc.blocks if b.kind == 'equation')
        page = doc.read(equation.id)
        self.assertEqual(page['unit'], 'tokens')
        self.assertEqual(page['items'][0]['latex'], 'y=\\frac{1}{2}')
        self.assertIn('<mfrac>', page['items'][0]['mathml'])
        figure = next(b for b in doc.blocks if b.kind == 'figure')
        page = doc.read(figure.id)
        self.assertEqual(page['unit'], 'images')
        self.assertEqual(page['items'][0]['url'], URL + '/x1.png')
        self.assertFalse(page['items'][0]['bytesAcquired'])
        self.assertEqual(page['imageObservation'], 'not-observed')
        self.assertIn('Caption is not image observation', page['context'])

    def test_oversized_structured_item_is_explicitly_unread_not_flattened(self):
        doc = parse_arxiv_html(article('<div class="ltx_equation"><math alttext="' + 'x' * 5000 + '"><mi>x</mi></math></div>'), URL)
        page = doc.read(doc.blocks[-1].id)
        self.assertEqual(page['items'], [])
        self.assertEqual(page['missing'][0]['index'], 0)
        self.assertFalse(page['complete'])
        self.assertIsNone(page['nextStart'])
        self.assertLessEqual(len(encoded(page)), 32768)

    def test_plain_text_and_outline_are_bounded_not_observed(self):
        doc = parse_arxiv_html(article('<p>abcdefghij</p>' + ''.join(f'<h2>Heading {i}</h2>' for i in range(70))), URL)
        block = doc.blocks[1]
        first = doc.read(block.id, limit=4)
        second = doc.read(block.id, first['nextStart'], 4)
        last = doc.read(block.id, second['nextStart'], 4)
        self.assertEqual(first['content'] + second['content'] + last['content'], block.text)
        outline = doc.outline()
        self.assertEqual(len(outline['items']), 64)
        self.assertEqual(outline['nextStart'], 64)
        self.assertEqual(len(doc.outline(64)['items']), 6)
        for start, limit in ((True, 4), (-1, 4), (11, 4), (0, 4801), (0, 0)):
            with self.subTest(start=start, limit=limit), self.assertRaises(DocumentError):
                doc.read(block.id, start, limit)

    def test_response_identity_is_not_inferred_from_request(self):
        for metadata in ('', '<meta name="citation_arxiv_id" content="2606.03979">'):
            doc = parse_arxiv_html(article('<p>text</p>', metadata), URL)
            self.assertEqual(doc.source_identity, 'version-unconfirmed')
            self.assertEqual(doc.to_dict()['parseStatus'], 'partial')
            self.assertIn('response-version-unconfirmed', doc.warnings)
        for metadata in ('<link rel="canonical" href="https://arxiv.org/html/2606.03979v2">',
                         '<meta name="citation_pdf_url" content="https://arxiv.org/pdf/2606.03979v2.pdf">'):
            doc = parse_arxiv_html(article('<p>text</p>', metadata), URL)
            self.assertEqual(doc.source_identity, 'response-explicit-version')
            self.assertEqual(doc.manifest.identity_evidence[0][1], '2606.03979v2')
        conflicting = '<meta name="citation_arxiv_id" content="2606.03979v2"><link rel="canonical" href="https://arxiv.org/html/2606.03979v1">'
        with self.assertRaises(DocumentError):
            parse_arxiv_html(article('<p>text</p>', conflicting), URL)
        for metadata in ('<meta name="citation_arxiv_id" content="2606.03979v1">',
                         '<meta name="citation_arxiv_id" content="9999.00001v2">'):
            with self.assertRaisesRegex(DocumentError, 'identity'):
                parse_arxiv_html(article('<p>text</p>', metadata), URL)

    def test_official_scaffold_identity_is_scoped_and_conflicts_fail_closed(self):
        # Minimal self-authored shape from arXiv's published callout_license template.
        box = ('<div id="infobox" class="infobox"><a id="license-tr" '
               'href="https://info.arxiv.org/help/license/index.html#licenses-available">License</a>'
               '<div id="watermark-tr">arXiv:2606.03979v2 [cs.LG] 10 Jul 2026</div></div>')
        content = '<div class="ltx_page_content">' + article('<p>text</p>', '').decode() + '</div>'
        valid = '<html><body><div>' + box + content + '</div></body></html>'
        doc = parse_arxiv_html(valid.encode(), URL)
        self.assertEqual(doc.manifest.identity_evidence, (('scaffold:watermark-tr', '2606.03979v2'),))
        self.assertEqual(doc.source_identity, 'response-explicit-version')
        self.assertEqual(doc.manifest.parser, 'pero.arxiv-latexml.v3')
        unconfirmed = [
            content, valid.replace('2606.03979v2', '2606.03979'),
            valid.replace('id="infobox"', 'id="unknown"'),
            valid.replace('class="infobox"', 'class="unknown"'),
            valid.replace('id="watermark-tr"', 'id="unknown"'),
            valid.replace('#licenses-available', '#unknown'),
            valid.replace('arXiv:2606.03979v2', 'See arXiv:2606.03979v2'),
            valid.replace('arXiv:2606.03979v2', '<span>arXiv:2606.03979v2</span>'),
            box + '<aside>' + content + '</aside>',
            '<script>' + box + '</script>' + content,
            '<template>' + box + '</template>' + content,
            article(box + '<p>arXiv:2606.03979v2 [cs.LG] 10 Jul 2026</p>', '').decode(),
            content + box,
            valid.replace(content, '<div class="ltx_page_content"></div>' + content),
        ]
        for excluded in ('template', 'noscript', 'object', 'form'):
            unconfirmed.append(valid.replace('<article class="ltx_document">',
                                              f'<{excluded}><article class="ltx_document">')
                               .replace('</article>', f'</article></{excluded}>'))
        for raw in unconfirmed:
            with self.subTest(raw=raw):
                self.assertEqual(parse_arxiv_html(raw.encode(), URL).source_identity, 'version-unconfirmed')
        mismatches = [valid.replace('2606.03979v2', '2606.03979v1'),
                      valid.replace('2606.03979v2', '2410.22093v4'),
                      '<meta name="citation_arxiv_id" content="2606.03979v1">' + valid,
                      valid.replace(box, box + box.replace('v2', 'v1')),
                      valid.replace('</div></div><div class="ltx_page_content">',
                                    '</div><div id="watermark-tr">arXiv:2606.03979v1 [cs.LG] 10 Jul 2026</div></div><div class="ltx_page_content">')]
        for raw in mismatches:
            with self.subTest(raw=raw), self.assertRaisesRegex(DocumentError, 'identity'):
                parse_arxiv_html(raw.encode(), URL)
        old = replace(doc, manifest=replace(doc.manifest, parser='pero.arxiv-latexml.v2'))
        restored = ScientificDocument.from_record(json.loads(encoded(old.to_dict())))
        self.assertEqual(restored.id, old.id)
        self.assertNotEqual(restored.id, doc.id)

    def test_source_identity_error_pages_and_resource_limits_fail_closed(self):
        cases = [(SOURCE, URL[:-2]), (SOURCE, URL.replace('https:', 'http:')),
                 (SOURCE, URL.replace('arxiv.org', 'arxiv.org.evil.invalid')),
                 (SOURCE, URL.replace('arxiv.org', 'user:pass@arxiv.org')),
                 (SOURCE, URL + '?latest=true'), (b'<h1>Not found</h1>', URL), (article(''), URL),
                 (article('<p>one</p>') + article('<p>two</p>'), URL), (b'\xff', URL)]
        for data, url in cases:
            with self.subTest(url=url, data=data[:30]), self.assertRaises(DocumentError):
                parse_arxiv_html(data, url)
        for limits in (ParseLimits(max_bytes=20), ParseLimits(max_nodes=5), ParseLimits(max_depth=2),
                       ParseLimits(max_blocks=2), ParseLimits(max_text=30), ParseLimits(max_table_slots=2)):
            with self.subTest(limits=limits), self.assertRaises(DocumentError) as error:
                parse_arxiv_html(SOURCE, URL, limits=limits)
            self.assertEqual(error.exception.status, 413)
        with self.assertRaises(DocumentError):
            parse_arxiv_html(SOURCE, URL, requested_url='https://arxiv.org/abs/2606.03979v1')

    def test_active_content_and_unknown_math_are_never_executable_structure(self):
        doc = parse_arxiv_html(article('''<p onclick="steal()">Safe &lt;script&gt; text
        <a href="javascript:steal()">unsafe</a><a href="https://user:secret@example.org">credential link</a>
        <math alttext="\\unknown"><mi onclick="steal()">x</mi><badmath>unknown</badmath>
        <annotation-xml><script>steal()</script></annotation-xml></math></p>
        <script src="https://evil.invalid/a.js">steal()</script><iframe src="https://evil.invalid"></iframe>
        <svg onload="steal()"><script>steal()</script></svg><div class="ltx_ERROR">Unknown macro \\foo</div>'''), URL)
        self.assertIn('active-content-omitted', doc.warnings)
        self.assertIn('unsafe-link-omitted', doc.warnings)
        self.assertIn('unsupported-math-element', doc.warnings)
        self.assertIn('source-conversion-error', doc.warnings)
        math = next(t for b in doc.blocks for t in b.content if t.kind == 'math')
        self.assertEqual(math.latex, '\\unknown')
        for bad in ('onclick', '<script', '<badmath', 'annotation-xml'):
            self.assertNotIn(bad, math.mathml)
        self.assertEqual(safe_mathml('<math><mi onclick="x">x</mi><script>x</script></math>'), '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>')
        for url in ('javascript:x', 'https://u:p@example.org', 'http://example.org', 'https://example.org:123/x'):
            self.assertEqual(safe_link(url), '')

    def test_limitations_are_local_to_every_affected_block_and_table_cell(self):
        cases = (
            ('<p><math><mi>x</mi><badmath>first</badmath></math></p>'
             '<p><math><mi>y</mi><badmath>second</badmath></math></p>',
             'paragraph', 'unsupported-math-element', 2),
            ('<table><tr><td><math><mi>x</mi><badmath>unknown</badmath></math></td></tr></table>',
             'table', 'unsupported-math-element', 1),
            ('<p class="ltx_ERROR">unknown one</p><p><span class="ltx_ERROR">unknown two</span></p>'
             '<div class="ltx_ERROR">unknown three</div>'
             '<table><tr><td class="ltx_ERROR">unknown four</td></tr></table>',
             None, 'source-conversion-error', 4),
        )
        for html, kind, limitation, count in cases:
            with self.subTest(limitation=limitation, kind=kind):
                doc = parse_arxiv_html(article(html), URL)
                affected = [b for b in doc.blocks if b.kind != 'title' and (kind is None or b.kind == kind)]
                self.assertEqual(len(affected), count)
                for block in affected:
                    self.assertIn(limitation, block.limitations)
                    read = doc.read(block.id)
                    self.assertIn(limitation, read['limitations'])
                    self.assertEqual(read['parseStatus'], 'partial')
                    # All retained typed items were returned, not validated scientifically.
                    self.assertTrue(read['complete'])
                self.assertIn(limitation, doc.warnings)

    def test_explicit_error_ancestors_mark_retained_blocks_not_clean_siblings(self):
        wrappers = (
            ('<section class="ltx_ERROR">', '</section>'),
            ('<div class="ltx_abstract ltx_ERROR">', '</div>'),
            ('<div class="ltx_bibliography ltx_error">', '</div>'),
        )
        for opening, closing in wrappers:
            with self.subTest(opening=opening):
                raw = opening + '<h2>Broken source</h2><p>unconverted formula</p>' + \
                    '<section><p>nested failure</p></section>bare failure' + closing + \
                    '<div class="unknown-wrapper"><p>clean sibling</p></div>'
                doc = parse_arxiv_html(article(raw), URL)
                affected = [b for b in doc.blocks if b.kind != 'title' and b.text != 'clean sibling']
                self.assertEqual(len(affected), 4)
                for block in affected:
                    self.assertIn('source-conversion-error', block.limitations)
                    self.assertEqual(doc.read(block.id)['parseStatus'], 'partial')
                clean = next(b for b in doc.blocks if b.text == 'clean sibling')
                self.assertNotIn('source-conversion-error', clean.limitations)
                self.assertEqual(doc.read(clean.id)['parseStatus'], 'parsed')
        for owner in ('table', 'tbody', 'tr'):
            raw = '<table><tbody><tr><td>unconverted cell</td></tr></tbody></table>'
            raw = raw.replace('<' + owner + '>', '<' + owner + ' class="ltx_ERROR">')
            doc = parse_arxiv_html(article(raw), URL)
            table = next(b for b in doc.blocks if b.kind == 'table')
            self.assertEqual(table.cells[0].text, 'unconverted cell')
            self.assertIn('source-conversion-error', table.limitations)
            self.assertEqual(doc.read(table.id)['parseStatus'], 'partial')

    def test_ambiguous_and_unresolved_citation_targets_are_not_guessed(self):
        doc = parse_arxiv_html(article('<p id="dup">first</p><p id="dup">second</p><p><a href="#dup">which?</a> <a href="#absent">missing</a></p>'), URL)
        refs = [t for b in doc.blocks for t in b.content if t.target]
        self.assertEqual([t.target_status for t in refs], ['ambiguous', 'unresolved'])
        self.assertIn('ambiguous-source-anchor', doc.warnings)
        self.assertIn('unresolved-reference', doc.warnings)

    def test_output_limits_and_unavailable_scientific_structure_are_explicit(self):
        raw = article('<h2>' + '中文' * 500 + '</h2>' * 1 +
                      ''.join('<h2>' + '中文' * 500 + '</h2>' for _ in range(69)))
        doc = parse_arxiv_html(raw, URL)
        self.assertLessEqual(len(encoded(doc.outline())), 32768)
        self.assertLess(doc.outline()['nextStart'], 64)
        raw = article('<p ' + 'id="' + 'a' * 800 + '">text</p>')
        doc = parse_arxiv_html(raw, URL)
        self.assertTrue(doc.read(doc.blocks[-1].id)['source']['anchorsTruncated'])
        doc = parse_arxiv_html(article('<div class="ltx_algorithm" id="alg">Algorithm 1\n  Step A\n  Step B</div><math alttext="\\unknown"></math>'), URL)
        algorithm = next(b for b in doc.blocks if b.kind == 'algorithm')
        self.assertIn('  Step A\n  Step B', algorithm.text)
        self.assertIn('algorithm-structure-unavailable', algorithm.limitations)
        self.assertIn('math-presentation-unavailable', doc.warnings)

    def test_nested_tables_preserve_text_without_claiming_reconstruction(self):
        doc = parse_arxiv_html(article('<table id="t"><tr><td>outer<table><tr><td>inner</td></tr></table></td></tr></table>'), URL)
        table = next(b for b in doc.blocks if b.kind == 'table')
        self.assertFalse(table.cells)
        self.assertIn('outerinner', table.text)
        self.assertIn('nested-or-multiple-tables-as-text', doc.warnings)
        self.assertIsNotNone(table.locator)


if __name__ == '__main__':
    unittest.main()
