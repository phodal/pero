"""Transport mapping for Notebook-owned publication receipts."""
import re
from urllib.parse import parse_qs, urlsplit
from document import block_id, integer
from publication_compiler import PublicationPreviewUnavailable
from publication_build import PublicationBuildRequest

PATH = re.compile(r'/api/entries/([a-f0-9]{32})/publication-builds(?:/([a-f0-9]{32})(?:/pages/([1-9][0-9]{0,2}))?)?')


def publication_route(owner, method, path, read_body):
    parts = urlsplit(path)
    match = PATH.fullmatch(parts.path)
    if not match:
        return None
    identity, build_id, page = match.groups()
    if method == 'GET':
        query = parse_qs(parts.query, keep_blank_values=True)
        if query.keys() - {'blockId'} or any(len(values) != 1 for values in query.values()) or (build_id and query):
            raise ValueError('Invalid publication build query')
        block = block_id(query['blockId'][0]) if 'blockId' in query else None
        if page:
            try:
                return 200, owner.page(identity, build_id, integer(int(page), 'PDF page', maximum=500))
            except PublicationPreviewUnavailable as error:
                return 503, dict(code='preview-unavailable', error=str(error), detail=str(error))
        return 200, owner.read(identity, build_id) if build_id else owner.list(identity, block)
    if method == 'POST' and not build_id and not parts.query:
        return 201, owner.build(identity, PublicationBuildRequest.parse(read_body()))
    return 405, {'error': 'Unsupported publication build operation'}
