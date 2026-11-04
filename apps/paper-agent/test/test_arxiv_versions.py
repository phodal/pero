"""Official version metadata pins offers, never fetches source/PDF bytes."""
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from dataclasses import replace
from paper_agent.model import Invalid, PaperSnapshot
from paper_agent.arxiv_versions import ArxivVersion, metadata_url
from paper_agent.research_resources import ArxivPaper, ImportDraft, ImportSelection, ResearchBundle
from paper_agent.resource_fetch import WebDocument
from paper_agent.resource_inspection import ResourceInspector
from paper_agent.store import ResearchStore

WORK = '2610.24806'
NOW = '2026-11-01T08:00:00Z'
API = metadata_url(WORK)


def atom(identifier):
    return '<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>' + identifier + '</id><title>Not used to infer versions</title></entry></feed>'


class ArxivVersionTest(unittest.TestCase):
    def inspect(self, url, fetch, cancelled=None):
        with patch.object(ResourceInspector, 'resolve', lambda _self, resource, _fetch: (resource, [])):
            return ResourceInspector(fetch, arxiv_interval=0).inspect(ImportDraft.create(url, NOW), cancelled or threading.Event())

    def test_unversioned_abs_source_pdf_freeze_official_v2_only(self):
        for endpoint in ('abs', 'src', 'pdf', 'doi'):
            with self.subTest(endpoint=endpoint):
                calls = []
                def fetch(url, **_kwargs):
                    calls.append(url)
                    self.assertEqual(url, API, 'No representation request is authorized')
                    return WebDocument(url, 'application/atom+xml', atom('http://arxiv.org/abs/' + WORK + 'v2'))
                url = 'https://doi.org/10.48550/arxiv.' + WORK if endpoint == 'doi' else 'https://arxiv.org/' + endpoint + '/' + WORK
                draft = self.inspect(url, fetch)
                offered = [r for r in draft.resources if r.kind in ('source_archive', 'pdf_candidate')]
                self.assertEqual({r.originalUrl for r in offered}, {'https://arxiv.org/src/' + WORK + 'v2', 'https://arxiv.org/pdf/' + WORK + 'v2'})
                self.assertTrue(all(r.revision == 'v2' and r.workIdentity == 'arxiv:' + WORK for r in offered))
                self.assertTrue(all(any(e.kind == 'arxiv_api_version' for e in r.evidence) for r in offered))
                selection = ImportSelection.parse(dict(draftId=draft.id, resourceIds=[r.id for r in offered]), draft)
                bundle = ResearchBundle.selected(draft, selection, NOW)
                self.assertEqual((bundle.sourceDownloadIds, bundle.pdfDownloadIds), ((), ()))
                self.assertEqual(calls, [API])
                with tempfile.TemporaryDirectory() as directory:
                    store = ResearchStore(directory)
                    store.imports._replace('import-drafts', draft.id, draft.to_dict())
                    self.assertEqual(store.imports.inspect(dict(url=draft.seedUrl), NOW), draft)
                    self.assertEqual(calls, [API], 'A ready persisted draft must reuse its frozen version')

    def test_malformed_missing_mismatched_or_denied_metadata_never_guesses(self):
        for body in (atom('http://arxiv.org/abs/9999.12345v2'), atom('http://arxiv.org/abs/' + WORK),
                     '<feed/>', '<!DOCTYPE feed [<!ENTITY x "x">]><feed/>', atom('http://arxiv.org/abs/' + WORK + 'v0')):
            def fetch(url, **_kwargs):
                self.assertEqual(url, API)
                return WebDocument(url, 'application/atom+xml', body)
            draft = self.inspect('https://arxiv.org/abs/' + WORK, fetch)
            self.assertFalse(any(r.kind in ('source_archive', 'pdf_candidate') for r in draft.resources))
            self.assertIsNone(draft.resources[0].revision)
            self.assertIn('no version was guessed', ' '.join(draft.resources[0].unresolved))
        calls = []
        def denied(url, **_kwargs):
            calls.append(url)
            raise Invalid('HTTP 429', 429)
        draft = self.inspect('https://arxiv.org/abs/' + WORK, denied)
        self.assertEqual(calls, [API])
        self.assertIsNone(draft.resources[0].revision)
        for url, mime in (('https://example.org/api/query', 'application/atom+xml'), (API, 'text/html')):
            with self.assertRaises(Invalid):
                ArxivVersion.parse(WORK, WebDocument(url, mime, atom('http://arxiv.org/abs/' + WORK + 'v2')))

    def test_saved_identity_uses_doi_and_provider_links_without_rewriting_snapshots(self):
        base = PaperSnapshot.from_reading(dict(source='openalex', sourceId='W123', title='Saved DOI',
            url='https://doi.org/10.48550/arxiv.' + WORK, contentKind='abstract', content='Saved abstract.'), NOW)
        for paper, revision in ((base, None),
                (PaperSnapshot.from_reading({**base.to_dict(), 'url': 'https://doi.org/10.1234/published', 'fullTextUrl': 'https://arxiv.org/html/' + WORK + 'v2'}, NOW), 'v2'),
                (PaperSnapshot.from_reading({**base.to_dict(), 'url': 'https://doi.org/10.1234/published', 'pdfUrl': 'https://arxiv.org/pdf/' + WORK + 'v2'}, NOW), 'v2')):
            with self.subTest(paper=paper):
                work = ArxivPaper.from_snapshot(paper)
                self.assertEqual((work.work, work.revision), (WORK, revision))
                before = paper.to_record()
                view = ArxivPaper.reading_view(paper)
                self.assertEqual(view['arxivUrl'], 'https://arxiv.org/abs/' + WORK + (revision or ''))
                self.assertEqual(PaperSnapshot.from_record(before), paper)
                self.assertEqual(paper.to_record(), before)
        for changed in (dict(pdf_url='https://arxiv.org/pdf/9999.12345v2'),
                        dict(source_revision='v1', full_text_url='https://arxiv.org/html/' + WORK + 'v2')):
            with self.subTest(changed=changed), self.assertRaises(Invalid):
                ArxivPaper.from_snapshot(replace(base, **changed))

    def test_per_inspection_cache_throttle_and_cancel(self):
        calls, waits = [], []
        class Cancellation:
            def is_set(self): return False
            def wait(self, seconds): waits.append(seconds); return False
        seed = 'https://example.org/research'
        def fetch(url, **_kwargs):
            calls.append(url)
            if url == seed:
                return WebDocument(url, 'text/html', '<main><a href="https://arxiv.org/src/' + WORK + '">Source</a><a href="https://arxiv.org/pdf/' + WORK + '">PDF</a></main>')
            self.assertEqual(url, API)
            return WebDocument(url, 'application/atom+xml', atom('http://arxiv.org/abs/' + WORK + 'v2'))
        draft = ResourceInspector(fetch).inspect(ImportDraft.create(seed, NOW), Cancellation())
        self.assertEqual(calls, [seed, API])
        self.assertEqual(waits, [3])
        self.assertEqual(len([r for r in draft.resources if r.kind in ('source_archive', 'pdf_candidate')]), 2)
        cancelled = threading.Event(); cancelled.set()
        self.assertEqual(self.inspect('https://arxiv.org/abs/' + WORK, fetch, cancelled).status, 'cancelled')
        self.assertEqual(calls, [seed, API])


if __name__ == '__main__':
    unittest.main()
