"""Saved-paper presentation over existing arXiv inspection and download owners."""
from dataclasses import asdict, dataclass

from .model import Invalid, digest
from .research_resources import ArxivPaper, OfficialHtml


@dataclass(frozen=True)
class ReadingReview:
    paper_id: str
    draft_digest: str
    html_id: str
    source_id: str | None

    @property
    def id(self):
        return digest(asdict(self))


def reading_command(store, paper, value, now):
    if not isinstance(value, dict):
        raise Invalid('Choose review or confirm for arXiv reading')
    operation = value.get('operation')
    allowed = {'review': {'operation', 'draftId', 'refresh'},
               'confirm': {'operation', 'draftId', 'reviewId', 'tex', 'confirmedDownloads'}}
    if operation not in allowed or set(value) - allowed[operation]:
        raise Invalid('Choose review or confirm for arXiv reading')
    if type(value.get('refresh', False)) is not bool:
        raise Invalid('Choose whether to refresh the arXiv source review')
    work = ArxivPaper.from_snapshot(paper)
    seed = 'https://arxiv.org/abs/' + work.identifier
    if value.get('draftId'):
        draft = store.imports.draft(value['draftId'])
        if draft.seedUrl != seed:
            raise Invalid('This review belongs to another paper; review this paper again', 409)
    else:
        draft = store.imports.inspect(dict(url=seed, refresh=value.get('refresh', False)), now)
    if draft.status != 'ready':
        if operation == 'confirm':
            raise Invalid('Wait for the arXiv source review before downloading', 409)
        return dict(status=draft.status, draftId=draft.id, error=draft.error)
    choices = []
    for resource in draft.resources:
        if resource.kind != 'paper' or not resource.workIdentity or not resource.revision:
            continue
        source = OfficialHtml.from_resource(resource)
        if work.accepts(source):
            choices.append((resource, source))
    if len(choices) != 1:
        details = '; '.join(dict.fromkeys(message for r in draft.resources for message in r.unresolved))
        raise Invalid('arXiv did not establish one fixed paper version; retry the source review or use PDF.'
                      + (' ' + details if details else ''), 409)
    resource, source = choices[0]
    archives = [r for r in draft.resources if r.kind == 'source_archive'
                and (r.workIdentity, r.revision) == (resource.workIdentity, resource.revision)]
    archive = archives[0] if len(archives) == 1 else None
    review = ReadingReview(paper.id, digest(draft.to_dict()), resource.id, archive.id if archive else None)
    if operation == 'review':
        return dict(status='ready', draftId=draft.id, reviewId=review.id, version=source.revision,
                    htmlUrl=source.url, texUrl=archive.originalUrl if archive else None,
                    warnings=list(draft.warnings))
    if (value.get('reviewId') != review.id or value.get('confirmedDownloads') is not True
            or type(value.get('tex')) is not bool):
        raise Invalid('Review and confirm the selected HTML and optional TeX before downloading', 409)
    if value['tex'] and not archive:
        raise Invalid('This version has no TeX source candidate', 409)
    ids = [resource.id, *([archive.id] if value['tex'] else [])]
    bundle = store.imports.commit(dict(draftId=draft.id, resourceIds=ids, htmlIds=[resource.id],
        sourceIds=[archive.id] if value['tex'] else [], confirmedDownloads=True), now)
    selected = next(r for r in bundle.resources if r.id in bundle.htmlDownloadIds
                    and r.kind == 'paper' and OfficialHtml.from_resource(r) == source)
    return dict(bundle=bundle.to_dict(), source=dict(bundleId=bundle.id, resourceId=selected.id,
                url=source.url, revision=source.revision, authorized=True, reviewUrl=seed),
                sourceIds=[r.id for r in bundle.resources if archive and value['tex']
                           and r.kind == 'source_archive' and r.workIdentity == archive.workIdentity
                           and r.revision == archive.revision and r.id in bundle.sourceDownloadIds])
