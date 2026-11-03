"""Original member lines and conservative source/PDF cross-representation evidence."""
import re
import base64
from bisect import bisect_right
from itertools import accumulate

from .model import ID, Invalid, digest
from .source_archive import LIMITATIONS, SourceArchive
from .source_text import SourceText


def source_read(store, value):
    from .source_reports import record_observation
    result = read_source(store, value)
    return record_observation(store, value, result)


def read_source(store, value):
    if value.get('operation') == 'figures':
        from .source_figures import FigureQuery, paper_figures
        return paper_figures(store, FigureQuery.parse(value))
    if set(value) - {'bundleId', 'resourceId', 'operation', 'memberId', 'startLine', 'endLine', 'start', 'end', 'pdfResourceId'} or value.get('operation') not in ('list', 'read', 'compare', 'image'):
        raise Invalid('Choose list, read, image or compare for an approved source archive')
    resource, job = store.source_downloads.job(value.get('bundleId'), value.get('resourceId'))
    if not job.receipt or not store.source_downloads.available(job):
        raise Invalid('Source files are unavailable. Acquire or restore this approved source first.', 409)
    receipt = job.receipt
    archive = SourceArchive.from_record(store._read('source-archives', receipt.archiveDigest))
    if value['operation'] == 'list':
        return dict(receipt=job.to_dict()['receipt'], members=[dict(**member.to_dict(),
            previewUrl=f'/api/research/source-image/{archive.sha256}/{member.id}' if member.preview else None) for member in archive.members], limitations=list(LIMITATIONS))
    if value['operation'] == 'compare':
        return compare_source(store, value, resource, job, archive)
    member = next((m for m in archive.members if m.id == value.get('memberId')), None)
    if value['operation'] == 'image':
        if not member:
            raise Invalid('Choose an available source image member')
        if not member.preview:
            from .source_figure_images import figure_image
            preview, image = figure_image(store, member)
            return dict(type='source_image', mimeType='image/png', data=base64.b64encode(image).decode('ascii'),
                provenance=dict(archiveDigest=archive.sha256, memberId=member.id, originalSha256=member.sha256,
                    previewSha256=preview.previewSha256, width=preview.width, height=preview.height))
        image = checked_preview(store, member)
        return dict(type='source_image', mimeType='image/png', data=base64.b64encode(image).decode('ascii'),
            provenance=dict(archiveDigest=archive.sha256, memberId=member.id, originalSha256=member.sha256,
                previewSha256=member.previewSha256, width=member.previewWidth, height=member.previewHeight))
    if not member or member.kind not in ('tex', 'text'):
        raise Invalid('Choose a UTF-8 text member; binary and unknown encodings cannot be read as text')
    data = (store.root / 'source-members' / (member.sha256 + '.bin')).read_bytes()
    if digest(data) != member.sha256:
        raise Invalid('Source member integrity check failed', 409)
    text = SourceText(data.decode('utf-8'))
    if 'start' in value:
        start = value['start']
        if 'startLine' in value or 'endLine' in value or type(start) is not int or not 0 <= start < max(1, len(text.content)):
            raise Invalid('Choose either original lines or a valid character offset')
        end = value.get('end', min(len(text.content), start + 4800))
        if (type(end) is not int or not start <= end <= min(len(text.content), start + 4800)
                or ('end' in value and end == start)):
            raise Invalid('Choose a nonempty character window within the original 4,800-character limit')
        line_starts = (0, *tuple(accumulate(len(line) for line in text.lines))[:-1])
        first = bisect_right(line_starts, start)
        last = bisect_right(line_starts, max(start, end - 1))
        content = text.content[start:end]
    else:
        if 'end' in value:
            raise Invalid('An end offset requires a start offset, not line ranges')
        first = value.get('startLine', 1)
        last = value.get('endLine', min(first + 39, len(text.lines))) if type(first) is int else 0
        start, content = text.range(first, last, limit=4800)
        end = start + len(content)
    return dict(archiveDigest=archive.sha256, memberId=member.id, memberPath=member.path, memberDigest=member.sha256,
        startLine=first, endLine=last, start=start, end=end, content=content, totalLines=len(text.lines),
        nextLine=last + 1 if end < len(text.content) else None, nextStart=end if end < len(text.content) else None)


def source_image(store, archive_digest, member_id):
    if not ID.fullmatch(archive_digest) or not ID.fullmatch(member_id):
        raise Invalid('Invalid source image reference')
    # A persisted archive is not sufficient authority: retain the original per-source grant.
    for identity in store._list('source-downloads'):
        job = store.source_downloads._read(identity)
        if job.receipt and job.receipt.archiveDigest == archive_digest:
            store.imports.approved_source(job.bundleId, job.resourceId)
            if not store.source_downloads.available(job):
                raise Invalid('Source files are unavailable or failed integrity checks; restore this source first.', 409)
            archive = SourceArchive.from_record(store._read('source-archives', archive_digest))
            member = next((m for m in archive.members if m.id == member_id and m.preview), None)
            if member:
                return checked_preview(store, member)
    raise Invalid('Source image is unavailable or not approved', 404)


def checked_preview(store, member):
    if not member.previewSha256 or not member.previewWidth or not member.previewHeight or max(member.previewWidth, member.previewHeight) > 2048:
        raise Invalid('Preview integrity metadata is unavailable or outside image limits', 409)
    original = store.root / 'source-members' / (member.sha256 + '.bin')
    path = store.root / 'source-previews' / (member.id + '.png')
    if not original.is_file() or not path.is_file():
        raise Invalid('Original image or safe preview is unavailable', 409)
    if digest(original.read_bytes()) != member.sha256:
        raise Invalid('Original source image integrity check failed', 409)
    if path.stat().st_size > 4 * 1024 * 1024:
        raise Invalid('Source image preview exceeds 4 MiB', 413)
    image = path.read_bytes()
    if digest(image) != member.previewSha256:
        raise Invalid('Source preview integrity check failed', 409)
    return image


def compare_source(store, value, source_resource, job, archive):
    def unresolved(reason):
        return dict(status='unresolved', reason=reason, matches=[])
    if not value.get('pdfResourceId'):
        return unresolved('Select an independently approved, saved PDF of the same explicit arXiv work and version.')
    pdf_resource = store.imports.approved_pdf(job.bundleId, value['pdfResourceId'])
    if not source_resource.workIdentity or not source_resource.revision or source_resource.workIdentity != pdf_resource.workIdentity or source_resource.revision != pdf_resource.revision:
        return unresolved('The source and PDF do not have the same confirmed arXiv work and explicit version. Page numbers cannot be transferred.')
    download_id = digest(dict(bundleId=job.bundleId, resourceId=pdf_resource.id))
    if download_id not in store._list('pdf-downloads'):
        return unresolved('The selected PDF has not been acquired.')
    pdf_job = store.pdf_downloads._read(download_id)
    if not pdf_job.receipt or not store.pdf_downloads.available(pdf_job):
        return unresolved('The selected PDF bytes are unavailable.')
    document = store.pdf(pdf_job.receipt.documentId)
    consulted_pdf = dict(documentId=document.id, fileDigest=document.file_digest)
    matches, inspected = [], 0
    normalized_pages = {page.number: ' '.join(page.text.split()) for page in document.pages}
    for member in archive.members:
        for structure in member.structures:
            caption = structure.caption
            # TeX commands are not rendered or guessed. Only literal text is compared.
            if structure.kind != 'caption' or not caption or re.search(r'[\\{}$%]', caption):
                continue
            words = caption.split()
            if len(' '.join(words)) < 12:
                continue
            needle = ' '.join(words)
            for page in document.pages:
                inspected += len(page.text)
                if inspected > 32_000_000:
                    return dict(status='matched' if matches else 'unresolved', reason='Literal comparison reached its 32-million-character budget; remaining captions are unresolved.', matches=matches, consultedPdf=consulted_pdf)
                normalized = normalized_pages[page.number]
                cursor = normalized.find(needle)
                while cursor >= 0:
                    # Map the exact normalized substring back to original PDF
                    # offsets without an untrusted-pattern regular expression.
                    position, original_start, original_end = 0, None, None
                    for token in re.finditer(r'\S+', page.text):
                        stop = position + len(token[0])
                        if position <= cursor < stop:
                            original_start = token.start() + cursor - position
                        if position < cursor + len(needle) <= stop:
                            original_end = token.start() + cursor + len(needle) - position
                            break
                        position = stop + 1
                    matches.append(dict(source=dict(archiveDigest=archive.sha256, memberId=member.id,
                        memberPath=member.path, memberDigest=member.sha256, startLine=structure.startLine,
                        endLine=structure.endLine, start=structure.start, end=structure.end, caption=caption),
                        pdf=dict(paperId=document.paper_id, documentId=document.id, fileDigest=document.file_digest,
                                 page=page.number, start=original_start, end=original_end, quote=page.text[original_start:original_end])))
                    cursor = normalized.find(needle, cursor + 1)
                    if len(matches) >= 64:
                        return dict(status='matched', reason='First 64 literal caption matches; not a compiled source map or semantic validation.', matches=matches, consultedPdf=consulted_pdf)
    return dict(status='matched' if matches else 'unresolved', reason='Literal caption matches only; not a compiled source map or semantic validation.' if matches else 'No literal caption matched. Macro expansion, numbering and approximate page guesses were not used.', matches=matches, consultedPdf=consulted_pdf)
