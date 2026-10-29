"""Bounded public-literature adapters, ported from Point (Apache-2.0).

Copyright Point contributors. Paper text is untrusted source material. A
content digest identifies bytes, not scientific validity or author identity.
"""
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date, datetime, timezone
import hashlib
import html
from html.parser import HTMLParser
import json
import re
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import xml.etree.ElementTree as ET

from .discovery import DiscoveryBatch, DiscoveryPaper, SeedMatches, WORK
from .model import Invalid

SOURCES = ("alphaxiv", "openalex", "biorxiv", "pubmed")
ORIGINS = frozenset(("api.alphaxiv.org", "www.alphaxiv.org", "api.openalex.org",
                     "api.biorxiv.org", "eutils.ncbi.nlm.nih.gov", "arxiv.org"))
LIMIT_BYTES = 1024 * 1024
ARXIV = re.compile(r"(?:\d{4}\.\d{4,5}|[a-z][a-z.-]*/\d{7})(?:v\d+)?", re.I)


def _keys(value, allowed):
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise Invalid("Invalid literature request")


@dataclass(frozen=True)
class SearchQuery:
    query: str
    sources: tuple[str, ...] = ("alphaxiv",)
    strategy: str = "keyword"
    limit: int = 10
    priority: str = "default"
    published_after: str | None = None
    published_before: str | None = None

    @classmethod
    def parse(cls, value):
        _keys(value, ("query", "sources", "strategy", "limit", "priority", "publishedAfter", "publishedBefore"))
        query = value.get("query")
        if not isinstance(query, str) or not query.strip() or len(query) > 500 or re.search(r"[\x00-\x1f]", query):
            raise Invalid("Query must contain 1–500 characters")
        sources = value.get("sources", ["alphaxiv"])
        if (not isinstance(sources, list) or not 1 <= len(sources) <= 4
                or any(not isinstance(source, str) or source not in SOURCES for source in sources)
                or len(set(sources)) != len(sources)):
            raise Invalid("Invalid literature sources")
        strategy, priority, limit = value.get("strategy", "keyword"), value.get("priority", "default"), value.get("limit", 10)
        if strategy not in ("keyword", "embedding") or priority not in ("default", "recency", "historical", "popular"):
            raise Invalid("Invalid retrieval strategy or priority")
        if type(limit) is not int or not 1 <= limit <= 20:
            raise Invalid("Limit must be 1–20")
        after, before = value.get("publishedAfter"), value.get("publishedBefore")
        for day in (after, before):
            if day is not None:
                if not isinstance(day, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
                    raise Invalid("Invalid publication date")
                try:
                    date.fromisoformat(day)
                except ValueError as error:
                    raise Invalid("Invalid publication date") from error
        if after and before and after > before:
            raise Invalid("Publication window is reversed")
        return cls(query.strip(), tuple(sources), strategy, limit, priority, after, before)

    def document(self):
        value = {"query": self.query, "sources": list(self.sources), "strategy": self.strategy,
                 "limit": self.limit, "priority": self.priority}
        if self.published_after:
            value["publishedAfter"] = self.published_after
        if self.published_before:
            value["publishedBefore"] = self.published_before
        return value


@dataclass(frozen=True)
class PaperIdentity:
    source: str
    id: str
    full: bool = False

    @classmethod
    def parse(cls, value):
        _keys(value, ("id", "source", "full"))
        paper_id, source, full = value.get("id"), value.get("source"), value.get("full", False)
        if not isinstance(paper_id, str) or not 0 < len(paper_id) <= 250:
            raise Invalid("Invalid paper ID")
        if not isinstance(full, bool):
            raise Invalid("Invalid full-text mode")
        paper_id = paper_id.strip()
        if paper_id.startswith("https://"):
            url = urlsplit(paper_id)
            try:
                if url.username or url.password or url.port:
                    raise Invalid("Invalid paper URL")
            except ValueError as error:
                raise Invalid("Invalid paper URL") from error
            if url.hostname in ("arxiv.org", "www.arxiv.org", "alphaxiv.org", "www.alphaxiv.org"):
                paper_id = re.sub(r"^/(?:abs|pdf|overview)/", "", url.path)
                paper_id = re.sub(r"\.pdf$", "", paper_id)
            elif url.hostname in ("doi.org", "www.biorxiv.org", "biorxiv.org"):
                paper_id = re.sub(r"^/(?:content/)?", "", url.path)
                paper_id = re.sub(r"v\d+(?:\.full(?:\.pdf)?)?$", "", paper_id)
            elif url.hostname in ("openalex.org", "pubmed.ncbi.nlm.nih.gov"):
                paper_id = url.path.strip("/")
            else:
                raise Invalid("Unsupported paper URL")
        paper_id = re.sub(r"^(?:arxiv:|doi:|pmid:)\s*", "", paper_id, flags=re.I)
        if source is None:
            source = ("pubmed" if re.fullmatch(r"\d{1,9}", paper_id) else
                      "biorxiv" if paper_id.startswith("10.1101/") else
                      "openalex" if re.match(r"^(?:W\d+|10\.\d{4,9}/)", paper_id, re.I) else "alphaxiv")
        patterns = {"alphaxiv": ARXIV, "pubmed": re.compile(r"\d{1,9}"),
                    "biorxiv": re.compile(r"10\.1101/[a-z0-9][a-z0-9._()-]*", re.I),
                    "openalex": re.compile(r"(?:W\d+|10\.\d{4,9}/[a-z0-9][a-z0-9._();:/-]*)", re.I)}
        if not isinstance(source, str) or source not in patterns:
            raise Invalid("Unsupported literature source")
        if not patterns[source].fullmatch(paper_id) or any(part in (".", "..") for part in paper_id.split("/")):
            raise Invalid("Invalid paper ID")
        return cls(source, paper_id, full)


def _text(value):
    return value if isinstance(value, str) else ""


def _clean(value):
    return html.unescape(re.sub(r"<[^>]*>", "", _text(value)))


def _link(value):
    if not isinstance(value, str):
        return None
    try:
        url = urlsplit(value)
        if url.scheme == "https" and url.hostname and not url.username and not url.password:
            return value
    except ValueError:
        pass
    return None


def deduplicate(hits):
    result, aliases = [], {}
    for hit in hits:
        keys = [f"{hit['source']}:{hit['id']}"]
        if hit.get("doi"):
            keys.append("doi:" + hit["doi"].lower())
        if hit.get("title"):
            keys.append("title:" + "".join(char for char in hit["title"].lower() if char.isalnum()))
        existing = next((aliases[key] for key in keys if key in aliases), None)
        record = existing if existing is not None else {**hit, "alternatives": []}
        if existing is None:
            result.append(record)
        elif hit["source"] == "alphaxiv" and record["source"] != "alphaxiv":
            prior = {key: record.get(key) for key in ("source", "id", "url")}
            record.update(hit)
            record["alternatives"] = [item for item in record["alternatives"] if (item["source"], item["id"]) != (hit["source"], hit["id"])]
            record["alternatives"].append(prior)
        elif (record["source"], record["id"]) != (hit["source"], hit["id"]) and not any(
                (item["source"], item["id"]) == (hit["source"], hit["id"]) for item in record["alternatives"]):
            record["alternatives"].append({key: hit.get(key) for key in ("source", "id", "url")})
        for key in keys:
            aliases[key] = record
    return result


def _abstract(work):
    index = work.get("abstract_inverted_index")
    if not isinstance(index, dict):
        return ""
    words = {}
    for word, positions in index.items():
        if isinstance(positions, list):
            for position in positions:
                if type(position) is int and 0 <= position < 20000:
                    words[position] = word
    return " ".join(words.get(position, "") for position in range(max(words, default=-1) + 1))


def _openalex(work, source):
    doi = re.sub(r"^https://doi.org/", "", _text(work.get("doi")))
    location = work.get("best_oa_location") or work.get("primary_location") or {}
    authors = []
    for authorship in work.get("authorships") or []:
        author = authorship.get("author") if isinstance(authorship, dict) else None
        name = _text(author.get("display_name")) if isinstance(author, dict) else ""
        if name:
            authors.append(name)
    hit = {"source": source, "id": doi if source == "biorxiv" and doi else _text(work.get("id")).split("/")[-1],
           "title": _text(work.get("display_name", work.get("title"))), "abstract": _abstract(work),
           "publicationDate": work.get("publication_date"), "citations": work.get("cited_by_count", 0),
           "url": _link(work.get("doi")) or _link(work.get("id")),
           "authors": authors}
    if doi:
        hit["doi"] = doi
    pdf = _link(location.get("pdf_url"))
    if pdf:
        hit["pdfUrl"] = pdf
    return hit


def _rerank(hits, priority):
    if priority in ("recency", "historical"):
        dated = [hit for hit in hits if hit.get("publicationDate")]
        dated.sort(key=lambda hit: hit["publicationDate"], reverse=priority == "recency")
        return dated + [hit for hit in hits if not hit.get("publicationDate")]
    if priority == "popular":
        return sorted(hits, key=lambda hit: hit.get("citations", 0), reverse=True)
    return hits


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


class _CitationMetadata(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.fields = {}

    def handle_starttag(self, tag, attributes):
        if tag != "meta":
            return
        attrs = dict(attributes)
        name, content = _text(attrs.get("name")), _text(attrs.get("content"))
        if name.startswith("citation_") and content and content.strip():
            self.fields.setdefault(name, []).append(content.strip())


class LiteratureClient:
    """HTTP seam: injected fetch(url, timeout=..., headers=...) returns a
    file-like response with status, headers, read and close, like urlopen.
    """
    def __init__(self, fetch=None, now=None):
        self._opener = build_opener(_NoRedirect())
        self._fetch = fetch or (lambda url, *, timeout, headers: self._opener.open(Request(url, headers=headers), timeout=timeout))
        self._now = now or (lambda: datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"))

    def _request(self, url, *, optional=False, json_body=True, timeout=15, limit=LIMIT_BYTES):
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname not in ORIGINS or parsed.username or parsed.password or parsed.port:
            raise Invalid("Unsupported literature endpoint")
        response = None
        try:
            response = self._fetch(url, timeout=timeout, headers={
                "Accept": "application/json" if json_body else "text/plain", "User-Agent": "Pero-Literature/0.1"})
            status = response.status
            if optional and status == 404:
                return None
            if not 200 <= status < 300:
                raise Invalid(f"{parsed.hostname}: HTTP {status}")
            length = response.headers.get("Content-Length")
            if length and int(length) > limit:
                raise Invalid(f"Literature response exceeds {limit:,} bytes")
            body = response.read(limit + 1)
            if len(body) > limit:
                raise Invalid(f"Literature response exceeds {limit:,} bytes")
            if parsed.hostname == "arxiv.org" and "text/html" not in response.headers.get("Content-Type", ""):
                raise Invalid("Publisher metadata did not return HTML")
            text = body.decode("utf-8")
            return json.loads(text) if json_body else text
        except HTTPError as error:
            error.close()
            if optional and error.code == 404:
                return None
            raise Invalid(f"{parsed.hostname}: HTTP {error.code}") from error
        except (URLError, OSError, UnicodeError, ValueError) as error:
            if isinstance(error, Invalid):
                raise
            raise Invalid(f"{parsed.hostname}: {error}") from error
        finally:
            if response is not None:
                response.close()

    @staticmethod
    def _endpoint(base, **parameters):
        return base + "?" + urlencode({key: value for key, value in parameters.items() if value is not None})

    def _pubmed(self, ids):
        parameters = dict(db="pubmed", id=",".join(ids))
        with ThreadPoolExecutor(max_workers=2) as pool:
            summary = pool.submit(self._request, self._endpoint("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi", **parameters, retmode="json"))
            xml = pool.submit(self._request, self._endpoint("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi", **parameters, retmode="xml"), json_body=False)
            summaries = summary.result().get("result", {})
            try:
                document = ET.fromstring(xml.result())
            except ET.ParseError as error:
                raise Invalid("Invalid PubMed XML response") from error
        abstracts = {}
        for article in document.iter("PubmedArticle"):
            paper_id = article.findtext(".//PMID")
            pieces = []
            for section in article.iter("AbstractText"):
                label = section.get("Label")
                pieces.append((label + ": " if label is not None else "") + "".join(section.itertext()))
            abstracts[paper_id] = "\n\n".join(pieces)
        result = []
        for paper_id in ids:
            work = summaries.get(paper_id)
            if not isinstance(work, dict) or work.get("error"):
                continue
            identifiers = {item.get("idtype"): item.get("value") for item in work.get("articleids", [])}
            record = {"source": "pubmed", "id": paper_id, "title": _clean(work.get("title")),
                      "abstract": abstracts.get(paper_id, ""),
                      "publicationDate": _text(work.get("sortpubdate"))[:10].replace("/", "-") or None,
                      "url": f"https://pubmed.ncbi.nlm.nih.gov/{paper_id}/",
                      "authors": [_text(author.get("name")) for author in work.get("authors", [])]}
            if identifiers.get("doi"):
                record.update(doi=identifiers["doi"], doiUrl=_link("https://doi.org/" + identifiers["doi"]))
            if identifiers.get("pmc"):
                record["fullTextUrl"] = _link(f"https://pmc.ncbi.nlm.nih.gov/articles/{identifiers['pmc']}/")
            result.append(record)
        return result

    def _search_source(self, source, query):
        if source == "alphaxiv":
            hits = self._request(self._endpoint(
                f"https://api.alphaxiv.org/search/v2/paper/discover/{query.strategy}", q=query.query,
                prioritize=query.priority, publishedAfter=query.published_after, publishedBefore=query.published_before))
            if not isinstance(hits, list):
                raise Invalid("Invalid alphaXiv response")
            result = []
            for hit in hits[:query.limit]:
                identity = PaperIdentity.parse({"id": hit.get("paperId"), "source": source})
                result.append({"source": source, "id": identity.id,
                               "title": _text(hit.get("title")), "abstract": _text(hit.get("abstract")),
                               "publicationDate": hit.get("publicationDate"), "votes": hit.get("votes", 0),
                               "snippets": hit.get("snippets", [])[:5] if isinstance(hit.get("snippets"), list) else [],
                               "url": "https://www.alphaxiv.org/abs/" + quote(identity.id, safe="/")})
            return result
        if source == "pubmed":
            terms = query.query
            if query.published_after or query.published_before:
                terms += f' AND ("{query.published_after or "1000/01/01"}"[Date - Publication] : "{query.published_before or "3000/12/31"}"[Date - Publication])'
            response = self._request(self._endpoint("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
                                                   db="pubmed", term=terms, sort="relevance", retmode="json",
                                                   retmax=query.limit if query.priority == "default" else min(query.limit * 4, 80)))
            result = response.get("esearchresult", {})
            ids = result.get("idlist")
            if result.get("ERROR") or not isinstance(ids, list) or any(not isinstance(item, str) or not re.fullmatch(r"\d{1,9}", item) for item in ids):
                raise Invalid("Invalid PubMed response")
            return _rerank(self._pubmed(ids), "default" if query.priority == "popular" else query.priority)[:query.limit] if ids else []
        filters = []
        if source == "biorxiv":
            filters.append("primary_location.source.id:S4306402567")
        if query.published_after:
            filters.append("from_publication_date:" + query.published_after)
        if query.published_before:
            filters.append("to_publication_date:" + query.published_before)
        result = self._request(self._endpoint("https://api.openalex.org/works", search=query.query,
                                             per_page=query.limit if query.priority == "default" else min(max(query.limit * 4, 50), 200),
                                             filter=",".join(filters) or None))
        if not isinstance(result.get("results"), list):
            raise Invalid("Invalid OpenAlex response")
        return _rerank([_openalex(work, source) for work in result["results"]], query.priority)[:query.limit]

    def search(self, value):
        query = SearchQuery.parse(value)
        hits, errors = [], []
        with ThreadPoolExecutor(max_workers=len(query.sources)) as pool:
            requests = [pool.submit(self._search_source, source, query) for source in query.sources]
            for source, request in zip(query.sources, requests):
                try:
                    hits.extend(request.result())
                except (Invalid, ValueError, TypeError, KeyError, AttributeError) as error:
                    errors.append({"source": source, "error": str(error)})
        return {"schema": "pero.literature-search.v1", "query": query.document(), "fetchedAt": self._now(),
                "items": deduplicate(hits), "errors": errors,
                "warnings": [{"source": error["source"], "message": error["error"]} for error in errors],
                "status": "failed" if len(errors) == len(query.sources) else "partial" if errors else "complete",
                "notice": "Public-source retrieval; content and candidates remain unverified."}

    def discover(self, query, paper):
        selector = query.selector(paper)
        work = self._request('https://api.openalex.org/works/' + quote(selector, safe=''), optional=True) if selector else None
        if work is None:
            result = self._request(self._endpoint('https://api.openalex.org/works', search=paper.title[:500], per_page=5))
            candidates = tuple(DiscoveryPaper.parse(_openalex(w, 'openalex')) for w in result['results'])
            return SeedMatches(paper.id, candidates)
        seed = DiscoveryPaper.parse(_openalex(work, 'openalex'))
        start, size = (query.page - 1) * 12, 12
        if query.relation == 'citing':
            result = self._request(self._endpoint('https://api.openalex.org/works', filter='cites:' + seed.id,
                                                  sort='publication_date:desc', page=query.page, per_page=size))
            records = result['results']
            more = query.page * size < result['meta']['count']
        else:
            key = 'related_works' if query.relation == 'related' else 'referenced_works'
            ids = work.get(key)
            if not isinstance(ids, list):
                raise Invalid('OpenAlex did not supply this relationship. Try another relation or retry later.')
            ids = list(dict.fromkeys(w.rsplit('/', 1)[-1] for w in ids if isinstance(w, str)
                                    and WORK.fullmatch(w.rsplit('/', 1)[-1]) and w.rsplit('/', 1)[-1] != seed.id))
            selected = ids[start:start + size]
            records = self._request(self._endpoint('https://api.openalex.org/works',
                filter='openalex:' + '|'.join(selected), per_page=size))['results'] if selected else []
            indexed = {w['id'].rsplit('/', 1)[-1]: w for w in records}
            records = [indexed[identity] for identity in selected if identity in indexed]
            more = start + size < len(ids)
        items = tuple(DiscoveryPaper.parse(_openalex(w, 'openalex')) for w in records)
        return DiscoveryBatch(paper.id, paper.title, query.relation, seed, items, query.page,
                              more and query.page < 100, self._now(), 'confirmed' if query.work_id else 'identifier')

    def read(self, value):
        identity = PaperIdentity.parse(value)
        source, paper_id = identity.source, identity.id
        if source == "alphaxiv":
            encoded = quote(paper_id, safe="/")
            kind = "full-text" if identity.full else "report"
            content = self._request(f"https://www.alphaxiv.org/{'abs' if identity.full else 'overview'}/{encoded}.md", optional=True, json_body=False)
            if content is None and not identity.full:
                kind = "full-text"
                content = self._request(f"https://www.alphaxiv.org/abs/{encoded}.md", optional=True, json_body=False)
            if not content or not content.strip():
                raise Invalid("No report or extracted full text is available")
            metadata = {"title": paper_id, "url": f"https://www.alphaxiv.org/abs/{encoded}",
                        "pdfUrl": f"https://arxiv.org/pdf/{encoded}", "authors": []}
            metadata_url = f"https://arxiv.org/abs/{encoded}"
            try:
                parser = _CitationMetadata()
                parser.feed(self._request(metadata_url, json_body=False, timeout=6, limit=262144))
                title = parser.fields.get("citation_title", [""])[0]
                if title and len(title) <= 1000:
                    metadata.update(title=title, metadataUrl=metadata_url,
                                    authors=[name for name in parser.fields.get("citation_author", [])[:100] if len(name) <= 300])
            except Invalid:
                pass  # Optional publisher metadata cannot erase usable source text.
        elif source == "pubmed":
            records = self._pubmed([paper_id])
            if not records:
                raise Invalid("PubMed record not found")
            metadata, kind = records[0], "abstract"
            content = metadata["abstract"]
        elif source == "biorxiv":
            data = self._request(f"https://api.biorxiv.org/details/biorxiv/{paper_id}/na/json")
            records = data.get("collection")
            if not isinstance(records, list) or not records:
                raise Invalid("bioRxiv record not found")
            work = max(records, key=lambda item: int(item.get("version", 0)))
            version = _text(work.get("version"))
            metadata = {"title": _clean(work.get("title")), "authors": [name.strip() for name in _text(work.get("authors")).split(";") if name.strip()],
                        "publicationDate": work.get("date"), "doi": paper_id, "url": f"https://doi.org/{paper_id}",
                        "fullTextUrl": f"https://www.biorxiv.org/content/{paper_id}v{version if version.isdigit() else '1'}.full"}
            content, kind = _clean(work.get("abstract")), "abstract"
        else:
            selector = paper_id if re.fullmatch(r"W\d+", paper_id, re.I) else "doi:" + paper_id
            metadata = _openalex(self._request("https://api.openalex.org/works/" + quote(selector, safe="")), source)
            content, kind = metadata["abstract"], "abstract"
        result = {"schema": "pero.literature-reading.v1", "source": source, "id": paper_id, **metadata,
                  "authors": metadata.get("authors", []), "content": content, "contentKind": kind,
                  "contentDigest": "sha256:" + hashlib.sha256(content.encode("utf-8")).hexdigest(),
                  "fetchedAt": self._now(), "verification": "unverified"}
        if identity.full and kind == "abstract":
            result["limitation"] = "This source supplies metadata and abstract only; open the original link for full text."
        return result
