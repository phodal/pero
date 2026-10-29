"""Frozen retrieval and PDF citation behavior, independent of any model provider."""
from dataclasses import replace
import json
from pathlib import Path
import tempfile
import unittest
from test_pdf import NOW, pdf_fixture
from paper_agent.model import Invalid, PaperSnapshot, ResearchRequest
from paper_agent.pdf_files import PdfFiles
from paper_agent.pdf import PdfDocument, PdfPage
from paper_agent.retrieval import SearchQuery, SourceVersion, chunks
from paper_agent.search_index import SearchIndex
from paper_agent.reports import EvidenceReference
from paper_agent.store import ResearchStore


class RetrievalTest(unittest.TestCase):
    def test_ranked_bounded_passages(self):
        paper = PaperSnapshot.from_reading(dict(title='Retrieval', sourceId='test', url='https://example.invalid/paper', contentKind='abstract', content='Abstract'), NOW)
        doc = PdfDocument.create(paper.id, 'b' * 64, 'https://arxiv.org/pdf/1706.03762',
             tuple(PdfPage(i + 1, 400, 600, ('Attention mechanism controls weighting. ' if i == 7 else 'Unrelated background. ') * 120) for i in range(30)), NOW)
        with tempfile.TemporaryDirectory() as root, SearchIndex(Path(root) / 'index.sqlite') as index:
            index.replace(SourceVersion.of(paper, doc), chunks(paper, doc))
            found = tuple(hit.chunk for hit in index.search(SearchQuery('attention weighting', (paper.id,), pdf_only=True)).hits)
            self.assertEqual(found[0].page, 8)
            self.assertLessEqual(len(found), 12)
            self.assertLessEqual(sum(len(p.content) for p in found), 19200)
            self.assertTrue(all(doc.page(p.page).text[p.start:p.start + len(p.content)] == p.content for p in found))
            self.assertFalse(index.search(SearchQuery('中文问题', (paper.id,), pdf_only=True)).hits)
            with self.assertRaises(Invalid):
                SearchQuery.parse(dict(query='***'))

    def test_frozen_pdf_answer_and_exact_regions(self):
        paper = PaperSnapshot.from_reading(dict(title='PDF question', sourceId='1706.03762', url='https://arxiv.org/abs/1706.03762',
                 pdfUrl='https://arxiv.org/pdf/1706.03762', contentKind='abstract', content='This abstract excludes the PDF answer.'), NOW)
        files = PdfFiles(); data = pdf_fixture(); doc = files.inspect(paper, data, NOW)
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root); store.save_paper(paper); store.save_pdf(doc, data)
            request = ResearchRequest.parse(dict(question='Second page', paperIds=[paper.id], requestId='pdf-question', fullText=True))
            intent = store.prepare(request, NOW)
            passage = intent.passages[0]
            self.assertEqual(passage.page, 2)
            self.assertEqual(intent.retrieval.source_ids, (doc.id,))
            self.assertEqual(intent.retrieval.passage_ids, tuple(p.id for p in intent.passages))
            self.assertIn('fts5-bm25', intent.prompt())
            legacy = intent.to_dict(False)
            legacy.pop('retrieval')
            from paper_agent.model import ResearchInput
            self.assertEqual(ResearchInput.from_record(legacy).prompt(), intent.prompt())
            quote = 'Second page. Exact original evidence.'
            ref = dict(paperId=paper.id, passageId=passage.id, quote=quote)
            for patch, valid in (({}, True), (dict(passageId='c' * 64), False), (dict(quote='invented'), False), (dict(passageId=None), False)):
                with self.subTest(patch=patch):
                    if valid:
                        evidence = EvidenceReference.parse_many([{**ref, **patch}], (paper.id,), intent.papers, intent.passages)[0]
                    else:
                        with self.assertRaises(Invalid):
                            EvidenceReference.parse_many([{**ref, **patch}], (paper.id,), intent.papers, intent.passages)
            location = evidence.locate(intent.papers, intent.passages)
            rects = files.locate_quote(data, doc, 2, location['pdf']['sourceStart'], quote)
            self.assertTrue(rects)
            self.assertTrue(all(0 <= r.x < 1 and 0 <= r.y < 1 for r in rects))
            report = dict(schema='pero.paper-agent-report.v1', intentId=intent.id, title='Answer',
                          sections=[dict(heading='Answer', content='Evidence [1](evidence:1).', paperIds=[paper.id], evidence=[ref])], experiments=[], limitations='Unverified')
            saved = store.save_report(intent.id, json.dumps(report), NOW)
            self.assertIn('#page=2', saved.report.markdown(intent))
            self.assertIn(doc.file_digest, saved.report.markdown(intent))
            self.assertIn('## Retrieval scope', saved.report.markdown(intent))
            exported = json.loads(store.export(saved.id, 'json')['content'])
            self.assertEqual(exported['retrieval'], intent.retrieval.to_dict())
            self.assertEqual(exported['passages'][0]['fileDigest'], doc.file_digest)
            self.assertEqual(exported['sources'][0]['contentKind'], 'abstract')
            reopened = ResearchStore(root)
            self.assertEqual(reopened.intent(intent.id), intent)
            self.assertEqual(reopened.report(saved.id).report.sections[0].evidence[0].passage_id, passage.id)
            self.assertEqual(store.prepare(request, 'later'), intent)
            new_data = data.replace(b'First', b'Other')
            newer = files.inspect(paper, new_data, 'later')
            store.save_pdf(newer, new_data)
            self.assertEqual(store.prepare(request, 'later'), intent)


class LocalLibrarySearch(unittest.TestCase):
    def test_exact_heading_chunks_cover_late_text(self):
        content = '# Overview\nIntro.\n## Method\n' + '中文方法与原文。' * 900 + '\n## Results\nUnique late result.'
        paper = PaperSnapshot.from_reading(dict(title='Chunks', content=content, contentKind='full-text',
            url='https://example.invalid/chunks'), NOW)
        passages = chunks(paper)
        for passage in passages:
            self.assertEqual(content[passage.start:passage.start + len(passage.content)], passage.content)
            self.assertLessEqual(len(passage.content), 1600)
        late = next(p for p in passages if 'Unique late result.' in p.content)
        self.assertEqual(late.heading, 'Results')
        self.assertTrue(all(p.heading == 'Method' for p in passages if '中文方法' in p.content))
        self.assertTrue(any(p.start > 6000 for p in passages))

    def test_source_lifecycle_and_search_scope(self):
        paper = PaperSnapshot.from_reading(dict(title='Synthetic attention', content='# Method\nAttention weighting is bounded.\n中文检索保持原文。 Énergie mesurée.',
            contentKind='abstract', url='https://example.invalid/attention'), NOW)
        unrelated = PaperSnapshot.from_reading(dict(title='Other', content='A different document mentions control.',
            contentKind='report', url='https://example.invalid/other'), NOW)
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root); store.save_paper(paper); store.save_paper(unrelated)
            # A first search backfills JSON saved before the index existed.
            for query, ids, expected in (
                ('attention', (), [paper.id]), ('中文检索', (), [paper.id]), ('énergie', (), [paper.id]),
                ('Other', (), [unrelated.id]), ('control', (paper.id,), []), ('unfindable', (), []), ('" OR * control', (), [unrelated.id]),
            ):
                with self.subTest(query=query):
                    result = store.search(SearchQuery.parse(dict(query=query, paperIds=list(ids))))
                    self.assertEqual([hit.chunk.source.paper_id for hit in result.hits], expected)
                    for hit in result.hits:
                        source = store.paper(hit.chunk.source.paper_id)
                        self.assertEqual(source.content[hit.chunk.start:hit.chunk.start + len(hit.chunk.content)], hit.chunk.content)
                        self.assertEqual(source.content_kind, hit.chunk.source.content_kind)
                        self.assertEqual(source.content_digest, hit.chunk.source.content_digest)
            # Restart retains identities; the cache can be deleted and rebuilt.
            original = store.search(SearchQuery('attention', (paper.id,)))
            reopened = ResearchStore(root)
            self.assertEqual(reopened.search(original.query), original)
            (store.root / 'search-v1.sqlite3').unlink()
            self.assertEqual(reopened.search(original.query), original)
            new_doc = PdfDocument.create(paper.id, 'c' * 64, paper.url,
                (PdfPage(1, 400, 600, 'A newer PDF describes attention.'),), '2026-10-30T08:00:00Z')
            store.save_pdf(new_doc, b'synthetic')
            found = reopened.search(SearchQuery('newer', (paper.id,), pdf_only=True))
            self.assertEqual(found.hits[0].chunk.source.file_digest, new_doc.file_digest)
            self.assertEqual(found.hits[0].chunk.source.content_kind, 'full-text')
            # A withdrawn library snapshot cannot remain discoverable through its PDF.
            (store.root / 'papers' / (paper.id + '.json')).unlink()
            self.assertFalse(store.search(SearchQuery('attention', ())).hits)

    def test_latest_pdf_and_unmatched_frozen_sources(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            papers = [PaperSnapshot.from_reading(dict(title=label, content=label, contentKind='abstract',
                url='https://example.invalid/' + label), NOW) for label in ('one', 'two')]
            for paper in papers:
                store.save_paper(paper)
                doc = PdfDocument.create(paper.id, paper.id, paper.url,
                    (PdfPage(1, 400, 600, 'Attention evidence.' if paper == papers[0] else 'Unrelated background.'),), NOW)
                store.save_pdf(doc, b'synthetic')
            request = ResearchRequest.parse(dict(question='Attention', paperIds=[p.id for p in papers], requestId='coverage', fullText=True))
            frozen = store.prepare(request, NOW)
            self.assertEqual(frozen.retrieval.unmatched_paper_ids, (papers[1].id,))
            old_doc = frozen.passages[0].document_id
            newer = PdfDocument.create(papers[0].id, 'd' * 64, papers[0].url,
                (PdfPage(1, 400, 600, 'Replacement evidence.'),), '2026-10-30T08:00:00Z')
            store.save_pdf(newer, b'synthetic')
            self.assertFalse(store.search(SearchQuery('Attention', (papers[0].id,), pdf_only=True)).hits)
            self.assertEqual(store.prepare(request, NOW), frozen)
            self.assertEqual(store.pdf(old_doc).id, old_doc)
            no_match = ResearchRequest.parse(dict(question='Attention', paperIds=[papers[0].id], requestId='empty', fullText=True))
            with self.assertRaisesRegex(Invalid, 'No matching PDF passages'):
                store.prepare(no_match, NOW)
            with self.assertRaisesRegex(Invalid, 'searchable words'):
                store.prepare(ResearchRequest.parse(dict(question='???', paperIds=[papers[0].id], requestId='punctuation', fullText=True)), NOW)
