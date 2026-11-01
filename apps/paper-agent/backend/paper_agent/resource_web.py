"""Bounded public HTTPS reads for research discovery; no cookies or execution."""
from dataclasses import dataclass
from html.parser import HTMLParser
import http.client
import ipaddress
import json
import re
import socket
import ssl
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

MAX_BYTES = 2 * 1024 * 1024
MAX_LINKS = 128
MAX_TEXT = 60000


def public_url(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 4096 or re.search(r'[\s\\\x00-\x1f\x7f]', value):
        raise ValueError('Enter a public HTTPS URL without credentials')
    parsed = urlsplit(value)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or parsed.port not in (None, 443)):
        raise ValueError('Only public HTTPS URLs on port 443 are supported')
    host = parsed.hostname.rstrip('.').encode('idna').decode('ascii').lower()
    if host == 'localhost' or host.endswith(('.localhost', '.local', '.internal')) or '.' not in host:
        raise ValueError('Private network URLs are not allowed')
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address is not None and (not address.is_global or address.is_multicast):
        raise ValueError('Private network URLs are not allowed')
    authority = '[' + host + ']' if ':' in host else host
    return urlunsplit(('https', authority, parsed.path or '/', parsed.query, ''))


def canonical_url(value):
    parsed = urlsplit(public_url(value))
    query = [(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True)
             if not key.lower().startswith('utm_') and key.lower() not in ('fbclid', 'gclid')]
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), ''))


class _PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, host, address, timeout):
        super().__init__(host, timeout=timeout, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        # Connect to the already checked address, while verifying TLS for the host.
        # A second DNS lookup here would reintroduce DNS-rebinding SSRF.
        sock = socket.create_connection((self.address, 443), self.timeout)
        try:
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
        except BaseException:
            sock.close()
            raise


@dataclass(frozen=True)
class WebDocument:
    url: str
    mime: str
    body: bytes

    def text(self):
        return self.body.decode('utf-8', errors='replace')

    def json(self):
        if self.mime not in ('application/json', 'application/vnd.github+json'):
            raise ValueError('The metadata endpoint did not return JSON')
        value = json.loads(self.body)
        if not isinstance(value, dict):
            raise ValueError('Expected a metadata object')
        return value


class PublicWeb:
    def __init__(self, resolver=socket.getaddrinfo, connection=_PinnedHTTPS):
        self.resolver, self.connection = resolver, connection

    def read(self, url):
        for _ in range(4):
            url = public_url(url)
            parsed = urlsplit(url)
            try:
                addresses = {item[4][0] for item in self.resolver(parsed.hostname, 443, type=socket.SOCK_STREAM)}
            except OSError as error:
                raise ValueError('Cannot resolve public source') from error
            if not addresses or any(not ipaddress.ip_address(ip).is_global or ipaddress.ip_address(ip).is_multicast for ip in addresses):
                raise ValueError('The URL resolves to a private or unsupported network')
            connection = self.connection(parsed.hostname, sorted(addresses)[0], 12)
            try:
                connection.request('GET', urlunsplit(('', '', parsed.path or '/', parsed.query, '')),
                                   headers={'User-Agent': 'Pero-Research-Import/1.0', 'Accept-Encoding': 'identity',
                                            'Accept': 'text/html, text/plain, application/json'})
                response = connection.getresponse()
                if response.status in (301, 302, 303, 307, 308):
                    location = response.getheader('Location')
                    if not location:
                        raise ValueError('Redirect is missing a destination')
                    url = public_url(urljoin(url, location))
                    continue
                if response.status != 200:
                    raise ValueError(f'Source returned HTTP {response.status}')
                if response.getheader('Content-Encoding', 'identity').lower() not in ('', 'identity'):
                    raise ValueError('Compressed source responses are not supported')
                mime = response.getheader('Content-Type', '').split(';')[0].strip().lower()
                if mime not in ('text/html', 'application/xhtml+xml', 'text/plain', 'text/markdown', 'application/json', 'application/vnd.github+json'):
                    raise ValueError('Use a paper landing page, not a binary download')
                length = response.getheader('Content-Length')
                if length is not None and (not length.isdigit() or int(length) > MAX_BYTES):
                    raise ValueError('Source exceeds the 2 MiB discovery limit')
                body = response.read(MAX_BYTES + 1)
                if len(body) > MAX_BYTES:
                    raise ValueError('Source exceeds the 2 MiB discovery limit')
                return WebDocument(url, mime, body)
            except (OSError, http.client.HTTPException) as error:
                raise ValueError('Cannot retrieve public source: ' + str(error)[:200]) from error
            finally:
                connection.close()
        raise ValueError('Source exceeds the three-redirect limit')


@dataclass(frozen=True)
class PageLink:
    url: str
    label: str


class ResearchHTML(HTMLParser):
    """Extract text and explicit links; external text is never instructions."""
    def __init__(self, base):
        super().__init__(convert_charrefs=True)
        self.base, self.metadata, self.links, self.parts = base, {}, [], []
        self.suppressed = []
        self.anchor = None
        self.title = []
        self.in_title = False
        self.truncated = False
        self.characters = 0

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if self.suppressed:
            if tag == self.suppressed[-1]:
                self.suppressed.append(tag)
            return
        if tag in ('script', 'style', 'nav', 'footer', 'noscript', 'template'):
            self.suppressed.append(tag)
            return
        if tag == 'title':
            self.in_title = True
        if tag == 'meta':
            key = (attrs.get('name') or attrs.get('property') or '').lower()
            content = attrs.get('content', '')
            if key and isinstance(content, str):
                self.metadata.setdefault(key, content[:4000])
        if tag == 'a':
            href = attrs.get('href')
            if href:
                try:
                    self.anchor = [public_url(urljoin(self.base, href)), []]
                except ValueError:
                    self.anchor = None
        if tag in ('p', 'div', 'br', 'h1', 'h2', 'h3', 'li'):
            self._text('\n')

    def handle_startendtag(self, tag, attributes):
        self.handle_starttag(tag, attributes)
        self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.suppressed:
            if tag == self.suppressed[-1]:
                self.suppressed.pop()
            return
        if tag == 'title':
            self.in_title = False
        if tag == 'a' and self.anchor:
            if len(self.links) < MAX_LINKS:
                self.links.append(PageLink(self.anchor[0], ''.join(self.anchor[1]).strip()[:300]))
            else:
                self.truncated = True
            self.anchor = None

    def _text(self, text):
        remaining = MAX_TEXT - self.characters
        if len(text) > remaining:
            self.truncated = True
        if remaining > 0:
            self.parts.append(text[:remaining])
            self.characters += min(remaining, len(text))

    def handle_data(self, text):
        if self.suppressed:
            return
        if self.in_title:
            self.title.append(text[:1000])
        if self.anchor and sum(map(len, self.anchor[1])) < 300:
            self.anchor[1].append(text[:300])
        self._text(text)

    def content(self):
        return '\n'.join(line.strip() for line in ''.join(self.parts).splitlines() if line.strip())

    def heading(self):
        return (self.metadata.get('citation_title') or self.metadata.get('og:title')
                or ''.join(self.title).strip() or self.base)[:1000]
