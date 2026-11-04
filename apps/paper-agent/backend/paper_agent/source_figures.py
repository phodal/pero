"""Literal figure associations within one immutable TeX archive."""
from dataclasses import asdict, dataclass
from pathlib import PurePosixPath

from .model import ID, Invalid
from .source_archive import SourceArchive

FIGURE_ANSWER_GUIDANCE = (
    'When a figure helps answer the question, call research-source-read with operation=figures, a selected paperId and an optional short source-language query. '
    'It returns only approved source scopes and literal caption/label associations. For a uniquely resolved relevant member, call operation=image with its returned bundleId, resourceId and memberId. '
    'In the final chat response, embed the returned answerImage.markdown near the explanation and cite its original caption/TeX lines. Do not invent URLs or copy base64. '
    'For the explanation, use operation=reference with that image provenance archiveDigest and memberId to read the matching PDF page text alongside the TeX caption. Its tex-preview text is derived from that exact source archive, not an original-PDF passage or a visual pixel read. '
    'These source-image observations are separate from frozen PDF passage evidence; do not substitute them for required report citations. '
    'If sources or images are unavailable, state the gap; never download, compile or run an experiment automatically.\n'
)

IMAGE_SUFFIXES = ('.pdf', '.png', '.jpg', '.jpeg', '.webp')


@dataclass(frozen=True)
class FigureQuery:
    paper_id: str
    query: str

    @classmethod
    def parse(cls, value):
        if (set(value) - {'operation', 'paperId', 'query'} or not isinstance(value.get('paperId'), str)
                or not ID.fullmatch(value['paperId']) or not isinstance(value.get('query', ''), str)
                or len(value.get('query', '')) > 500):
            raise Invalid('Choose a saved paperId and an optional figure query of at most 500 characters')
        return cls(value['paperId'], value.get('query', '').strip().casefold())


@dataclass(frozen=True)
class SourceFigure:
    texMemberId: str
    texPath: str
    startLine: int
    endLine: int
    caption: str
    label: str
    reference: str
    memberIds: tuple[str, ...]

    @classmethod
    def in_archive(cls, archive: SourceArchive):
        result = []
        for tex in archive.members:
            for region in tex.structures:
                if region.kind not in ('figure', 'figure*'):
                    continue
                inside = [s for s in tex.structures if region.start <= s.start and s.end <= region.end]
                captions = [s for s in inside if s.kind == 'caption']
                for graphic in (s for s in inside if s.kind == 'includegraphics'):
                    caption = next((s for s in captions if s.start >= graphic.end), captions[0] if len(captions) == 1 else None)
                    following = next((s.start for s in captions if caption and s.start > caption.start), region.end)
                    label = next((s for s in inside if s.kind == 'label' and caption and caption.end <= s.start < following), None)
                    if label is None and caption:
                        label = next((s for s in inside if s.kind == 'label' and graphic.end <= s.start < caption.start), None)
                    reference = graphic.reference or ''
                    # Match literal project-relative or TeX-file-relative paths.
                    # Macros and unresolved graphicspath are not guessed.
                    paths = {reference, str(PurePosixPath(tex.path).parent / reference)}
                    members = tuple(m.id for m in archive.members if any(
                        m.path == path or not PurePosixPath(path).suffix and m.path in tuple(path + suffix for suffix in IMAGE_SUFFIXES)
                        for path in paths) and PurePosixPath(m.path).suffix.lower() in IMAGE_SUFFIXES)
                    result.append(cls(tex.id, tex.path, min(graphic.startLine, caption.startLine if caption else graphic.startLine),
                                      max(graphic.endLine, caption.endLine if caption else graphic.endLine, label.endLine if label else graphic.endLine),
                                      caption.caption if caption else '', label.reference if label else '', reference, members))
        return tuple(result)


def paper_figures(store, query: FigureQuery):
    from .tex_preview import TexPreviews
    from .pdf_files import PdfFiles
    paper = store.paper(query.paper_id)
    title = (paper.title or '').strip()[:200] or 'Open paper'
    sources, figures = [], []
    for source in TexPreviews(store, PdfFiles()).sources(query.paper_id):
        scope = dict(bundleId=source.bundle_id, resourceId=source.resource_id, revision=source.revision,
                     available=source.available)
        sources.append(scope)
        if not source.available:
            continue
        _, job = store.source_downloads.job(source.bundle_id, source.resource_id)
        archive = SourceArchive.from_record(store._read('source-archives', job.receipt.archiveDigest))
        by_id = {m.id: m for m in archive.members}
        for figure in SourceFigure.in_archive(archive):
            fields = (figure.caption, figure.label, figure.reference)
            if query.query and not any(query.query in text.casefold() for text in fields):
                continue
            figures.append(dict(**scope, archiveDigest=archive.sha256, **asdict(figure),
                members=[dict(id=by_id[i].id, path=by_id[i].path, sha256=by_id[i].sha256) for i in figure.memberIds],
                resolved=len(figure.memberIds) == 1))
    # Chat surfaces this as an appLink so reopened tool results can reopen the paper.
    return dict(paperId=query.paper_id, sources=sources, figures=figures[:16], truncated=len(figures) > 16,
                links=[dict(label=title, location=f'paper/{query.paper_id}')],
                limitation='Literal TeX associations only, not compiled figure numbers or PDF page mappings. Use image with the returned bundleId, resourceId and unique memberId; cite its caption and original TeX lines. No source is acquired automatically.')
