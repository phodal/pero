"""Synthetic OpenAlex boundary for a disposable installed Paper App only."""
from io import BytesIO
import json
from urllib.parse import urlsplit, parse_qs

_citing_calls = 0


class Response(BytesIO):
    def __init__(self, value, status=200):
        super().__init__(json.dumps(value).encode())
        self.status, self.headers = status, {}


def work(identity):
    return dict(id='https://openalex.org/' + identity, doi='https://doi.org/10.1234/' + identity,
                display_name='Synthetic ' + identity, publication_date='2026-01-01', cited_by_count=2,
                authorships=[dict(author=dict(display_name='Synthetic fixture'))],
                abstract_inverted_index={} if identity == 'W4' else {'Synthetic': [0], identity: [1]})


def fetch(url, **_options):
    global _citing_calls
    parsed = urlsplit(url)
    if parsed.hostname != 'api.openalex.org':
        raise RuntimeError('Unexpected network request in offline discovery fixture')
    query = parse_qs(parsed.query)
    if parsed.path != '/works':
        result = work(parsed.path.rsplit('/', 1)[-1])
        result.update(related_works=['https://openalex.org/W2', 'https://openalex.org/W3', 'https://openalex.org/W4'],
                      referenced_works=['https://openalex.org/W' + str(i) for i in range(2, 15)])
        return Response(result)
    if 'search' in query:
        return Response(dict(results=[work('W1')]))
    relation = query['filter'][0]
    if relation.startswith('cites:'):
        _citing_calls += 1
        return Response(dict(error='Synthetic rate limit'), 429) if _citing_calls == 1 else Response(dict(results=[], meta=dict(count=0)))
    ids = relation.removeprefix('openalex:').split('|')
    return Response(dict(results=[work(i) for i in reversed(ids)]))
