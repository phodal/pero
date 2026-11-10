"""HTTP mapping for local scientific record libraries."""
import re
from urllib.parse import parse_qs, urlsplit
from document import fields, integer
from scientific_designs import MissingScientificRecord, PlateDesign, ReactionDefinition
from store import RevisionConflict

PATH = re.compile(r'/api/scientific/(plates|reactions)(?:/([a-f0-9]{32})(/revisions)?)?')


def scientific_route(store, method, path, read_body):
    parts = urlsplit(path)
    match = PATH.fullmatch(parts.path)
    if not match:
        return None
    kind, identity, revisions = match.groups()
    try:
        if method == 'GET' and not revisions:
            query = parse_qs(parts.query, keep_blank_values=True)
            if query.keys() - {'revision'} or any(len(items) != 1 for items in query.values()):
                raise ValueError('Invalid scientific record query')
            if identity is None:
                if query:
                    raise ValueError('Listing cannot select a revision')
                return 200, {'records': store.list(kind)}
            revision = None
            if 'revision' in query:
                if not re.fullmatch(r'[1-9][0-9]{0,9}', query['revision'][0]):
                    raise ValueError('Invalid record revision')
                revision = integer(int(query['revision'][0]), 'record revision')
            return 200, store.read(kind, identity, revision)
        if method == 'POST' and not parts.query and (identity is None or revisions):
            raw = read_body()
            fields(raw, {'definition', 'expectedRevision'} if identity else {'definition'})
            expected = integer(raw['expectedRevision'], 'expected revision') if identity else None
            definition = PlateDesign.parse(raw['definition']) if kind == 'plates' else ReactionDefinition.parse(raw['definition'], submitted=True)
            return 201, store.save(definition, identity, expected)
        return 405, {'error': 'Unsupported scientific record operation'}
    except MissingScientificRecord as error:
        return 404, {'error': str(error), 'detail': str(error), 'code': 'not-found'}
    except RevisionConflict as error:
        return 409, {'error': str(error), 'detail': 'A newer local record exists. Reload before publishing another revision.', 'code': 'scientific-conflict', 'currentRevision': error.current_revision}
