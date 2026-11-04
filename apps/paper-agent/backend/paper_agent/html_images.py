"""Display images for one approved HTML snapshot.

These bytes are presentation assets for the already-authorized official HTML URL.
They are not research-asset downloads, TeX figure evidence, or visual observations.
"""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from .model import Invalid, digest

MAX_IMAGES = 32
MAX_IMAGE_BYTES = 2 * 1024 * 1024
MAX_TOTAL_BYTES = 16 * 1024 * 1024
IMAGE_MIME = frozenset({
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp',
})


class _ImageUrls(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.base = None
        self.sources = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == 'base' and values.get('href') and self.base is None:
            self.base = values['href']
        if tag == 'img' and values.get('src'):
            self.sources.append(values['src'])


def html_root(source_url: str) -> str:
    parts = urlsplit(source_url)
    path = parts.path
    # arXiv HTML identity paths are directories (`/html/2606.03979v2`), not files.
    if path.endswith(('.html', '.htm')):
        path = path.rsplit('/', 1)[0] + '/'
    elif not path.endswith('/'):
        path = path + '/'
    return f'{parts.scheme}://{parts.netloc}{path}'


def allowed_image_url(source_url: str, image_url: str) -> bool:
    source, image = urlsplit(source_url), urlsplit(image_url)
    if image.scheme != 'https' or image.netloc != source.netloc or image.query or image.fragment:
        return False
    root = urlsplit(html_root(source_url)).path
    return image.path.startswith(root) and len(image.path) > len(root)


def image_urls(html: bytes, source_url: str) -> list[str]:
    parser = _ImageUrls()
    parser.feed(html.decode('utf-8', errors='replace'))
    parser.close()
    base = urljoin(source_url if source_url.endswith('/') else source_url + '/', parser.base or '')
    found = []
    seen = set()
    for source in parser.sources:
        if source.startswith('data:') or source.startswith('#'):
            continue
        url = urljoin(base or source_url, source)
        if url in seen or not allowed_image_url(source_url, url):
            continue
        seen.add(url)
        found.append(url)
        if len(found) >= MAX_IMAGES:
            break
    return found


def image_dir(store, document_id: str) -> Path:
    return Path(store.root) / 'html-images' / document_id


def read_manifest(store, document_id: str):
    path = image_dir(store, document_id) / 'manifest.json'
    if not path.is_file():
        return None
    import json
    return json.loads(path.read_bytes())


def write_manifest(store, document_id: str, manifest):
    import json
    directory = image_dir(store, document_id)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'manifest.json').write_bytes(json.dumps(manifest, separators=(',', ':'), ensure_ascii=True).encode())


def read_image(store, document_id: str, identity: str):
    manifest = read_manifest(store, document_id)
    if not manifest:
        raise Invalid('No stored HTML images for this document', 404)
    asset = next((item for item in manifest.get('assets', []) if item.get('digest') == identity), None)
    if not asset:
        raise Invalid('Unknown HTML image', 404)
    path = image_dir(store, document_id) / (identity + '.bin')
    data = path.read_bytes()
    if digest(data) != identity or len(data) != asset.get('bytes'):
        raise Invalid('Stored HTML image failed integrity checks', 409)
    return data, asset['mime']


def acquire_images(documents, document_id: str, now: str):
    """Fetch same-directory images for a stored HTML document; reuse a finished manifest."""
    existing = read_manifest(documents.store, document_id)
    if existing and existing.get('status') in ('complete', 'empty', 'partial'):
        return existing
    document, original = documents.read(document_id)
    urls = image_urls(original, document.source.url)
    staged = []
    total, missing = 0, 0
    for url in urls:
        if total >= MAX_TOTAL_BYTES:
            missing += 1
            continue
        try:
            response = documents.transport.fetch_image(url, timeout=15, limit=MAX_IMAGE_BYTES)
        except Invalid:
            missing += 1
            continue
        if response.url != url or response.mime not in IMAGE_MIME:
            missing += 1
            continue
        if total + len(response.data) > MAX_TOTAL_BYTES:
            missing += 1
            continue
        identity = digest(response.data)
        staged.append((identity, response.data, dict(url=url, digest=identity, mime=response.mime, bytes=len(response.data))))
        total += len(response.data)
    status = 'empty' if not urls else 'complete' if missing == 0 else 'partial'
    manifest = dict(documentId=document_id, sourceUrl=document.source.url, sourceDigest=document.source.digest,
                    status=status, assets=[item[2] for item in staged], missing=missing, acquiredAt=now)
    with documents.store.lock:
        existing = read_manifest(documents.store, document_id)
        if existing and existing.get('status') in ('complete', 'empty', 'partial'):
            return existing
        directory = image_dir(documents.store, document_id)
        directory.mkdir(parents=True, exist_ok=True)
        for identity, data, _asset in staged:
            (directory / (identity + '.bin')).write_bytes(data)
        write_manifest(documents.store, document_id, manifest)
    return manifest
