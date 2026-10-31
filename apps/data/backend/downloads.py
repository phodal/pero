"""One explicit, cancellable download. Only fixed HTTPS source URLs are accepted."""
from dataclasses import asdict, dataclass, replace
import hashlib
import json
import threading
import time
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import uuid
from typing import Literal

from sources import SOURCES


def require_url(url, hosts):
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or parsed.hostname not in hosts or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError('Source redirected outside its trusted HTTPS hosts')


def open_source(source):
    class Redirects(HTTPRedirectHandler):
        def redirect_request(self, request, fp, code, message, headers, url):
            require_url(url, source.hosts)
            return super().redirect_request(request, fp, code, message, headers, url)
    require_url(source.url, source.hosts)
    response = build_opener(Redirects()).open(Request(source.url, headers={'User-Agent': 'Pero-Data/0.1'}), timeout=20)
    if response.status != 200:
        response.close()
        raise ValueError('Source did not return a complete file')
    return response


DownloadStatus = Literal['running', 'completed', 'cancelled', 'failed', 'interrupted']


@dataclass(frozen=True)
class DownloadJob:
    id: str
    sourceId: str
    status: DownloadStatus
    received: int
    total: int
    error: str = ''

    def __post_init__(self):
        if self.status not in ('running', 'completed', 'cancelled', 'failed', 'interrupted'):
            raise ValueError('Invalid download status')
        if type(self.received) is not int or type(self.total) is not int or not 0 <= self.received <= self.total:
            raise ValueError('Invalid download byte counts')
        if self.status == 'completed' and self.received != self.total:
            raise ValueError('Completed download must contain all bytes')

    def progress(self, received):
        if self.status != 'running' or received < self.received:
            raise ValueError('Only active downloads can advance')
        return replace(self, received=received)

    def finish(self, status: DownloadStatus, error=''):
        if self.status != 'running' or status == 'running':
            raise ValueError('Only active downloads can finish')
        return replace(self, status=status, error=error)

    def to_dict(self):
        return asdict(self)


class Downloads:
    def __init__(self, catalog, sources=SOURCES, opener=open_source):
        self.catalog, self.sources, self.opener = catalog, sources, opener
        self.cancelled = threading.Event()
        self.thread = None
        path = catalog.directory / 'download.json'
        self.job = DownloadJob(**json.loads(path.read_text(encoding='utf-8'))) if path.exists() else None
        if self.job and self.job.status == 'running':
            self.job = self.job.finish('interrupted', 'Download interrupted. Start again to retry.')
            catalog.atomic('download.json', self.job.to_dict())
        for part in catalog.directory.glob('*.part'):
            part.unlink()

    def state(self):
        with self.catalog.lock:
            return dict(assets=self.catalog.listing(), sources=[s.public() for s in self.sources],
                        download=self.job.to_dict() if self.job else None)

    def start(self, identity):
        source = next((source for source in self.sources if source.id == identity), None)
        if source is None:
            raise ValueError('Unknown source')
        with self.catalog.lock:
            if self.thread and self.thread.is_alive():
                raise ValueError('A download is already running')
            self.cancelled.clear()
            job = DownloadJob(id=uuid.uuid4().hex, sourceId=source.id, status='running',
                       received=0, total=source.size, error='')
            self.catalog.atomic('download.json', job.to_dict())
            self.job = job
            self.thread = threading.Thread(target=self.run, args=(source,), daemon=True)
            try:
                self.thread.start()
            except RuntimeError as error:
                self.thread = None
                self.job = self.job.finish('failed', 'Download worker could not start. Retry manually.')
                self.catalog.atomic('download.json', self.job.to_dict())
                raise ValueError(self.job.error) from error

    def cancel(self):
        with self.catalog.lock:
            if self.job and self.job.status == 'running':
                self.cancelled.set()

    def run(self, source):
        part = self.catalog.directory / (self.job.id + '.part')
        hashes = {checksum.algorithm: hashlib.new(checksum.algorithm) for checksum in source.checksums}
        received, started = 0, time.monotonic()
        try:
            with self.opener(source) as response, part.open('wb') as output:
                while True:
                    if self.cancelled.is_set():
                        raise InterruptedError('Download cancelled')
                    if time.monotonic() - started > 3600:
                        raise ValueError('Download exceeded one hour; retry manually')
                    chunk = response.read(256 * 1024)
                    if not chunk:
                        break
                    received += len(chunk)
                    if received > source.size:
                        raise ValueError('Downloaded file exceeds the pinned size')
                    output.write(chunk)
                    for digest in hashes.values():
                        digest.update(chunk)
                    with self.catalog.lock:
                        self.job = self.job.progress(received)
            if received != source.size:
                raise ValueError('Downloaded size does not match the source')
            if any(hashes[c.algorithm].hexdigest() != c.value for c in source.checksums):
                raise ValueError('Downloaded checksum does not match the source')
            with self.catalog.lock:
                if self.cancelled.is_set():
                    raise InterruptedError('Download cancelled')
                self.catalog.publish(part, source.filename, source.kind, source.sourceUrl,
                                     source.revision, source.license, [asdict(c) for c in source.checksums])
                self.job = self.job.finish('completed')
        except InterruptedError:
            with self.catalog.lock:
                self.job = self.job.finish('cancelled')
        except Exception as error:
            # Transport failures are terminal; never publish partial or unverified files.
            with self.catalog.lock:
                message = str(error) if isinstance(error, ValueError) else type(error).__name__
                self.job = self.job.finish('failed', f'Download failed: {message}. Retry manually.')
        finally:
            part.unlink(missing_ok=True)
            with self.catalog.lock:
                self.catalog.atomic('download.json', self.job.to_dict())

    def close(self):
        self.cancel()
        if self.thread:
            self.thread.join(timeout=21)
