"""Navigation from an immutable source image to its original figure location."""
from dataclasses import asdict, dataclass
import re

from .model import ID, Invalid
from .source_archive import SourceArchive
from .source_figures import SourceFigure
from .tex_preview import TexPreview, TexPreviews
from .pdf_files import PdfFiles


@dataclass(frozen=True)
class FigureReference:
    archive_digest: str
    member_id: str

    @classmethod
    def parse(cls, archive_digest, member_id):
        if any(not isinstance(value, str) or not ID.fullmatch(value) for value in (archive_digest, member_id)):
            raise Invalid('Invalid figure reference')
        return cls(archive_digest, member_id)

    @classmethod
    def from_document(cls, value):
        if set(value) - {'operation', 'archiveDigest', 'memberId', 'paperId'}:
            raise Invalid('Choose the original archiveDigest and figure memberId')
        return cls.parse(value.get('archiveDigest'), value.get('memberId'))

    @staticmethod
    def caption_page(document, figures):
        # Literal caption fragments are anchors, not TeX macro expansion or
        # inferred figure numbers. Require one page across all unique matches.
        pages = set()
        for figure in figures:
            fragments = [figure.caption] if not re.search(r'[\\{}$]', figure.caption) and len(figure.caption) >= 24 else []
            fragments += [f.strip() for f in re.split(r'\\[a-zA-Z@]+\*?|[{}$]|(?<=[.;])\s+', figure.caption) if len(f.strip()) >= 40]
            for fragment in fragments:
                fragment = fragment.strip()
                matches = document.matching_pages(fragment)
                if len(matches) == 1:
                    pages.update(matches)
        return next(iter(pages)) if len(pages) == 1 else None

    def resolve(self, store, preferred_paper=None):
        tex = TexPreviews(store, PdfFiles())
        for identity in store._list('source-downloads'):
            job = store.source_downloads._read(identity)
            if not job.receipt or job.receipt.archiveDigest != self.archive_digest:
                continue
            store.imports.approved_source(job.bundleId, job.resourceId)
            if not store.source_downloads.available(job):
                raise Invalid('Restore this exact source archive before opening its figure.', 409)
            archive = SourceArchive.from_record(store._read('source-archives', self.archive_digest))
            member = next((m for m in archive.members if m.id == self.member_id), None)
            if member is None:
                continue
            figures = tuple(f for f in SourceFigure.in_archive(archive) if f.memberIds == (member.id,))
            previews = [TexPreview.from_record(store._read('tex-previews', i)) for i in store._list('tex-previews')]
            previews = [p for p in previews if (p.bundle_id, p.resource_id, p.archive_digest) == (job.bundleId, job.resourceId, archive.sha256)]
            previews.sort(key=lambda p: p.paper_id != preferred_paper)
            target = None
            for preview in previews:
                page = self.caption_page(preview.document, figures)
                if page is not None:
                    tex.file(preview.id)
                    content = preview.document.page(page).text[:4800]
                    target = dict(previewId=preview.id, paperId=preview.paper_id, documentId=preview.document.id,
                                  fileDigest=preview.document.file_digest, page=page,
                                  reading=dict(representation='tex-preview', start=0, end=len(content), content=content,
                                               limitation='Text from this approved TeX archive rendered as PDF; not a frozen original-PDF passage or a visual read of the figure.'))
                    break
            return dict(archiveDigest=archive.sha256, memberId=member.id, memberPath=member.path,
                        bundleId=job.bundleId, resourceId=job.resourceId,
                        figures=[asdict(f) for f in figures], preview=target)
        raise Invalid('This figure source is unavailable or is no longer approved.', 404)
