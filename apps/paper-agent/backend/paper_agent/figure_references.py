"""Navigation from an immutable source image to its original figure location."""
from dataclasses import asdict, dataclass, replace
import re

from .model import ID, Invalid
from .source_archive import SourceArchive
from .source_figures import SourceFigure
from .tex_preview import TexPreview, TexPreviews
from .pdf_files import PdfFiles
from .research_resources import ArxivPaper


@dataclass(frozen=True)
class FigureCaptionLocation:
    """A unique literal caption window in one document's own text coordinates."""
    page: int
    start: int
    end: int

    @classmethod
    def match(cls, document, figures):
        fragments = set()
        for figure in figures:
            if not re.search(r'[\\{}$]', figure.caption) and len(figure.caption) >= 24:
                fragments.add(figure.caption)
            fragments.update(f.strip() for f in re.split(r'\\[a-zA-Z@]+\*?|[{}$]|(?<=[.;])\s+', figure.caption) if len(f.strip()) >= 40)
        matches = set()
        for page in document.pages:
            offsets = [i for i, character in enumerate(page.text) if not character.isspace()]
            compact = ''.join(page.text[i] for i in offsets)
            for fragment in fragments:
                needle = re.sub(r'\s+', '', fragment)
                start = compact.find(needle)
                if start >= 0 and compact.find(needle, start + 1) < 0:
                    matches.add(cls(page.number, offsets[start], offsets[start + len(needle) - 1] + 1))
        if len({match.page for match in matches}) != 1:
            return None
        # Prefer the longest literal window, retaining the source offsets even
        # when PDF line wrapping differs. Other fragments may surround TeX macros.
        return max(matches, key=lambda match: (match.end - match.start, -match.start))


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

    def resolve(self, store, preferred_paper=None):
        pdf_files = PdfFiles()
        tex = TexPreviews(store, pdf_files)
        for identity in store._list('source-downloads'):
            job = store.source_downloads._read(identity)
            if not job.receipt or job.receipt.archiveDigest != self.archive_digest:
                continue
            resource = store.imports.approved_source(job.bundleId, job.resourceId)
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
                location = FigureCaptionLocation.match(preview.document, figures)
                if location is not None:
                    anchor = pdf_files.locate_anchors(tex.file(preview.id), preview.document, preview.document.file_digest,
                                                     location.page, [(location.start, location.end)])[0]
                    content = preview.document.page(location.page).text[:4800]
                    target = dict(previewId=preview.id, paperId=preview.paper_id, documentId=preview.document.id,
                                  **{key: anchor[key] for key in ('fileDigest', 'page', 'rects')},
                                  reading=dict(representation='tex-preview', start=0, end=len(content), content=content,
                                               limitation='Text from this approved TeX archive rendered as PDF; not a frozen original-PDF passage or a visual read of the figure.'))
                    break
            original = None
            documents = [store.pdf(i) for i in store._list('pdfs')]
            documents.sort(key=lambda d: (d.paper_id != preferred_paper, d.id))
            for document in documents:
                try:
                    work = ArxivPaper.from_snapshot(replace(store.paper(document.paper_id), pdf_url=document.source_url))
                except Invalid:
                    continue
                if (f'arxiv:{work.work}', work.revision) != (resource.workIdentity, resource.revision):
                    continue
                location = FigureCaptionLocation.match(document, figures)
                if location is not None:
                    anchor = pdf_files.locate_anchors(store.pdf_bytes(document), document, document.file_digest,
                                                     location.page, [(location.start, location.end)])[0]
                    original = dict(paperId=document.paper_id, **anchor)
                    break
            return dict(archiveDigest=archive.sha256, memberId=member.id, memberPath=member.path,
                        bundleId=job.bundleId, resourceId=job.resourceId,
                        figures=[asdict(f) for f in figures], preview=target, pdf=original)
        raise Invalid('This figure source is unavailable or is no longer approved.', 404)
