"""Bounded HTTPS metadata transport with public-address pinning and no proxy."""
from dataclasses import dataclass
from http.client import HTTPSConnection
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
        deadline = self.clock() + timeout
        for _ in range(4):
            url = PublicURL.parse(url).value
            parts = urlsplit(url)
            try:
                addresses = tuple(dict.fromkeys(item[4][0] for item in self.resolve(parts.hostname, 443, type=socket.SOCK_STREAM)))
                if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
                    raise Invalid('Private or non-public network addresses are refused')
                remaining = deadline - self.clock()
                if remaining <= 0:
                    raise Invalid('Metadata request timed out')
                connection = self.connection(parts.hostname, addresses[0], remaining)
                try:
                    connection.request('GET', parts.path + ('?' + parts.query if parts.query else ''), headers={
                        'User-Agent': 'Pero-Research-Import/0.1', 'Accept': 'text/html,application/json,text/plain,application/xml',
                        'Accept-Encoding': 'identity'})
                    response = connection.getresponse()
                    if response.status in (301, 302, 303, 307, 308):
                        location = response.getheader('Location')
                        if not location:
                            raise Invalid('Redirect did not supply a destination')
                        url = urljoin(url, location)
                        continue
                    if response.status != 200:
                        raise Invalid(f'Metadata unavailable (HTTP {response.status})')
                    content_type = response.getheader('Content-Type', '').split(';', 1)[0].lower()
                    if not (content_type.startswith('text/') or content_type in ('application/json', 'application/xml', 'application/xhtml+xml', 'application/atom+xml')):
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
                    return WebDocument(url, content_type, b''.join(chunks).decode('utf-8', errors='replace'))
                finally:
                    connection.close()
            except (OSError, ValueError) as error:
                if isinstance(error, Invalid):
                    raise
                raise Invalid(f'Metadata request failed: {type(error).__name__}') from error
        raise Invalid('Too many metadata redirects')
