"""Copies a saved paper's PDF and TeX source into ~/.pero/paper."""
from dataclasses import dataclass
from pathlib import Path
import os
import re
import tempfile

from .model import Invalid, digest
from .pdf import PdfDocument
from .research_resources import ArxivPaper, ImportDraft, PublicURL, ResearchResource


def paper_directory(root=None, *, create=True):
    if root is None:
        configured = os.environ.get('PERO_PAPER_DIR', '').strip()
        if configured:
            path = Path(configured).expanduser()
        else:
            home = Path(os.environ.get('PERO_HOME', str(Path.home() / '.pero'))).expanduser()
            path = home / 'paper'
    else:
        path = Path(root)
    if path.is_symlink():
        raise Invalid('Paper directory must not be a symbolic link', 409)
    if create:
        path.mkdir(parents=True, exist_ok=True)
    return path


def file_stem(paper):
    try:
        identifier = ArxivPaper.from_snapshot(paper).identifier
    except Invalid:
        identifier = None
    if identifier:
        raw = identifier
    else:
        title = re.sub(r'[^A-Za-z0-9._-]+', '-', paper.title).strip('.-')[:40]
        raw = f'{title}-{paper.id[:8]}' if title else paper.id[:8]
    cleaned = re.sub(r'[^A-Za-z0-9._-]+', '-', raw).strip('.-')[:80]
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,80}', cleaned):
        raise Invalid('Invalid paper file name')
    return cleaned


def write_copy(directory, name, data):
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,120}', name):
        raise Invalid('Invalid paper file name')
    target = directory / name
    if target.is_symlink():
        raise Invalid('Paper file must not be a symbolic link', 409)
    # The user directory is an export destination, never a mutable source ledger.
    if target.exists():
        if target.read_bytes() == data:
            return target
        suffixes = ''.join(Path(name).suffixes)
        stem = name[:-len(suffixes)] if suffixes else name
        target = directory / (stem + '-' + digest(data)[:16] + suffixes)
        if target.is_symlink():
            raise Invalid('Paper file must not be a symbolic link', 409)
        if target.exists():
            if target.read_bytes() != data:
                raise Invalid('Export copy conflicts with existing bytes', 409)
            return target
    descriptor, temporary = tempfile.mkstemp(dir=directory)
    try:
        with os.fdopen(descriptor, 'wb') as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        # Publish complete bytes without replacing a concurrently created copy.
        try:
            os.link(temporary, target)
        except FileExistsError:
            if target.is_symlink() or target.read_bytes() != data:
                raise Invalid('Export destination changed; retry explicitly', 409)
    finally:
        os.unlink(temporary)
    return target


def pinned_pdf(url):
    """Only a saved explicit representation establishes a cached PDF version."""
    try:
        resource = ResearchResource.linked(url, url)
    except (Invalid, TypeError, ValueError):
        return None
    return resource if resource.kind == 'pdf_candidate' and resource.workIdentity and resource.revision else None


def selected_pdf(original_url, resource):
    """An explicit representation, or the inspected fixed version of this URL."""
    original = ResearchResource.linked(original_url, original_url)
    fixed = pinned_pdf(original_url)
    if fixed:
        return (resource.workIdentity, resource.revision) == (fixed.workIdentity, fixed.revision)
    from .arxiv_versions import unpinned_work
    work = unpinned_work(original)
    if work and resource.workIdentity and resource.revision:
        return resource.workIdentity == 'arxiv:' + work
    return resource.originalUrl == original.originalUrl


def receipt_version(url, representation):
    from urllib.parse import urlsplit
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or parsed.netloc not in ('arxiv.org', 'www.arxiv.org', 'export.arxiv.org') or parsed.query or parsed.fragment:
        return None
    endpoints = ('pdf',) if representation == 'pdf' else ('src', 'e-print')
    for endpoint in endpoints:
        prefix = '/' + endpoint + '/'
        if parsed.path.startswith(prefix):
            identifier = parsed.path[len(prefix):].removesuffix('.pdf') if representation == 'pdf' else parsed.path[len(prefix):]
            return pinned_pdf('https://arxiv.org/pdf/' + identifier)
    return None


def check_receipt_version(receipt, resource, representation):
    for url in (receipt.requestUrl, receipt.finalUrl):
        fixed = receipt_version(url, representation)
        if not fixed or (fixed.workIdentity, fixed.revision) != (resource.workIdentity, resource.revision):
            raise Invalid('Acquisition URL does not prove the selected fixed version; originals remain preserved', 409)


@dataclass(frozen=True)
class LibraryFileReview:
    paper_id: str
    document_id: str | None
    seed_url: str | None
    draft_digest: str | None
    pdf_resource_id: str | None
    source_resource_id: str | None

    @property
    def id(self):
        from dataclasses import asdict
        return digest(asdict(self))


class LibraryFiles:
    """Library presentation over existing imports/downloads, not a job owner.

    A review hash detects a changed draft/PDF, not a human identity. The actual
    selected-file grant is written only by ResearchImports.commit. Downloads,
    receipts and observations retain their existing owners.
    """
    def __init__(self, store, root=None):
        self.store, self.root = store, root

    def cached_version(self, document):
        """A URL label alone is not persisted acquisition proof for old PDFs."""
        fixed = pinned_pdf(document.source_url)
        if fixed is None:
            return None
        for identity in self.store._list('pdf-downloads'):
            try:
                job = self.store.pdf_downloads._read(identity)
                receipt = job.receipt
                if not receipt or receipt.fileDigest != document.file_digest or not self.store.pdf_downloads.available(job):
                    continue
                acquired = self.store.pdf(receipt.documentId)
                if acquired.file_digest != document.file_digest or acquired.paper_id != receipt.paperId:
                    continue
                check_receipt_version(receipt, fixed, 'pdf')
                return fixed
            except (Invalid, OSError):
                continue
        return None

    def _context(self, paper):
        document = self.store.paper_pdf(paper.id)
        if document:
            pinned = self.cached_version(document)
            metadata = pinned_pdf(paper.pdf_url)
            conflict = pinned and metadata and (pinned.workIdentity, pinned.revision) != (metadata.workIdentity, metadata.revision)
            return document, None if conflict or not pinned else PublicURL.parse(document.source_url).value
        candidate = paper.pdf_url or ArxivPaper.from_snapshot(paper).pdf_url
        resource = ResearchResource.linked(candidate, candidate)
        if resource.kind != 'pdf_candidate':
            raise Invalid('This paper has no supported PDF candidate')
        return None, resource.originalUrl

    def original_pdf(self, document):
        """Missing bytes do not turn a historical document into a new download."""
        recovery = (' Use Restore PDF in the original research resource, if available. '
                    'Library Save will not replace this saved version.')
        try:
            content = self.store.pdf_bytes(document)
        except OSError as error:
            raise Invalid('Saved PDF original is missing or unreadable.' + recovery, 409) from error
        if digest(content) != document.file_digest:
            raise Invalid('Saved PDF original failed integrity checks.' + recovery, 409)
        return content

    def reading_pdf(self, paper):
        """Reading reuses a saved original; acquisition belongs to PdfDownloads."""
        document = self.store.paper_pdf(paper.id)
        if document is None:
            raise Invalid('Save this paper PDF through the source review before full-text reading.', 409)
        self.original_pdf(document)
        return document

    def prepare(self, paper, value, now):
        document, seed = self._context(paper)
        original = self.original_pdf(document) if document else None
        draft = None
        if seed:
            if value.get('draftId'):
                draft = self.store.imports.draft(value['draftId'])
                if draft.seedUrl != seed:
                    raise Invalid('Review belongs to another source; prepare again', 409)
            else:
                draft = self.store.imports.inspect(dict(url=seed), now)
            if draft.status != 'ready':
                return dict(status=draft.status, draftId=draft.id, paperId=paper.id,
                            documentId=document.id if document else None, warnings=list(draft.warnings), error=draft.error)
        pdf, source = None, None
        if draft:
            # Inspecting a direct PDF offers only its fixed representations. Do
            # not select unrelated links discovered by a future adapter.
            candidates = [r for r in draft.resources if r.kind == 'pdf_candidate']
            candidates = [r for r in candidates if selected_pdf(seed, r)]
            if len(candidates) == 1:
                pdf = candidates[0]
                if pdf.workIdentity and pdf.revision:
                    matches = [r for r in draft.resources if r.kind == 'source_archive'
                               and (r.workIdentity, r.revision) == (pdf.workIdentity, pdf.revision)]
                    source = matches[0] if len(matches) == 1 else None
        if not document and pdf is None:
            raise Invalid('Inspection did not establish one PDF candidate; retry or use Research URL', 409)
        review = LibraryFileReview(paper.id, document.id if document else None, seed,
                                  digest(draft.to_dict()) if draft else None,
                                  pdf.id if pdf else None, source.id if source else None)
        # The full import review also discusses datasets/models. Only the exact
        # file candidates' uncertainties belong in this compact Library review.
        warnings = list(dict.fromkeys(message for resource in (pdf, source) if resource
                                      for message in resource.unresolved))
        reason = '' if source else 'The PDF version is unknown, conflicting, or lacks a saved acquisition receipt; TeX cannot be paired. PDF copies remain available.'
        if not source:
            if document and pinned_pdf(document.source_url) and self.cached_version(document) is None:
                reason = 'The saved PDF has no matching fixed-version acquisition receipt; its PDF copy remains available, but TeX pairing is unverified.'
            warnings.append(reason)
        return dict(status='ready', draftId=draft.id if draft else None, reviewId=review.id,
                    paperId=paper.id, documentId=review.document_id,
                    version=pdf.revision if pdf else None,
                    pdf=dict(available=True, cached=document is not None, resourceId=pdf.id if pdf else None,
                             url=document.source_url if document else pdf.originalUrl, license=None,
                             size=len(original) if original is not None else None),
                    tex=dict(available=source is not None, resourceId=source.id if source else None,
                             url=source.originalUrl if source else None, license=None, size=None, reason=reason), warnings=warnings)

    def confirm(self, paper, value, now):
        if value.get('confirmedDownloads') is not True or value.get('pdf') is not True or type(value.get('tex')) is not bool:
            raise Invalid('Explicitly confirm PDF and optional TeX before saving')
        review = self.prepare(paper, dict(draftId=value.get('draftId')), now)
        if review.get('status') != 'ready' or value.get('reviewId') != review['reviewId']:
            raise Invalid('The source review changed; review again before downloading', 409)
        if value['tex'] and not review['tex']['available']:
            raise Invalid('No same-version TeX candidate is available', 409)
        pdf_id = review['pdf']['resourceId'] if not review['pdf']['cached'] else None
        source_id = review['tex']['resourceId'] if value['tex'] else None
        selected = [i for i in (pdf_id, source_id) if i]
        bundle = None
        if selected:
            bundle = self.store.imports.commit(dict(draftId=review['draftId'], resourceIds=selected,
                pdfIds=[pdf_id] if pdf_id else [], sourceIds=[source_id] if source_id else [],
                confirmedDownloads=True), now)
        return dict(paperId=paper.id, documentId=review['documentId'], bundleId=bundle.id if bundle else None,
                    bundle=bundle.to_dict() if bundle else None, pdfResourceId=pdf_id, sourceResourceId=source_id)

    def bundle_matches_source(self, bundle, *urls):
        """Use existing exact identities, including an actually inspected pin.

        Bundle reuse preserves its earliest seedUrl, which need not be the URL
        of a later equivalent Library review. This lookup performs no inspection
        or network I/O and does not infer URL variants or version equivalence.
        """
        from .arxiv_versions import unpinned_work
        for url in urls:
            if not url:
                continue
            original = ResearchResource.linked(url, url)
            identities = {original.identity, *original.aliases}
            if unpinned_work(original):
                draft_id = ImportDraft.create(original.originalUrl, '').id
                if draft_id in self.store._list('import-drafts'):
                    draft = self.store.imports.draft(draft_id)
                    if draft.status == 'ready' and draft.seedUrl == original.originalUrl:
                        identities.update(identity for resource in draft.resources
                            if resource.kind == 'pdf_candidate' and selected_pdf(original.originalUrl, resource)
                            for identity in (resource.identity, *resource.aliases))
            if identities.intersection(bundle.identities):
                return True
        return False

    def export(self, paper, value, now):
        document, seed = self._context(paper)
        requested_document = value.get('documentId')
        pdf_id, source_id, bundle_id = (value.get(key) for key in ('pdfResourceId', 'sourceResourceId', 'bundleId'))
        if requested_document:
            if document is None or document.id != requested_document:
                raise Invalid('Saved PDF changed; review again', 409)
        elif document and not pdf_id:
            raise Invalid('Select the saved PDF from a current review', 409)
        if pdf_id or source_id:
            bundle = self.store.imports.bundle(bundle_id)
            if not self.bundle_matches_source(bundle, seed, paper.pdf_url):
                raise Invalid('Bundle does not belong to this saved paper source', 409)
        if pdf_id:
            resource = self.store.imports.approved_pdf(bundle_id, pdf_id)
            if not selected_pdf(paper.pdf_url or ArxivPaper.from_snapshot(paper).pdf_url, resource):
                raise Invalid('Selected PDF differs from the Library paper source/version', 409)
            job = self.store.pdf_downloads.request(dict(operation='status', bundleId=bundle_id, resourceId=pdf_id))
            receipt = job.get('receipt')
            if job['status'] != 'completed' or not receipt or not job['localAvailable']:
                raise Invalid('The selected PDF has not completed acquisition', 409)
            if receipt['requestUrl'] != resource.originalUrl:
                raise Invalid('PDF receipt does not match the selected source', 409)
            if resource.workIdentity:
                from .pdf_download import PdfReceipt
                check_receipt_version(PdfReceipt(**{**receipt, 'extractionWarnings': tuple(receipt.get('extractionWarnings', ()))}), resource, 'pdf')
            acquired = self.store.pdf(receipt['documentId'])
            if document and document.file_digest != acquired.file_digest:
                raise Invalid('Another PDF is already saved; the original reading version is unchanged', 409)
            if document is None:
                # An explicit same-byte association; do not rewrite the download
                # receipt, original metadata paper, annotations or study inputs.
                with self.store.lock:
                    document = self.store.paper_pdf(paper.id)
                    if document and document.file_digest != acquired.file_digest:
                        raise Invalid('Saved PDF changed during export', 409)
                    if document is None:
                        document = self.store.save_pdf(PdfDocument.create(paper.id, acquired.file_digest,
                            receipt['requestUrl'], acquired.pages, receipt['fetchedAt']), self.store.pdf_bytes(acquired))
        if document is None:
            raise Invalid('Save an approved PDF before exporting copies', 409)
        content = self.original_pdf(document)
        directory = paper_directory(self.root)
        saved = dict(pdf=str(write_copy(directory, file_stem(paper) + '.pdf', content)))
        if source_id:
            fixed = self.cached_version(document)
            resource, job = self.store.source_downloads.job(bundle_id, source_id)
            if not fixed or (fixed.workIdentity, fixed.revision) != (resource.workIdentity, resource.revision):
                raise Invalid('TeX does not match the saved PDF version', 409)
            if not job.receipt or not self.store.source_downloads.available(job):
                saved['texNote'] = job.error or 'TeX acquisition is not complete; the PDF copy is saved.'
                return saved
            receipt = job.receipt
            check_receipt_version(receipt, resource, 'source')
            if (receipt.workIdentity, receipt.revision) != (fixed.workIdentity, fixed.revision):
                raise Invalid('TeX receipt version does not match the PDF', 409)
            if not receipt.texCount:
                saved['texNote'] = 'no-tex'
            else:
                data = (self.store.root / 'source-files' / (receipt.archiveDigest + '.bin')).read_bytes()
                suffix = '-src.' + {'tar.gz': 'tar.gz', 'tar': 'tar', 'gzip-tex': 'tex.gz', 'plain-tex': 'tex'}.get(receipt.format, 'bin')
                saved['tex'] = str(write_copy(directory, file_stem(paper) + suffix, data))
        return saved

    def command(self, paper, value, now):
        if not isinstance(value, dict):
            raise Invalid('Choose prepare, confirm or export for Library files')
        operation = value.get('operation')
        allowed = {'prepare': {'operation', 'draftId'},
                   'confirm': {'operation', 'draftId', 'reviewId', 'pdf', 'tex', 'confirmedDownloads'},
                   'export': {'operation', 'bundleId', 'pdfResourceId', 'sourceResourceId', 'documentId'}}
        if operation not in allowed or set(value) - allowed[operation]:
            raise Invalid('Choose prepare, confirm or export for Library files')
        return getattr(self, operation)(paper, value, now)


def locate_passage(store, pdf_files, value):
    if not isinstance(value, dict):
        raise Invalid('Invalid passage location')
    document = store.pdf(value.get('documentId'))
    page_number, start, quote = value.get('page'), value.get('start'), value.get('quote')
    if type(page_number) is not int or type(start) is not int or not isinstance(quote, str):
        raise Invalid('Invalid passage location')
    if not quote or len(quote) > 8000 or start < 0:
        raise Invalid('Invalid passage location')
    page = document.page(page_number)
    if page.text[start:start + len(quote)] != quote:
        raise Invalid('Passage does not match this PDF page')
    anchor = pdf_files.locate_anchor(store.pdf_bytes(document), document, {
        'fileDigest': document.file_digest, 'page': page_number, 'start': start, 'end': start + len(quote),
    })
    return {'rects': anchor.get('rects', [])}
