"""Bounded access to Hugging Face paper thumbnails."""
import re
from urllib.error import URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .model import Invalid

MAX_THUMBNAIL_BYTES = 1024 * 1024


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class PaperThumbnails:
    def __init__(self, fetch=None):
        self.fetch = fetch if fetch is not None else build_opener(_NoRedirect()).open

    def read(self, paper_id):
        if not re.fullmatch(r'\d{4}\.\d{4,5}', paper_id):
            raise Invalid('Invalid paper thumbnail ID')
        url = f'https://cdn-thumbnails.huggingface.co/social-thumbnails/papers/{paper_id}.png'
        try:
            with self.fetch(Request(url, headers={'Accept': 'image/png', 'User-Agent': 'Pero-Paper/1.0'}), timeout=10) as response:
                mime = response.headers.get('Content-Type', '').split(';', 1)[0].strip().lower()
                data = response.read(MAX_THUMBNAIL_BYTES + 1)
        except (URLError, OSError, TimeoutError) as error:
            raise Invalid('Paper thumbnail is unavailable', 502) from error
        if mime != 'image/png' or len(data) > MAX_THUMBNAIL_BYTES or not data.startswith(b'\x89PNG\r\n\x1a\n'):
            raise Invalid('Paper thumbnail is unavailable', 502)
        return data
