"""Killable PDF acquisition, publishing only complete original bytes to Paper."""
from dataclasses import replace
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import threading

from .acquisition_worker import acquire_bounded
from .local_pdf import LocalPdf
from .model import Invalid, canonical, digest
from .pdf import PdfPage
from .pdf_download import PdfDownload, PdfDownloadCommand, PdfReceipt
from .pdf_files import PdfFiles
from .resource_fetch import PublicMetadata

DOWNLOAD_SECONDS = 45


def acquire_pdf(output, directory, url, transport):
    response = transport.fetch_pdf(url)
    fetched_at = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    output.send(('stage', 'parsing'))
    pages = PdfFiles().pages(response.data)
    root = Path(directory)
    (root / 'original.pdf').write_bytes(response.data)
    (root / 'pages.json').write_bytes(canonical([page.to_dict() for page in pages]))
    output.send(('complete', response.url, fetched_at))


class PdfDownloads:
    def __init__(self, store, transport=None, seconds=DOWNLOAD_SECONDS):
        self.store, self.transport, self.seconds = store, transport or PublicMetadata(), seconds
        self.running = {}
        for identity in store._list('pdf-downloads'):
            job = self._read(identity)
            if job.status == 'running':
                self._save(job.finish('interrupted', 'Download interrupted by restart. Retry this file.'))

    def _read(self, identity):
        return PdfDownload.from_record(self.store._read('pdf-downloads', identity))

    def _save(self, job):
        self.store.imports._replace('pdf-downloads', job.id, job.to_dict())

    def request(self, value):
        command = PdfDownloadCommand.parse(value)
        with self.store.lock:
            resource = self.store.imports.approved_pdf(command.bundle_id, command.resource_id)
            empty = PdfDownload.create(command.bundle_id, command.resource_id)
            job = self._read(empty.id) if empty.id in self.store._list('pdf-downloads') else empty
            if command.operation == 'cancel' and job.status == 'running':
                self.running[job.id][0].set()
                # Terminal cancellation is written only after the child exits.
            if command.operation == 'start' and job.status != 'running' and (job.status != 'completed' or not self.available(job)):
                sources = getattr(self.store, 'source_downloads', None)
                if any(thread.is_alive() for _, thread in (*self.running.values(), *(sources.running.values() if sources else ()))):
                    raise Invalid('Another PDF is being acquired. Wait or cancel it first.', 409)
                job = replace(job, status='running', stage='downloading', error='') if job.receipt else job.start()
                self._save(job)
                cancelled = threading.Event()
                thread = threading.Thread(target=self._acquire, args=(job, resource, cancelled), daemon=True)
                self.running[job.id] = (cancelled, thread)
                thread.start()
            return self.view(job)

    def available(self, job):
        return bool(job.receipt and self.store.pdf_available(job.receipt.fileDigest, job.receipt.size))

    def view(self, job):
        local_available = self.available(job)
        if job.status == 'completed' and not local_available:
            job = replace(job, status='unavailable', stage='unavailable',
                          error='The original PDF file is missing or failed integrity checks. Restore verifies the original SHA-256; changed source bytes cannot replace this version.')
        read_pages = set()
        if job.receipt:
            for identity in self.store._list('studies'):
                study = self.store.study(identity)
                for step in study.steps:
                    for passage in step.passages:
                        if passage.document_id == job.receipt.documentId:
                            read_pages.add(passage.page)
        return dict(**job.to_dict(), readPages=sorted(read_pages), localAvailable=local_available)

    def _acquire(self, job, resource, cancelled):
        def stage(value):
            nonlocal job
            with self.store.lock:
                job = replace(job, stage=value)
                self._save(job)
        try:
            with tempfile.TemporaryDirectory(prefix='pero-paper-pdf-') as directory:
                result = acquire_bounded(acquire_pdf, (directory, resource.originalUrl, self.transport), cancelled, self.seconds, stage)
                with self.store.lock:
                    if cancelled.is_set():
                        job = job.finish('cancelled', 'PDF download cancelled.')
                    elif result[0] == 'complete':
                        data = (Path(directory) / 'original.pdf').read_bytes()
                        upload = LocalPdf.parse(data, url_filename(resource.originalUrl))
                        if job.receipt and upload.file_digest != job.receipt.fileDigest:
                            raise Invalid('The source bytes changed. The original version and receipt are preserved; restore requires the original SHA-256.', 409)
                        pages = tuple(PdfPage(**page) for page in json.loads((Path(directory) / 'pages.json').read_bytes()))
                        paper, document = PdfFiles.from_pages(upload, pages, result[2])
                        paper = self.store.import_prepared_pdf(paper, document, data)
                        document = self.store.pdf(digest(dict(paperId=paper.id, fileDigest=upload.file_digest)))
                        receipt = PdfReceipt(resource.evidence[0].url if resource.evidence else '', resource.originalUrl,
                            result[1], result[2], document.file_digest, len(data), len(document.pages), document.id,
                            paper.id, 'sha256:' + document.file_digest,
                            sum(bool(p.text.strip()) for p in document.pages), sum(len(p.text) for p in document.pages),
                            ('This PDF has no selectable text. OCR is not available; use the PDF view.',)
                            if not any(p.text.strip() for p in document.pages) else
                            ('Some pages have little or no extracted text; verify page images. No OCR or structured table extraction was performed.',)
                            if any(len(p.text.strip()) < 40 for p in document.pages) else ())
                        if job.receipt:
                            job = replace(job, restoredAt=result[2], restoreFinalUrl=result[1])
                            receipt = job.receipt
                        job = job.finish('completed', receipt=receipt)
                    else:
                        job = job.finish('failed' if result[0] == 'denied' else result[0], result[1])
        except Exception as error:
            with self.store.lock:
                detail = error.detail if isinstance(error, Invalid) else f'PDF acquisition failed ({type(error).__name__}). Retry this file.'
                # A prepared result is not terminal until cleanup and settlement succeed.
                job = replace(job, status='running').finish('cancelled' if cancelled.is_set() else 'failed', detail)
        finally:
            with self.store.lock:
                # Terminal visibility and admission settle together, after staging cleanup.
                # A failed write leaves the persisted running record for restart recovery.
                try:
                    self._save(job)
                finally:
                    self.running.pop(job.id, None)

    def close(self):
        with self.store.lock:
            workers = list(self.running.values())
            for cancelled, _ in workers:
                cancelled.set()
        for _, thread in workers:
            thread.join(timeout=3)


def url_filename(url):
    from urllib.parse import urlsplit
    return urlsplit(url).path.rsplit('/', 1)[-1] or 'downloaded.pdf'
