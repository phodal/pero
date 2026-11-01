"""Scientific-document IO, composed with the existing immutable ResearchStore.

No model, task queue, alternate store or unrestricted URL downloader is added.
Only an explicit prepare action fetches public arXiv HTML; reads stay offline.
"""
from contextlib import closing
from dataclasses import dataclass
from hashlib import sha256
from html.parser import HTMLParser
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, build_opener

from .arxiv_html import parse_arxiv_html
from .scientific_document import (ARXIV_ID, PARSER, PINNED_ID, DocumentError,
                                  ParseLimits, ScientificDocument)


class HtmlLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attributes):
        attributes = dict(attributes)
        if tag == 'a' and attributes.get('href'):
            self.links.append(attributes['href'])


@dataclass(frozen=True)
class AcquiredHtml:
    requested_url: str
    source_url: str
    data: bytes


class ArxivHtml:
    def __init__(self, fetch=None):
        if fetch is None:
            from .literature import _NoRedirect
            fetch = build_opener(_NoRedirect()).open
        self.fetch = fetch

    def _html(self, url, limit):
        try:
            with closing(self.fetch(Request(url, headers={
                    'User-Agent': 'Pero-Paper-Agent/0.1', 'Accept': 'text/html',
                    'Accept-Encoding': 'identity'}), timeout=30)) as response:
                if response.status != 200:
                    raise DocumentError('The source did not return a complete HTML response', 'html_unavailable', 502)
                if response.geturl() != url:
                    raise DocumentError('Unexpected source redirect', 'html_unavailable', 502)
                if response.headers.get_content_type() != 'text/html':
                    raise DocumentError('The source did not return HTML', 'html_unavailable', 502)
                if response.headers.get('Content-Encoding', 'identity').lower() != 'identity':
                    raise DocumentError('Unexpected HTML content encoding', 'html_unavailable', 502)
                data = response.read(limit + 1)
        except (HTTPError, URLError, TimeoutError) as error:
            raise DocumentError('Official HTML is unavailable; keep using the original PDF',
                                'html_unavailable', 502) from error
        if len(data) > limit:
            raise DocumentError('HTML byte limit exceeded', 'document_limit', 413)
        return data

    def acquire(self, identifier):
        if not isinstance(identifier, str) or not ARXIV_ID.fullmatch(identifier):
            raise DocumentError('This saved paper has no supported arXiv identity', 'html_unavailable')
        requested = 'https://arxiv.org/abs/' + identifier
        if PINNED_ID.fullmatch(identifier):
            source = 'https://arxiv.org/html/' + identifier
            requested = source
        else:
            links = HtmlLinks()
            try:
                links.feed(self._html(requested, 1024 * 1024).decode('utf-8-sig'))
            except UnicodeDecodeError as error:
                raise DocumentError('The arXiv abstract page is not UTF-8', 'html_unavailable') from error
            candidates = set()
            for link in links.links:
                try:
                    absolute = urljoin(requested, link)
                    parsed = urlsplit(absolute)
                except ValueError:
                    continue
                target = parsed.path.removeprefix('/html/')
                if (parsed.scheme == 'https' and parsed.netloc == 'arxiv.org'
                        and parsed.path.startswith('/html/') and not parsed.query and not parsed.fragment
                        and ARXIV_ID.fullmatch(target) and PINNED_ID.fullmatch(target)
                        and re.sub(r'v\d+$', '', target) == identifier):
                    candidates.add(absolute)
            if len(candidates) != 1:
                raise DocumentError('No unambiguous versioned HTML link is available', 'html_unavailable')
            source = candidates.pop()
        return AcquiredHtml(requested, source, self._html(source, ParseLimits().max_bytes))


def arxiv_identity(paper):
    candidates = []
    if paper.source in ('arxiv', 'alphaxiv', 'huggingface') and ARXIV_ID.fullmatch(paper.source_id):
        candidates.append(paper.source_id)
    for url in (paper.url, paper.pdf_url):
        parsed = urlsplit(url or '')
        if parsed.scheme == 'https' and parsed.netloc == 'arxiv.org':
            match = re.fullmatch(r'/(?:abs|pdf|html)/(.+?)(?:\.pdf)?', parsed.path)
            if match and not parsed.query and not parsed.fragment and ARXIV_ID.fullmatch(match[1]):
                candidates.append(match[1])
    bases = {re.sub(r'v\d+$', '', value) for value in candidates}
    revision = getattr(paper, 'source_revision', None)
    if len(bases) == 1 and revision and re.fullmatch(r'v[1-9]\d*', revision):
        candidates.append(next(iter(bases)) + revision)
    pinned = {value for value in candidates if PINNED_ID.fullmatch(value)}
    if len(bases) != 1 or len(pinned) > 1:
        raise DocumentError('Saved source identity is missing or ambiguous', 'html_unavailable')
    return next(iter(pinned or bases))


class PaperDocuments:
    def __init__(self, store, source=None):
        self.store = store
        self.source = source

    def read(self, identity):
        record = self.store._read('scientific-documents', identity)
        document = ScientificDocument.from_record(record['document'])
        if sha256(record['sourceHtml'].encode('utf-8')).hexdigest() != document.source.digest:
            raise DocumentError('Stored HTML source integrity check failed')
        self.store.paper(document.paper_id)
        return document

    def latest(self, paper_id):
        self.store.paper(paper_id)
        records = [self.store._read('scientific-documents', identity)
                   for identity in self.store._list('scientific-documents')]
        records = [record for record in records if record['document']['paperId'] == paper_id]
        if not records:
            return None
        return self.read(max(records, key=lambda record: (record['fetchedAt'], record['document']['id']))['document']['id'])

    def prepare(self, paper_id, now, refresh=False):
        paper = self.store.paper(paper_id)
        if not refresh:
            previous = self.latest(paper.id)
            if previous and previous.parser == PARSER:
                return previous
        acquired = (self.source or ArxivHtml()).acquire(arxiv_identity(paper))
        document = parse_arxiv_html(acquired.data, acquired.source_url, paper.id)
        # Decode without removing a BOM: re-encoding must reproduce the exact bytes.
        record = dict(document=document.to_dict(), sourceHtml=acquired.data.decode('utf-8'),
                      requestedUrl=acquired.requested_url, fetchedAt=now)
        with self.store.lock:
            if document.id in self.store._list('scientific-documents'):
                return self.read(document.id)
            self.store._write('scientific-documents', document.id, record)
        return document
