"""Hermetic public-source boundary tests; fixtures are not research evidence."""
from io import BytesIO
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).parents[1] / "backend"))

from paper_agent.literature import LiteratureClient, PaperIdentity, SearchQuery, deduplicate
from paper_agent.model import Invalid, PaperSnapshot, canonical
from paper_agent.store import ResearchStore
from paper_agent.resource_fetch import WebDocument
from paper_agent.resource_inspection import ResourceInspector
from paper_agent.research_resources import ImportDraft


class Response(BytesIO):
    def __init__(self, value=b"", status=200, headers=None):
        if isinstance(value, (dict, list)):
            value = json.dumps(value).encode()
        elif isinstance(value, str):
            value = value.encode()
        super().__init__(value)
        self.status = status
        self.headers = headers or {}


WORK = {"id": "https://openalex.org/W123", "doi": "https://doi.org/10.1101/2026.01.01.1",
        "display_name": "A research paper", "publication_date": "2026-01-01", "cited_by_count": 3,
        "abstract_inverted_index": {"A": [0], "finding": [1]},
        "authorships": [{"author": {"display_name": "Researcher"}}, {"author": None}]}
NOW = "2026-10-29T00:00:00Z"


class LiteratureTest(unittest.TestCase):
    def test_query_and_identifier_rules_reject_unbounded_or_unsupported_requests(self):
        for request in ({"query": ""}, {"query": "a", "sources": ["unknown"]},
                        {"query": "a", "sources": ["pubmed", "pubmed"]},
                        {"query": "a", "sources": [["pubmed"]]}, {"query": "a", "limit": True},
                        {"query": "a", "limit": 21}, {"query": "a", "publishedAfter": "2026-02-30"},
                        {"query": "a", "publishedAfter": "2026-02-02", "publishedBefore": "2026-02-01"},
                        {"query": "a", "url": "https://localhost"}):
            with self.subTest(request=request), self.assertRaises(Invalid):
                SearchQuery.parse(request)
        self.assertEqual(SearchQuery.parse({"query": "  Graph RAG  ", "publishedAfter": "2024-02-29"}).query, "Graph RAG")
        for paper_id in ("https://localhost/abs/1706.03762", "https://user:pass@arxiv.org/abs/1706.03762",
                         "https://arxiv.org:443/abs/1706.03762", "../../../secret", "1706.03762?url=x"):
            with self.subTest(paper_id=paper_id), self.assertRaises(Invalid):
                PaperIdentity.parse({"id": paper_id})
        for paper_id, source, identity in (("https://arxiv.org/pdf/1706.03762v2.pdf", "alphaxiv", "1706.03762v2"),
                                           ("https://huggingface.co/papers/2601.12345", "alphaxiv", "2601.12345"),
                                           ("pmid:123", "pubmed", "123"), ("https://openalex.org/W123", "openalex", "W123"),
                                           ("https://www.biorxiv.org/content/10.1101/2026.01.01.1v2.full", "biorxiv", "10.1101/2026.01.01.1")):
            with self.subTest(paper_id=paper_id):
                parsed = PaperIdentity.parse({"id": paper_id})
                self.assertEqual((parsed.source, parsed.id), (source, identity))
        selected = PaperIdentity.parse({'id': 'https://huggingface.co/papers/2601.12345', 'source': 'huggingface'})
        self.assertEqual((selected.source, selected.id), ('alphaxiv', '2601.12345'))

    def test_sources_combine_deduplicate_and_preserve_partial_failure(self):
        def fetch(url, **_options):
            parsed = urlsplit(url)
            if parsed.hostname == "api.alphaxiv.org":
                self.assertEqual(parse_qs(parsed.query)["publishedAfter"], ["2026-01-01"])
                return Response([{"paperId": "2601.12345", "title": "A research paper", "abstract": "Original"}])
            if parsed.hostname == "api.openalex.org":
                return Response({"results": [WORK]})
            return Response(status=503)
        result = LiteratureClient(fetch, lambda: NOW).search({"query": "Graph RAG", "sources": ["alphaxiv", "openalex", "pubmed"], "publishedAfter": "2026-01-01"})
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["fetchedAt"], NOW)
        self.assertEqual(len(result["items"]), 1)
        self.assertEqual(result["items"][0]["id"], "2601.12345")
        self.assertEqual(result["items"][0]["alternatives"][0]["source"], "openalex")
        self.assertEqual(result["items"][0]["citations"], 3)
        self.assertEqual(result["items"][0]["citationSource"], "openalex")
        self.assertEqual(result["items"][0]["publicationDate"], "2026-01-01")
        self.assertEqual(result["items"][0]["authors"], ["Researcher"])
        reversed_result = LiteratureClient(fetch, lambda: NOW).search({"query": "Graph RAG", "sources": ["openalex", "alphaxiv"], "publishedAfter": "2026-01-01"})
        self.assertEqual(reversed_result['items'][0]['source'], 'alphaxiv')
        self.assertEqual(reversed_result['items'][0]['citations'], 3)
        self.assertEqual(reversed_result['items'][0]['citationSource'], 'openalex')
        self.assertEqual(result["errors"][0]["source"], "pubmed")
        self.assertEqual(result["warnings"][0]["source"], "pubmed")
        failed = LiteratureClient(lambda *_args, **_options: Response(status=429)).search({"query": "x"})
        self.assertEqual(failed["status"], "failed")
        self.assertEqual(len(deduplicate([{"source": "openalex", "id": "W1", "title": "A", "doi": "10.1101/x"},
                                          {"source": "biorxiv", "id": "10.1101/x", "title": "B", "doi": "10.1101/x"}])), 1)
        self.assertEqual(len(deduplicate([{"source": "openalex", "id": "W1", "title": "Same title", "doi": "10.1/a"},
                                          {"source": "pubmed", "id": "1", "title": "Same title", "doi": "10.1/b"}])), 2)
        self.assertEqual(len(deduplicate([{"source": "alphaxiv", "id": "2601.12345v1", "title": "Original title"},
                                          {"source": "alphaxiv", "id": "2601.12345v2", "title": "Updated title"}])), 1)

    def test_multisource_priority_orders_merged_candidates_and_unknown_citations_last(self):
        def fetch(url, **_options):
            if urlsplit(url).hostname == 'api.alphaxiv.org':
                return Response([{'paperId': '2601.11111', 'title': 'Recent', 'publicationDate': '2026-09-01'}])
            return Response({'results': [WORK, {**WORK, 'id': 'https://openalex.org/W456', 'doi': None,
                              'display_name': 'Unknown', 'publication_date': '2026-10-01', 'cited_by_count': None}]})
        client = LiteratureClient(fetch, lambda: NOW)
        recent = client.search({'query': 'x', 'sources': ['alphaxiv', 'openalex'], 'priority': 'recency'})['items']
        self.assertEqual([x['title'] for x in recent], ['Unknown', 'Recent', 'A research paper'])
        popular = client.search({'query': 'x', 'sources': ['alphaxiv', 'openalex'], 'priority': 'popular'})['items']
        self.assertEqual(popular[0]['citations'], 3)
        self.assertNotIn('citations', popular[1])
        self.assertNotIn('citations', popular[2])

    def test_huggingface_search_merges_paper_versions_and_keeps_observed_links(self):
        def fetch(url, **_options):
            if urlsplit(url).hostname == 'huggingface.co':
                self.assertEqual(parse_qs(urlsplit(url).query)['q'], ['research'])
                return Response([{'paper': {'id': '2601.12345', 'title': 'A paper', 'summary': 'Abstract',
                    'authors': [{'name': 'Researcher'}], 'publishedAt': '2026-01-01T12:00:00Z', 'upvotes': 8,
                    'githubRepo': 'https://github.com/team/code', 'githubStars': 12, 'projectPage': 'https://example.org/project'},
                    'thumbnail': 'https://cdn-thumbnails.huggingface.co/social-thumbnails/papers/2601.12345.png'}])
            return Response([{'paperId': '2601.12345v2', 'title': 'Renamed paper'}])
        client = LiteratureClient(fetch, lambda: NOW)
        item = client.search({'query': 'research', 'sources': ['alphaxiv', 'huggingface']})['items'][0]
        self.assertEqual((item['source'], item['id']), ('alphaxiv', '2601.12345v2'))
        self.assertEqual((item['hfVotes'], item['githubStars']), (8, 12))
        self.assertEqual(item['githubUrl'], 'https://github.com/team/code')
        self.assertEqual(item['projectUrl'], 'https://example.org/project')
        self.assertEqual(item['paperUrl'], 'https://huggingface.co/papers/2601.12345')
        self.assertIn('cdn-thumbnails.huggingface.co', item['thumbnailUrl'])
        self.assertEqual(item['thumbnailId'], '2601.12345')
        self.assertEqual(item['alternatives'][0]['source'], 'huggingface')
        self.assertEqual(PaperIdentity.parse({'source': 'huggingface', 'id': item['alternatives'][0]['id']}).source, 'alphaxiv')
        filtered = client.search({'query': 'research', 'sources': ['huggingface'], 'publishedAfter': '2026-02-01'})
        self.assertEqual(filtered['items'], [])

        def unsafe(_url, **_options):
            return Response([{'paper': {'id': '2601.11111', 'title': 'Other', 'githubRepo': 'https://example.org/code'},
                              'thumbnail': 'https://example.org/image.png'}])
        item = LiteratureClient(unsafe).search({'query': 'x', 'sources': ['huggingface']})['items'][0]
        self.assertNotIn('thumbnailUrl', item)
        self.assertNotIn('thumbnailId', item)
        self.assertNotIn('githubUrl', item)
        self.assertNotIn('hfVotes', item)
        long_query = client.search({'query': 'x' * 251, 'sources': ['huggingface']})
        self.assertEqual(long_query['status'], 'failed')
        self.assertIn('250 characters', long_query['errors'][0]['error'])

    def test_alphaxiv_fallback_and_publisher_metadata_preserve_original_text(self):
        source = "# Original paper\n\nUnchanged source & evidence."
        def fetch(url, **options):
            parsed = urlsplit(url)
            if parsed.hostname == "arxiv.org":
                self.assertEqual(options["timeout"], 6)
                return Response('<meta name="citation_title" content="A &amp; B"><meta content="Researcher" name="citation_author">', headers={"Content-Type": "text/html"})
            return Response(status=404) if parsed.path.startswith("/overview/") else Response(source)
        reading = LiteratureClient(fetch, lambda: NOW).read({"id": "https://arxiv.org/abs/1706.03762"})
        self.assertEqual(reading["contentKind"], "full-text")
        self.assertEqual(reading["content"], source)
        self.assertEqual(reading["title"], "A & B")
        self.assertEqual(reading["authors"], ["Researcher"])
        self.assertEqual(reading["pdfUrl"], "https://arxiv.org/pdf/1706.03762")
        self.assertRegex(reading["contentDigest"], r"^sha256:[a-f0-9]{64}$")
        def unavailable_metadata(url, **_options):
            return Response(status=503) if urlsplit(url).hostname == "arxiv.org" else Response(source)
        unchanged = LiteratureClient(unavailable_metadata).read({"id": "1706.03762", "full": True})
        self.assertEqual(unchanged["content"], source)
        self.assertEqual(unchanged["contentDigest"], reading["contentDigest"])
        self.assertEqual(unchanged["title"], "1706.03762")
        # Long online papers must remain intact through the add/reload boundary.
        for size in (124773, 302129):
            with self.subTest(size=size):
                content = "# Long paper\n" + "Evidence. " * (size // 10)
                client = LiteratureClient(lambda url, **kw: Response(status=503) if urlsplit(url).hostname == "arxiv.org" else Response(content))
                snapshot = PaperSnapshot.from_reading(client.read({"id": "2610.14224", "full": True}), NOW)
                self.assertEqual(snapshot.content, content)
                self.assertEqual(PaperSnapshot.from_record(snapshot.to_dict()), snapshot)

    def test_arxiv_abstract_fallback_keeps_import_and_full_text_scope_distinct(self):
        official = ('<meta name="citation_title" content="Official paper">'
                    '<meta name="citation_arxiv_id" content="2601.12345">'
                    '<meta name="citation_author" content="Researcher">'
                    '<meta name="citation_abstract" content="Exact official abstract &amp; evidence.">')
        for source, full, body, status in (('huggingface', True, '', 404),
                                         ('huggingface', True, '   ', 200),
                                         ('huggingface', True, '', 503),
                                         ('alphaxiv', True, '', 404),
                                         ('alphaxiv', False, '', 404)):
            with self.subTest(source=source, full=full, status=status, body=body):
                def fetch(url, **_options):
                    return Response(official, headers={'Content-Type': 'text/html'}) if urlsplit(url).hostname == 'arxiv.org' else Response(body, status)
                reading = LiteratureClient(fetch).read(dict(source=source, id='2601.12345v1', full=full))
                paper = PaperSnapshot.from_reading(reading, NOW)
                self.assertEqual((paper.source, paper.content_kind, paper.source_revision), ('arxiv', 'abstract', 'v1'))
                self.assertEqual(paper.content, 'Exact official abstract & evidence.')
                self.assertEqual(paper.url, 'https://arxiv.org/abs/2601.12345v1')
                self.assertIn('abstract only', paper.limitation)
                self.assertEqual(PaperSnapshot.from_record(paper.to_record()), paper)
        for markup in ('<meta name="citation_title" content="No abstract">',
                       official.replace('2601.12345', '2601.99999'),
                       official.replace('2601.12345', '2601.12345v2')):
            with self.subTest(markup=markup), self.assertRaises(Invalid):
                LiteratureClient(lambda url, **kw: Response(markup, headers={'Content-Type': 'text/html'}) if urlsplit(url).hostname == 'arxiv.org' else Response(status=404)).read(dict(id='2601.12345v1', source='huggingface', full=True))
        # Metadata availability must never replace already retrieved source bytes.
        unchanged = '# Source\nOriginal full text.'
        for markup in (official, '<meta name="citation_title" content="No abstract">'):
            reading = LiteratureClient(lambda url, **kw: Response(markup, headers={'Content-Type': 'text/html'}) if urlsplit(url).hostname == 'arxiv.org' else Response(unchanged)).read(dict(id='2601.12345', source='huggingface', full=True))
            self.assertEqual((reading['contentKind'], reading['content']), ('full-text', unchanged))

    def test_abstract_sources_reconstruct_content_and_retain_full_text_limitations(self):
        def fetch(url, **_options):
            parsed = urlsplit(url)
            if parsed.hostname == "api.openalex.org":
                return Response({"results": [WORK]} if parsed.path == "/works" else WORK)
            if parsed.hostname == "api.biorxiv.org":
                return Response({"collection": [{"title": "Bio paper", "abstract": "Older", "version": "1"},
                                                 {"title": "Bio paper", "abstract": "New &amp; checked", "version": "2", "authors": "A; B"}]})
            if parsed.path.endswith("esummary.fcgi"):
                return Response({"result": {"123": {"title": "Medical paper", "sortpubdate": "2025/02/01 00:00", "authors": [{"name": "A"}], "articleids": [{"idtype": "pmc", "value": "PMC123"}]}}})
            if parsed.path.endswith("efetch.fcgi"):
                return Response('<PubmedArticleSet><PubmedArticle><PMID Version="1">123</PMID><Abstract><AbstractText Label="METHODS">A <i>real</i> method &amp; result.</AbstractText></Abstract></PubmedArticle></PubmedArticleSet>')
            return Response({"esearchresult": {"idlist": ["123"]}})
        client = LiteratureClient(fetch)
        for paper_id, expected, kind in (("W123", "A finding", "abstract"),
                                         ("10.1101/2026.01.01.1", "New & checked", "abstract"),
                                         ("pmid:123", "METHODS: A real method & result.", "abstract")):
            with self.subTest(paper_id=paper_id):
                reading = client.read({"id": paper_id, "full": True})
                self.assertEqual((reading["content"], reading["contentKind"]), (expected, kind))
                self.assertTrue(reading["limitation"])
                with tempfile.TemporaryDirectory() as root:
                    store = ResearchStore(root)
                    snapshot = store.save_paper(PaperSnapshot.from_reading(reading, NOW))
                    reopened = ResearchStore(root).paper(snapshot.id)
                    self.assertEqual(reopened, snapshot)
                    if paper_id.startswith('pmid:'):
                        self.assertEqual(reopened.full_text_url, 'https://pmc.ncbi.nlm.nih.gov/articles/PMC123/')
                    elif paper_id.startswith('10.1101/'):
                        self.assertEqual(reopened.full_text_url, 'https://www.biorxiv.org/content/10.1101/2026.01.01.1v2.full')
                    else:
                        self.assertNotIn('fullTextUrl', reopened.to_record())
                if paper_id == "W123":
                    self.assertEqual(reading["authors"], ["Researcher"])
        hits = client.search({"query": "biology", "sources": ["biorxiv", "pubmed"]})
        self.assertEqual([hit["source"] for hit in hits["items"]], ["biorxiv", "pubmed"])
        self.assertEqual(hits["items"][0]["id"], "10.1101/2026.01.01.1")

    def test_biorxiv_requested_versions_survive_saved_snapshots(self):
        doi = '10.1101/2026.01.01.1'
        records = [{'title': 'Versioned preprint', 'abstract': 'Original evidence.', 'version': '1'},
                   {'title': 'Versioned preprint', 'abstract': 'Revised evidence.', 'version': '2'}]
        def fetch(url, **_options):
            self.assertEqual(url, f'https://api.biorxiv.org/details/biorxiv/{doi}/na/json')
            return Response({'collection': records})
        cases = [(doi, 'v2', 'Revised evidence.'),
                 (doi + 'v1', 'v1', 'Original evidence.'),
                 (f'https://doi.org/{doi}v1', 'v1', 'Original evidence.'),
                 (f'https://www.biorxiv.org/content/{doi}v1', 'v1', 'Original evidence.'),
                 (f'https://www.biorxiv.org/content/{doi}v1.full', 'v1', 'Original evidence.'),
                 (f'https://www.biorxiv.org/content/{doi}v1.full.pdf', 'v1', 'Original evidence.'),
                 (doi + 'v3', None, None), (doi + 'v0', None, None)]
        with tempfile.TemporaryDirectory() as directory:
            store = ResearchStore(directory)
            saved = {}
            for identifier, revision, content in cases:
                with self.subTest(identifier=identifier):
                    if revision is None:
                        with self.assertRaises(Invalid):
                            LiteratureClient(fetch).read(dict(id=identifier, full=True))
                        continue
                    reading = LiteratureClient(fetch).read(dict(id=identifier, full=True))
                    paper = store.save_paper(PaperSnapshot.from_reading(reading, NOW))
                    self.assertEqual(paper.content, content)
                    self.assertEqual(paper.source_revision, revision)
                    self.assertEqual(paper.url, f'https://www.biorxiv.org/content/{doi}{revision}')
                    saved[revision] = paper
            reopened = ResearchStore(directory)
            self.assertNotEqual(saved['v1'].id, saved['v2'].id)
            for paper in saved.values():
                self.assertEqual(reopened.paper(paper.id), paper)
            # URL inspection must read the requested URL before canonical DOI
            # aliases can erase its version, then keep the version on commit.
            inspector = ResourceInspector(lambda url, **kw: WebDocument(url, 'application/json', json.dumps({'collection': records})))
            for identifier, revision, content in cases[:5]:
                if not identifier.startswith('https://'):
                    continue
                draft = inspector.inspect(ImportDraft.create(identifier, NOW), threading.Event())
                store.imports._replace('import-drafts', draft.id, draft.to_dict())
                bundle = store.imports.commit(dict(draftId=draft.id, resourceIds=[draft.resources[0].id]), NOW)
                inspected = store.paper(bundle.resources[0].paperId)
                self.assertEqual((inspected.source_revision, inspected.content), (revision, content))
        for version in ('unknown', '0', None, True):
            with self.subTest(version=version), self.assertRaises(Invalid):
                LiteratureClient(lambda *_a, **_k: Response({'collection': [{**records[0], 'version': version}]})).read(dict(id=doi))

    def test_external_response_bounds_and_redirect_refusal_are_visible(self):
        for response in (Response("bad", headers={"Content-Length": "1048577"}),
                         Response(b"x" * 1048577), Response(status=302)):
            with self.subTest(status=response.status), self.assertRaises(Invalid):
                LiteratureClient(lambda *_args, **_options: response).read({"id": "1706.03762"})
        def no_network(*_args, **_options):
            self.fail("Invalid paper destinations must be refused before network access")
        for paper_id in ("https://localhost/abs/1706.03762", "../secret"):
            with self.subTest(paper_id=paper_id), self.assertRaises(Invalid):
                LiteratureClient(no_network).read({"id": paper_id})
        def malformed_xml(url, **_options):
            if urlsplit(url).path.endswith("efetch.fcgi"):
                return Response("<malformed>")
            return Response({"result": {}})
        with self.assertRaisesRegex(Invalid, "PubMed XML"):
            LiteratureClient(malformed_xml).read({"id": "123"})

    def test_unpaired_surrogates_in_provider_json_remain_encodable(self):
        def fetch(url, **_options):
            host = urlsplit(url).hostname
            if host == "api.alphaxiv.org":
                return Response([{"paperId": "2601.12345", "title": "Loss \ud835", "abstract": "see \U0001d434"}])
            if host == "api.openalex.org":
                work = {**WORK, "id": "https://openalex.org/W999", "doi": None, "display_name": "Other \ud835",
                        "abstract_inverted_index": {"\ud835": [0], "term": [1]}}
                return Response({"results": [work]})
            return Response(status=503)
        result = LiteratureClient(fetch, lambda: NOW).search({"query": "loss", "sources": ["alphaxiv", "openalex"]})
        items = {item["source"]: item for item in result["items"]}
        self.assertEqual(items["alphaxiv"]["title"], "Loss \ufffd")
        self.assertEqual(items["alphaxiv"]["abstract"], "see \U0001d434")
        self.assertEqual(items["openalex"]["title"], "Other \ufffd")
        self.assertEqual(items["openalex"]["abstract"], "\ufffd term")
        self.assertIn("Loss \ufffd".encode(), canonical(result))


if __name__ == "__main__":
    unittest.main()
