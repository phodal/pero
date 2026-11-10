"""Authenticated App route mapping for local proposal recovery only."""
import re
from ai_proposals import ProposalConflict


def ai_route(proposals, method, path, read_body):
    archive = re.fullmatch(r'/api/entries/([a-f0-9]{32})/ai-workspace/archive(?:/([A-Za-z0-9_-]{1,128}))?', path)
    if archive and method == 'GET':
        return 200, proposals.archive(archive[1], archive[2])
    match = re.fullmatch(r'/api/entries/([a-f0-9]{32})/ai-workspace', path)
    if not match or method not in ('GET', 'POST'):
        return None
    try:
        return 200, proposals.read(match[1]) if method == 'GET' else proposals.save(match[1], read_body())
    except ProposalConflict as error:
        return 409, {'error': str(error), 'detail': str(error), 'code': 'ai-proposal-conflict'}
