"""Bounded HTTPS metadata transport with public-address pinning and no proxy."""
from dataclasses import dataclass
from http.client import HTTPSConnection, HTTPException
import ipaddress
import socket
import ssl
import time
from urllib.parse import urljoin, urlsplit

from .model import Invalid
from .research_resources import PublicURL

MAX_BYTES = 1024 * 1024


@dataclass(frozen=True)
class WebDocument:
    url: str
    content_type: str
    text: str


@dataclass(frozen=True)
class PdfResponse:
    url: str
    data: bytes


@dataclass(frozen=True)
class SourceResponse:
    url: str
    data: bytes
    mime: str


class PinnedHTTPS(HTTPSConnection):
    def __init__(self, host, address, timeout):
        super().__init__(host, timeout=timeout, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        sock = socket.create_connection((self.address, 443), self.timeout)
        try:
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
        except BaseException:
            sock.close()
            raise


class PublicMetadata:
    def __init__(self, resolve=socket.getaddrinfo, connection=PinnedHTTPS, clock=time.monotonic):
        self.resolve, self.connection, self.clock = resolve, connection, clock

    def fetch(self, url, *, timeout=6, limit=MAX_BYTES):
        result = self._fetch(url, timeout=timeout, limit=limit, pdf=False)
        return WebDocument(result[0], result[1], result[2].decode('utf-8', errors='replace'))

    def fetch_pdf(self, url, *, timeout=30):
        from .local_pdf import MAX_PDF_BYTES
        final, _mime, data = self._fetch(url, timeout=timeout, limit=MAX_PDF_BYTES, pdf=True)
        if not data.startswith(b'%PDF-'):
            raise Invalid('The source did not return a PDF', 415)
        return PdfResponse(final, data)

    def fetch_source(self, url, *, timeout=30):
        from .source_archive import MAX_ARCHIVE
        final, mime, data = self._fetch(url, timeout=timeout, limit=MAX_ARCHIVE, pdf=False, source=True)
        return SourceResponse(final, data, mime)

    def fetch_html(self, url, *, timeout=30, limit=8 * 1024 * 1024):
        # The caller supplies an OfficialHtml-derived, independently approved URL.
        # Keep raw bytes for source identity; do not replace invalid UTF-8.
        final, mime, data = self._fetch(url, timeout=timeout, limit=limit, pdf=False, html=True)
        return SourceResponse(final, data, mime)

    def _fetch(self, url, *, timeout, limit, pdf, source=False, html=False):
        deadline = self.clock() + timeout
        for _ in range(4):
            url = PublicURL.parse(url).value
            parts = urlsplit(url)
            try:
                addresses = tuple(dict.fromkeys(item[4][0] for item in self.resolve(parts.hostname, 443, type=socket.SOCK_STREAM)))
                if not addresses or any(not ipaddress.ip_address(address).is_global or ipaddress.ip_address(address).is_multicast for address in addresses):
                    raise Invalid('Private or non-public network addresses are refused')
                remaining = deadline - self.clock()
                if remaining <= 0:
                    raise Invalid('Metadata request timed out')
                connection = self.connection(parts.hostname, addresses[0], remaining)
                try:
                    connection.request('GET', parts.path + ('?' + parts.query if parts.query else ''), headers={
                        'User-Agent': 'Pero-Research-Import/0.1', 'Accept': 'application/pdf' if pdf else 'text/html,application/json,text/plain,application/xml',
                        'Accept-Encoding': 'identity'})
                    response = connection.getresponse()
                    if response.status in (301, 302, 303, 307, 308):
                        if html:
                            raise Invalid('Official HTML redirects are unsupported; keep using the PDF', 409)
                        location = response.getheader('Location')
                        if not location:
                            raise Invalid('Redirect did not supply a destination')
                        url = urljoin(url, location)
                        continue
                    if response.status != 200:
                        retry = response.getheader('Retry-After', '')
                        note = f'; Retry-After: {retry[:80]}' if retry else ''
                        raise Invalid(f'Source unavailable (HTTP {response.status}){note}', response.status if response.status in (401, 403, 429) else 502)
                    content_type = response.getheader('Content-Type', '').split(';', 1)[0].lower()
                    if html and content_type != 'text/html':
                        raise Invalid('The source did not return text/html', 415)
                    if pdf and content_type != 'application/pdf':
                        raise Invalid('The source did not return application/pdf', 415)
                    if source and content_type not in ('application/pdf', 'application/gzip', 'application/x-gzip', 'application/x-tar', 'application/octet-stream', 'application/x-tex', 'text/x-tex', 'text/plain'):
                        raise Invalid('Unsupported source response type; HTML is not source text', 415)
                    if not pdf and not source and not (content_type.startswith('text/') or content_type in ('application/json', 'application/xml', 'application/xhtml+xml', 'application/atom+xml')):
                        raise Invalid('Only text metadata pages are inspected; no binary assets were downloaded')
                    if response.getheader('Content-Encoding', 'identity') not in ('identity', ''):
                        raise Invalid('Compressed metadata is not accepted')
                    length = response.getheader('Content-Length')
                    if length is not None and (not length.isdigit() or int(length) > limit):
                        raise Invalid('Metadata response exceeds the byte limit')
                    chunks, size = [], 0
                    while True:
                        remaining = deadline - self.clock()
                        if remaining <= 0:
                            raise Invalid('Metadata request timed out')
                        if connection.sock:
                            connection.sock.settimeout(remaining)
                        chunk = response.read1(min(65536, limit + 1 - size))
                        if not chunk:
                            break
                        chunks.append(chunk)
                        size += len(chunk)
                        if size > limit:
                            raise Invalid('Metadata response exceeds the byte limit')
                    if length is not None and size != int(length):
                        raise Invalid('Incomplete response body')
                    return url, content_type, b''.join(chunks)
                finally:
                    connection.close()
            except (OSError, ValueError, HTTPException) as error:
                if isinstance(error, Invalid):
                    raise
                raise Invalid(f'Metadata request failed: {type(error).__name__}') from error
        raise Invalid('Too many metadata redirects')
