"""Synthetic OpenAlex boundary for a disposable installed Paper App only."""
from io import BytesIO
import json
from urllib.parse import urlsplit, parse_qs
from PIL import Image, ImageDraw

_citing_calls = 0


def thumbnail_fetch(request, timeout):
    if request.full_url.endswith('/2603.28053.png'):
        raise OSError('Synthetic thumbnail unavailable')
    if request.full_url != 'https://cdn-thumbnails.huggingface.co/social-thumbnails/papers/2603.28052.png':
        raise ValueError('Unexpected synthetic thumbnail')
    image = Image.new('RGB', (160, 96), '#ffffff')
    drawing = ImageDraw.Draw(image)
    drawing.rectangle((8, 8, 152, 88), outline='#546879')
    drawing.line((20, 70, 50, 52, 85, 58, 130, 25), fill='#007f86', width=3)
    output = BytesIO()
    image.save(output, format='PNG')
    output.seek(0)
    output.headers = {'Content-Type': 'image/png'}
    return output


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
    if parsed.hostname == 'huggingface.co' and parsed.path == '/api/papers/search':
        return Response([dict(paper=dict(id='2603.28052', title='Synthetic AI paper', summary='A synthetic research result.',
                         publishedAt='2026-03-30T00:00:00Z', upvotes=17,
                         githubRepo='https://github.com/example/research', githubStars=42,
                         projectPage='https://example.org/research'),
                         thumbnail='https://cdn-thumbnails.huggingface.co/social-thumbnails/papers/2603.28052.png'),
                         dict(paper=dict(id='2603.28053', title='Synthetic missing thumbnail', summary='Synthetic fallback.',
                                         publishedAt='2026-03-29T00:00:00Z'),
                              thumbnail='https://cdn-thumbnails.huggingface.co/social-thumbnails/papers/2603.28053.png')])
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
