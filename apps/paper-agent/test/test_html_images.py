"""HTML presentation-image acquisition for an approved document snapshot."""
from dataclasses import dataclass
from pathlib import Path
import tempfile
import unittest

from test_paper_documents import HtmlTransport, NOW, save_bundle
from test_scientific_document import SOURCE, URL
from paper_agent.html_images import acquire_images, allowed_image_url, image_urls, read_image
from paper_agent.model import digest
from paper_agent.paper_documents import PaperDocuments
from paper_agent.resource_fetch import SourceResponse
from paper_agent.store import ResearchStore

PNG = b'\x89PNG\r\n\x1a\n' + b'\x00' * 24


@dataclass
class HtmlImageTransport(HtmlTransport):
    images: dict | None = None

    def fetch_image(self, url, *, timeout=15, limit=2 * 1024 * 1024):
        data = (self.images or {})[url]
        return SourceResponse(url, data, 'image/png')


class HtmlImages(unittest.TestCase):
    def test_same_directory_urls_and_stored_bytes(self):
        self.assertTrue(allowed_image_url(URL, URL.rstrip('/') + '/x1.png'))
        self.assertFalse(allowed_image_url(URL, 'https://arxiv.org/html/other/x1.png'))
        self.assertEqual(image_urls(SOURCE, URL), [URL.rstrip('/') + '/x1.png'])
        with tempfile.TemporaryDirectory() as directory:
            store = ResearchStore(directory)
            transport = HtmlImageTransport(SOURCE, str(Path(directory) / 'calls'), images={URL.rstrip('/') + '/x1.png': PNG})
            documents = PaperDocuments(store, transport)
            identity = documents.command(save_bundle(store, True), NOW)['documentId']
            first = acquire_images(documents, identity, NOW)
            self.assertEqual(first['status'], 'complete')
            self.assertEqual(len(first['assets']), 1)
            self.assertEqual(first['assets'][0]['url'], URL.rstrip('/') + '/x1.png')
            self.assertEqual(first['assets'][0]['digest'], digest(PNG))
            second = acquire_images(documents, identity, NOW)
            self.assertEqual(second, first)
            data, mime = read_image(store, identity, first['assets'][0]['digest'])
            self.assertEqual((data, mime), (PNG, 'image/png'))
