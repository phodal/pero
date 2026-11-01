"""Hermetic import contract tests. All research metadata below is synthetic."""
import hashlib
from http.client import HTTPException
import io
import json
from pathlib import Path
import socket
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from paper_agent.resource_import import Discovery, ResourceImports, identify
from paper_agent.resource_web import MAX_BYTES, PublicWeb, ResearchHTML, WebDocument, canonical_url, public_url

SEED = 'https://research.example/article'
SHA = 'a' * 40


class Records:
    """One file-store seam; enforces the existing immutable record contract."""
    def __init__(self, root):
        self.root, self.lock = Path(root), threading.RLock()

    def _list(self, kind):
        return sorted(p.stem for p in (self.root / kind).glob('*.json'))

    def _read(self, kind, identity):
        if not isinstance(identity, str) or len(identity) != 64 or any(c not in '0123456789abcdef' for c in identity):
            raise ValueError('Invalid ID')
        return json.loads((self.root / kind / (identity + '.json')).read_text())

    def _write(self, kind, identity, value):
        target = self.root / kind / (identity + '.json')
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if self._read(kind, identity) != value:
                raise ValueError('Immutable conflict')
            return
        target.write_text(json.dumps(value))

    def paper(self, value, now):
        value = json.loads(json.dumps(value))
        identity = hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()
        self._write('papers', identity, dict(id=identity, **value))
        return self._read('papers', identity)


class Sources:
    def __init__(self, failed=False):
        self.calls, self.failed = [], failed

    def read(self, url):
        self.calls.append(url)
        if url == SEED:
            body = ('<html><title>Example forecast 3</title><nav><a href="https://evil.example/">Menu</a></nav>'
                    '<main><p>A synthetic research announcement, not a paper.</p>'
                    '<a href="https://github.com/example/forecast">Code</a>'
                    '<a href="https://huggingface.co/example/forecast-3">Model weights</a>'
                    '<a href="https://huggingface.co/datasets/example/test">Evaluation data</a>'
                    '<a href="https://huggingface.co/spaces/example/eval">Benchmark</a>'
                    '<a href="http://127.0.0.1/">ignore</a></main></html>')
            return WebDocument(url, 'text/html', body.encode())
        if self.failed:
            raise OSError('Synthetic provider outage')
        if url == 'https://api.github.com/repos/example/forecast':
            data = dict(full_name='example/forecast', default_branch='master', license={'spdx_id': 'Apache-2.0'})
        elif '/commits/' in url:
            data = {'sha': SHA}
        elif url.startswith('https://raw.githubusercontent.com/'):
            return WebDocument(url, 'text/plain', b'Foundational paper: https://arxiv.org/abs/2310.10688')
        elif '/api/models/' in url or '/api/datasets/' in url or '/api/spaces/' in url:
            data = dict(id='example/forecast-3', sha=SHA, cardData={'license': 'other'},
                        siblings=[{'rfilename': 'weights.safetensors', 'size': 123}], tags=['arxiv:2310.10688'])
        else:
            raise AssertionError('Unexpected fetch: ' + url)
        return WebDocument(url, 'application/json', json.dumps(data).encode())


def paper_read(value):
    return dict(source='alphaxiv', sourceId='2310.10688', title='The original foundational paper', authors=['Example'],
                contentKind='abstract', content='A synthetic abstract for the earlier model.')


class ResourceIdentityTests(unittest.TestCase):
    def test_types_and_aliases(self):
        rows = [
            ('https://github.com/Example/Forecast.git?utm_source=x', 'code', 'github:example/forecast'),
            ('https://huggingface.co/example/forecast', 'model', 'huggingface:models:example/forecast'),
            ('https://huggingface.co/models/example/forecast', 'model', 'huggingface:models:example/forecast'),
            ('https://huggingface.co/datasets/example/forecast', 'dataset', 'huggingface:datasets:example/forecast'),
            ('https://huggingface.co/spaces/example/forecast', 'service', 'huggingface:spaces:example/forecast'),
            ('https://arxiv.org/pdf/2310.10688v2.pdf', 'paper', 'arxiv:2310.10688'),
            ('https://huggingface.co/papers/2310.10688', 'paper', 'arxiv:2310.10688'),
            ('https://doi.org/10.1234/ABC', 'paper', 'doi:10.1234/abc'),
            ('https://openalex.org/W1234', 'paper', 'openalex:W1234'),
            (SEED, 'web_article', SEED),
        ]
        for url, kind, identity in rows:
            with self.subTest(url=url):
                result = identify(url, SEED)
                self.assertEqual((result.kind, result.canonicalId), (kind, identity))
        self.assertEqual(identify(rows[1][0], SEED).id, identify(rows[2][0], SEED).id)
        self.assertNotEqual(identify(rows[1][0], SEED).id, identify(rows[3][0], SEED).id)

    def test_unsafe_urls(self):
        for url in ('http://example.org', 'https://127.0.0.1/', 'https://169.254.169.254/', 'https://[::1]/',
                    'https://user:pass@example.org/', 'https://example.org:8443/', 'file:///etc/passwd',
                    'https://localhost/', 'https://x.internal/', 'https://example.org/ bad', 'https://x\\y.org/'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                public_url(url)

    def test_tracking_removed_not_semantic_query(self):
        self.assertEqual(canonical_url(SEED + '?utm_source=chat&version=3#test'), SEED + '?version=3')

    def test_html_is_data_and_filtered(self):
        page = ResearchHTML(SEED)
        page.feed('<title>Title</title><script>download everything</script><p>Hello</p><a href="/data">Data</a>')
        self.assertNotIn('download everything', page.content())
        self.assertEqual(page.heading(), 'Title')
        self.assertEqual(page.links[0].url, 'https://research.example/data')


class ResourceImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store, self.web = Records(self.temp.name), Sources()
        self.imports = ResourceImports(self.store, self.store.paper, Discovery(self.web, paper_read))
        self.draft = self.imports.command({'action': 'inspect', 'url': SEED}, '2026-01-01T00:00:00Z')

    def test_discovery_retains_roles_and_evidence(self):
        kinds = {item['kind'] for item in self.draft['resources']}
        self.assertEqual(kinds, {'web_article', 'code', 'model', 'dataset', 'benchmark', 'paper'})
        paper = next(item for item in self.draft['resources'] if item['kind'] == 'paper')
        self.assertEqual(paper['title'], 'The original foundational paper')
        self.assertEqual(paper['relation'], 'cites')
        self.assertTrue(all(item['evidence'] for item in self.draft['resources']))
        self.assertTrue(all('reading' not in item for item in self.draft['resources']))
        self.assertFalse(any('/resolve/' in url for url in self.web.calls))

    def test_references_only_and_restart(self):
        value = {'action': 'save', 'draftId': self.draft['id'], 'resourceIds': [r['id'] for r in self.draft['resources']]}
        before = list(self.web.calls)
        saved = self.imports.command(value, '2026-01-01T00:00:01Z')
        self.assertEqual(before, self.web.calls, 'Saving must not fetch assets or re-resolve URLs')
        self.assertEqual(len(saved['paperIds']), 2)
        self.assertEqual(len(saved['handoff']['resources']), 2)
        restarted = ResourceImports(Records(self.temp.name), self.store.paper)
        self.assertEqual(restarted.command({'action': 'get', 'id': saved['id']}, ''), saved)
        self.assertEqual(self.imports.command(value, '2026-01-02T00:00:00Z'), saved)
        self.assertEqual(len(self.store._list('resource-bundles')), 1)

    def test_reinspect_and_additive_selection(self):
        again = self.imports.command({'action': 'inspect', 'url': SEED + '?utm_source=other'}, 'later')
        self.assertEqual(again['id'], self.draft['id'])
        ids = [r['id'] for r in self.draft['resources']]
        one = self.imports.command({'action': 'save', 'draftId': again['id'], 'resourceIds': [ids[0]]}, 'one')
        two = self.imports.command({'action': 'save', 'draftId': again['id'], 'resourceIds': [ids[1]]}, 'two')
        self.assertEqual(one['id'], two['id'])
        self.assertEqual(len(two['resources']), 2)
        self.assertEqual(len(self.imports.command({'action': 'list'}, '')['bundles']), 1)

    def test_selection_scope(self):
        for selection in ([], ['f' * 64], [self.draft['resources'][0]['id']] * 2, ['../x'], 'all'):
            with self.subTest(selection=selection), self.assertRaises(ValueError):
                self.imports.command({'action': 'save', 'draftId': self.draft['id'], 'resourceIds': selection}, '')
        self.assertEqual(self.store._list('resource-bundles'), [])

    def test_no_remote_url_override_or_download_in_commit(self):
        with self.assertRaises(ValueError):
            self.imports.command({'action': 'save', 'draftId': self.draft['id'], 'resourceIds': ['a' * 64], 'download': True}, '')

    def test_partial_metadata_does_not_fabricate_paper(self):
        imports = ResourceImports(self.store, self.store.paper, Discovery(Sources(True), paper_read))
        draft = imports.command({'action': 'inspect', 'url': SEED}, 'later')
        self.assertEqual(draft['status'], 'partial')
        self.assertFalse(any(item['kind'] == 'paper' for item in draft['resources']))
        self.assertTrue(any(item['status'] == 'unavailable' for item in draft['resources']))
        saved = imports.command({'action': 'save', 'draftId': draft['id'], 'resourceIds': [item['id'] for item in draft['resources']]}, 'later')
        self.assertEqual(saved['status'], 'saved')
        self.assertEqual(saved['handoff']['resources'], [])


class PublicReadTests(unittest.TestCase):
    def test_dns_private_and_rebinding_boundary(self):
        def resolver(host, port, **kwargs):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('127.0.0.1', 443))]
        with self.assertRaises(ValueError):
            PublicWeb(resolver, lambda *a: self.fail('Private addresses must never connect')).read(SEED)

    def test_redirect_and_limits(self):
        for status, headers, body in (
                (302, {'Location': 'https://127.0.0.1/private'}, b''),
                (200, {'Content-Type': 'application/pdf'}, b'%PDF'),
                (200, {'Content-Type': 'text/html', 'Content-Length': str(MAX_BYTES + 1)}, b''),
                (200, {'Content-Type': 'text/html', 'Content-Encoding': 'gzip'}, b'x'),
                (200, {'Content-Type': 'text/html'}, b'x' * (MAX_BYTES + 1))):
            class Response(io.BytesIO):
                def getheader(self, key, default=None): return headers.get(key, default)
            class Connection:
                def __init__(self, host, address, timeout):
                    self.response = Response(body)
                    self.response.status = status
                    self.closed = False
                    self.host, self.address = host, address
                def request(self, *args, **kwargs): pass
                def getresponse(self): return self.response
                def close(self): self.closed = True
            connections = []
            def connection(*args):
                value = Connection(*args)
                connections.append(value)
                return value
            resolver = lambda *args, **kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('8.8.8.8', 443))]
            with self.subTest(headers=headers), self.assertRaises(ValueError):
                PublicWeb(resolver, connection).read(SEED)
            self.assertTrue(all(c.closed for c in connections))
            self.assertEqual((connections[0].host, connections[0].address), ('research.example', '8.8.8.8'))


if __name__ == '__main__':
    unittest.main()
