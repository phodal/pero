"""Hermetic public-source boundary tests; fixtures are not research evidence."""
from io import BytesIO
import json
from pathlib import Path
import sys
import unittest
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).parents[1] / "backend"))

from paper_agent.literature import LiteratureClient, PaperIdentity, SearchQuery, deduplicate
from paper_agent.model import Invalid


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
                                           ("pmid:123", "pubmed", "123"), ("https://openalex.org/W123", "openalex", "W123"),
                                           ("https://www.biorxiv.org/content/10.1101/2026.01.01.1v2.full", "biorxiv", "10.1101/2026.01.01.1")):
            with self.subTest(paper_id=paper_id):
                parsed = PaperIdentity.parse({"id": paper_id})
                self.assertEqual((parsed.source, parsed.id), (source, identity))

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
        self.assertEqual(result["errors"][0]["source"], "pubmed")
        self.assertEqual(result["warnings"][0]["source"], "pubmed")
        failed = LiteratureClient(lambda *_args, **_options: Response(status=429)).search({"query": "x"})
        self.assertEqual(failed["status"], "failed")
        self.assertEqual(len(deduplicate([{"source": "openalex", "id": "W1", "title": "A", "doi": "10.1101/x"},
                                          {"source": "biorxiv", "id": "10.1101/x", "title": "B", "doi": "10.1101/x"}])), 1)

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
                if paper_id == "W123":
                    self.assertEqual(reading["authors"], ["Researcher"])
        hits = client.search({"query": "biology", "sources": ["biorxiv", "pubmed"]})
        self.assertEqual([hit["source"] for hit in hits["items"]], ["biorxiv", "pubmed"])
        self.assertEqual(hits["items"][0]["id"], "10.1101/2026.01.01.1")

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


if __name__ == "__main__":
    unittest.main()
