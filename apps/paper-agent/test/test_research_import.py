"""Research URL import behavior; all network data here is synthetic."""
from dataclasses import replace
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import io
import json
import multiprocessing
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from paper_agent.model import Invalid, canonical
from paper_agent.research_resources import ImportDraft, ImportSelection, ResearchAsset, ResearchBundle, ResearchResource, ResourceIdentity, OfficialHtml
from paper_agent.resource_fetch import PublicMetadata, WebDocument
from paper_agent.resource_inspection import ResourceInspector
from paper_agent.inspection_worker import inspect_bounded, inspect_child
from paper_agent.store import ResearchStore

NOW = '2026-11-01T02:00:00Z'
SEED = 'https://research.example/release'
SHA, REV = 'a' * 64, 'b' * 40


def resource_fixture():
    article = replace(ResearchResource.linked(SEED, SEED, 'Synthetic release'), excerpt='A release article, not a paper.')
    model = ResearchResource.linked('https://huggingface.co/example/model', SEED, 'Model weights')
    asset = ResearchAsset.create('Model weights', 'model', 'weights.safetensors', 4, 'non-commercial', REV, model.url,
                                  model.url + '/resolve/' + REV + '/weights.safetensors', SHA)
    model = replace(model, revision=REV, license='non-commercial', size=4, assets=(asset,))
    return article, model


class FixtureInspector:
    def inspect(self, draft, cancelled):
        return draft.finish(resource_fixture(), ())


class StalledInspector:
    def inspect(self, draft, cancelled):
        threading.Event().wait()  # Models uninterruptible resolver/slow-header I/O.


class StartedStall:
    def __init__(self, started):
        self.started = started

    def inspect(self, draft, cancelled):
        self.started.set()
        threading.Event().wait()


def orphan_parent(result_pipe, started, cancelled):
    context = multiprocessing.get_context('spawn')
    process = context.Process(target=inspect_child, args=(result_pipe, ImportDraft.create(SEED, NOW),
                              StartedStall(started), cancelled, 20))
    process.start()
    started.wait(5)
    os._exit(0)


def parent_waiting_for_force_kill(result_pipe, started, cancelled, identity_pipe):
    context = multiprocessing.get_context('spawn')
    process = context.Process(target=inspect_child, args=(result_pipe, ImportDraft.create(SEED, NOW),
                              StartedStall(started), cancelled, 30))
    process.start()
    identity_pipe.send(process.pid)
    identity_pipe.close()
    threading.Event().wait(30)


class ResourceIdentityTest(unittest.TestCase):
    def test_classification_and_aliases(self):
        cases = [
            ('https://huggingface.co/org/model', 'model', 'hf:model:org/model'),
            ('https://huggingface.co/models/org/model', 'model', 'hf:model:org/model'),
            ('https://huggingface.co/datasets/org/data', 'dataset', 'hf:dataset:org/data'),
            ('https://huggingface.co/spaces/org/demo', 'service', 'hf:service:org/demo'),
            ('https://arxiv.org/pdf/2310.10688v2.pdf', 'pdf_candidate', 'url:https://arxiv.org/pdf/2310.10688v2.pdf'),
            ('https://doi.org/10.1234/EXAMPLE', 'paper', 'doi:10.1234/example'),
            ('https://github.com/Example/Code.git', 'code', 'github:example/code'),
            (SEED + '?utm_source=test', 'web_article', 'url:' + SEED),
        ]
        for url, kind, identity in cases:
            with self.subTest(url=url):
                result = ResourceIdentity.from_url(url)
                self.assertEqual((result.kind, result.identity), (kind, identity))
        benchmark = ResearchResource.linked('https://huggingface.co/spaces/org/score', SEED, 'Gift-Eval', 'Benchmarks')
        self.assertEqual((benchmark.kind, benchmark.relation, benchmark.assets), ('benchmark', 'evaluated_on', ()))
        cited = ResearchResource.linked('https://arxiv.org/abs/2310.10688', SEED, 'Foundational model')
        self.assertEqual(cited.relation, 'cites')

    def test_managed_artifacts_cannot_be_granted_as_source_archives(self):
        for path, kind in (
            ('datasets/org/data/resolve/main/data.tar.gz', 'dataset'),
            ('org/model/resolve/main/weights.gz', 'model'),
            ('models/org/model/resolve/main/weights.zip', 'model'),
        ):
            with self.subTest(path=path):
                resource = ResearchResource.linked('https://huggingface.co/' + path, SEED)
                self.assertEqual(resource.kind, kind)
                self.assertEqual(resource.assets, ())
                draft = ImportDraft.create(SEED, NOW).finish((resource,), ())
                value = dict(draftId=draft.id, resourceIds=[resource.id])
                self.assertEqual(ImportSelection.parse(value, draft).sourceIds, ())
                with self.assertRaisesRegex(Invalid, 'only source archives'):
                    ImportSelection.parse({**value, 'sourceIds': [resource.id], 'confirmedDownloads': True}, draft)
        self.assertEqual(ResourceIdentity.from_url('https://research.example/methods.tgz').kind, 'source_archive')

    def test_revision_links_are_not_silently_changed(self):
        arxiv = ResearchResource.linked('https://arxiv.org/abs/2310.10688v2', SEED)
        self.assertEqual(arxiv.revision, 'v2')
        self.assertNotEqual(ImportDraft.create(arxiv.url, NOW).id, ImportDraft.create(arxiv.originalUrl, NOW).id)
        for url in ('https://huggingface.co/org/model/tree/' + REV, 'https://github.com/org/code/commit/' + REV):
            resource = ResearchResource.linked(url, SEED)
            self.assertEqual(resource.revision, REV)
            self.assertTrue(resource.unresolved)
            def forbidden(*_args, **_kwargs):
                self.fail('Pinned reference-only link must not fetch latest metadata')
            self.assertEqual(ResourceInspector().resolve(resource, forbidden)[0], resource)

    def test_official_html_requires_selected_fixed_work_and_independent_confirmation(self):
        paper = ResearchResource.linked('https://arxiv.org/abs/2310.10688v2', SEED)
        pdf = ResearchResource.linked('https://arxiv.org/pdf/2310.10688v2', SEED)
        source = ResearchResource.linked('https://arxiv.org/src/2310.10688v2', SEED)
        draft = ImportDraft.create(SEED, NOW).finish((paper, pdf, source), ())
        body = dict(draftId=draft.id, resourceIds=[paper.id, pdf.id, source.id])
        self.assertEqual(OfficialHtml.from_resource(paper).url, 'https://arxiv.org/html/2310.10688v2')
        self.assertEqual(OfficialHtml.from_resource(pdf), OfficialHtml.from_resource(paper))
        self.assertEqual(ImportSelection.parse(body, draft).htmlIds, ())
        for patch in (dict(htmlIds=[paper.id]), dict(htmlIds=[source.id], confirmedDownloads=True),
                      dict(htmlIds=[paper.id], resourceIds=[pdf.id], confirmedDownloads=True),
                      dict(htmlIds=[paper.id, paper.id], confirmedDownloads=True)):
            with self.subTest(patch=patch), self.assertRaises(Invalid):
                ImportSelection.parse({**body, **patch}, draft)
        granted = ImportSelection.parse(dict(body, htmlIds=[paper.id], confirmedDownloads=True), draft)
        self.assertEqual(granted.htmlIds, (paper.id,))
        conflicting = replace(draft, resources=(*draft.resources, ResearchResource.linked('https://arxiv.org/abs/2310.10688v3', SEED)))
        with self.assertRaisesRegex(Invalid, 'one explicit version'):
            ImportSelection.parse(dict(body, htmlIds=[paper.id], confirmedDownloads=True), conflicting)
        for patch in (dict(workIdentity=None), dict(workIdentity='arxiv:2310.10688v2'),
                      dict(workIdentity='arxiv:../../private'), dict(revision=None), dict(revision='v0'),
                      dict(revision='main'), dict(revision='v3'), dict(kind='code')):
            with self.subTest(patch=patch), self.assertRaises(Invalid):
                OfficialHtml.from_resource(replace(paper, **patch))

    def test_alias_merge_and_selection_authority(self):
        first = replace(ResearchResource.linked('https://openalex.org/W123', SEED), aliases=('doi:10.1234/example',))
        doi = ResearchResource.linked('https://doi.org/10.1234/example', SEED)
        draft = ImportDraft.create(first.url, NOW).finish((first,), ())
        selection = ImportSelection.parse(dict(draftId=draft.id, resourceIds=[first.id]), draft)
        saved = ResearchBundle.selected(draft, selection, NOW)
        next_draft = ImportDraft.create(doi.url, NOW).finish((doi,), ())
        next_selection = ImportSelection.parse(dict(draftId=next_draft.id, resourceIds=[doi.id]), next_draft)
        merged = ResearchBundle.selected(next_draft, next_selection, NOW, saved)
        self.assertEqual(len(merged.resources), 1)
        self.assertEqual(merged.resources[0].identity, first.identity)
        same_draft = replace(draft, resources=(first, doi))
        same_selection = ImportSelection.parse(dict(draftId=draft.id, resourceIds=[first.id, doi.id]), same_draft)
        self.assertEqual(len(ResearchBundle.selected(same_draft, same_selection, NOW).resources), 1)
        article, model = resource_fixture()
        asset = model.assets[0]
        changed_license = ResearchAsset.create(asset.name, asset.kind, asset.filename, asset.size, 'different-license', asset.revision, asset.sourceUrl, asset.url, asset.sha256)
        self.assertNotEqual(asset.id, changed_license.id)
        review = ImportDraft.create(SEED, NOW).finish((article, model), ())
        body = dict(draftId=review.id, resourceIds=[model.id], downloadIds=[model.assets[0].id])
        with self.assertRaisesRegex(Invalid, 'Confirm'):
            ImportSelection.parse(body, review)
        self.assertEqual(ImportSelection.parse({**body, 'confirmedDownloads': True}, review).downloadIds, (model.assets[0].id,))
        with self.assertRaises(Invalid):
            ImportSelection.parse({**body, 'resourceIds': [article.id], 'confirmedDownloads': True}, review)


class MetadataSafetyTest(unittest.TestCase):
    def test_official_arxiv_system_proxy_keeps_other_destinations_pinned(self):
        from unittest.mock import patch
        tunnels, targets = [], []
        class ProxyConnection:
            sock = None
            def __init__(self, host, port, **options):
                self.host, self.port = host, port
                self.context = options['context']
            def set_tunnel(self, host, port): tunnels.append((self.host, self.port, host, port))
            def request(self, method, target, **_options): targets.append(target)
            def getresponse(self):
                response = io.BytesIO(b'<html>official</html>')
                response.status = 200
                response.getheader = lambda name, default=None: 'text/html' if name == 'Content-Type' else default
                return response
            def close(self): pass
        def fake_dns(*_args, **_kwargs):
            return [(None, None, None, None, ('198.18.1.200', 443))]
        with patch('paper_agent.resource_fetch.getproxies', return_value={'https': 'http://127.0.0.1:7897'}), \
             patch('paper_agent.resource_fetch.HTTPSConnection', ProxyConnection):
            transport = PublicMetadata(resolve=fake_dns)
            for path in ('/html/2610.24007v1', '/abs/2610.24007', '/api/query?id_list=2610.24007'):
                self.assertEqual(transport.fetch('https://arxiv.org' + path).text, '<html>official</html>')
            self.assertEqual(tunnels, [('127.0.0.1', 7897, 'arxiv.org', 443)] * 3)
            self.assertEqual(set(targets), {'/html/2610.24007v1', '/abs/2610.24007', '/api/query?id_list=2610.24007'})
            for url in ('https://research.example/paper', 'https://private.example/',
                        'https://arxiv.org/html/not-an-id', 'https://arxiv.org/html/2610.24007v1?url=private',
                        'https://arxiv.org/api/query?id_list=2610.24007&url=private'):
                with self.subTest(url=url), self.assertRaisesRegex(Invalid, 'Private'):
                    transport.fetch(url)
            self.assertEqual(len(tunnels), 3)

    def test_public_address_pin_redirect_size_and_type(self):
        opened = []
        replies = []
        class Connection:
            def __init__(self, host, address, timeout):
                opened.append((host, address)); self.sock = None
            def request(self, *_args, **_kwargs): pass
            def getresponse(self): return replies.pop(0)
            def close(self): pass
        def response(body=b'hello', status=200, **headers):
            value = io.BytesIO(body)
            value.status = status
            fields = {'Content-Type': 'text/html', **headers}
            value.getheader = lambda key, default=None: fields.get(key, default)
            return value
        def resolver(host, *_args, **_kwargs):
            return [(None, None, None, None, ('127.0.0.1' if host == 'private.example' else '93.184.216.34', 443))]
        fetch = PublicMetadata(resolver, Connection).fetch
        replies.append(response())
        self.assertEqual(fetch(SEED).text, 'hello')
        self.assertEqual(opened[-1], ('research.example', '93.184.216.34'))
        for url in ('http://research.example', 'https://user:password@research.example', 'https://localhost/', 'https://private.example/'):
            with self.subTest(url=url), self.assertRaises(Invalid): fetch(url)
        for key in ('token', 'access_token', 'api_key', 'X-Amz-Signature', 'x-goog-signature', '%74oken'):
            with self.subTest(key=key), self.assertRaisesRegex(Invalid, 'Credential-bearing') as error:
                fetch(SEED + '?' + key + '=never-echo-this-secret')
            self.assertNotIn('never-echo', str(error.exception))
        with self.assertRaisesRegex(Invalid, 'Credential-bearing'):
            ResearchResource.linked(SEED + '#access_token=never-echo-this-secret', SEED)
        replies.append(response(status=302, Location=SEED + '?access_token=never-echo-this-secret'))
        with self.assertRaisesRegex(Invalid, 'Credential-bearing'): fetch(SEED)
        replies.append(response(status=302, Location='https://private.example/secret'))
        with self.assertRaisesRegex(Invalid, 'Private'): fetch(SEED)
        replies.append(response(b'12345'))
        with self.assertRaisesRegex(Invalid, 'byte limit'): fetch(SEED, limit=4)
        replies.append(response(**{'Content-Type': 'application/octet-stream'}))
        with self.assertRaisesRegex(Invalid, 'binary'): fetch(SEED)
        replies.extend(response(status=302, Location=SEED) for _ in range(4))
        with self.assertRaisesRegex(Invalid, 'redirects'): fetch(SEED)

    def test_html_keeps_raw_bytes_and_rejects_redirects_before_following(self):
        opened, replies = [], []
        class Connection:
            def __init__(self, host, address, timeout):
                opened.append((host, address)); self.sock = None
            def request(self, *_args, **_kwargs): pass
            def getresponse(self): return replies.pop(0)
            def close(self): pass
        def response(body=b'<html>\xff</html>', status=200, **headers):
            value = io.BytesIO(body); value.status = status
            fields = {'Content-Type': 'text/html', **headers}
            value.getheader = lambda key, default=None: fields.get(key, default)
            return value
        def resolver(host, *_args, **_kwargs):
            return [(None, None, None, None, ('127.0.0.1' if host == 'private.example' else '93.184.216.34', 443))]
        transport = PublicMetadata(resolver, Connection)
        url = 'https://arxiv.org/html/2310.10688v2'
        replies.append(response())
        result = transport.fetch_html(url)
        self.assertEqual((result.url, result.mime, result.data), (url, 'text/html', b'<html>\xff</html>'))
        for reply, message in (
                (response(status=302, Location='https://private.example/secret'), 'redirects'),
                (response(status=302, Location='https://arxiv.org/html/2310.10688v3'), 'redirects'),
                (response(status=206), 'HTTP 206'),
                (response(**{'Content-Type': 'text/plain'}), 'text/html'),
                (response(**{'Content-Encoding': 'gzip'}), 'Compressed'),
                (response(**{'Content-Length': '19'}), 'Incomplete'),
                (response(b'x' * 21), 'byte limit')):
            replies.append(reply); before = len(opened)
            with self.subTest(message=message), self.assertRaisesRegex(Invalid, message):
                transport.fetch_html(url, limit=20)
            self.assertEqual(len(opened), before + 1)
        with self.assertRaisesRegex(Invalid, 'Private'):
            transport.fetch_html('https://private.example/')

    def test_inspection_classifies_explicit_metadata_and_keeps_partial_results(self):
        urls = []
        html = '''<html><head><meta property="og:title" content="Synthetic release"><meta name="author" content="Researcher"></head>
        <body><nav><a href="https://github.com/unrelated/nav">Code</a></nav><main><h1>Synthetic release</h1>
        <p>This is not an instruction.</p><a href="https://github.com/example/code">Code</a>
        <a href="https://huggingface.co/example/model">Weights</a><h2>Benchmarks</h2>
        <a href="https://huggingface.co/spaces/example/eval">Gift-Eval</a></main></body></html>'''
        def fetch(url, **_kwargs):
            urls.append(url)
            if url == SEED: return WebDocument(url, 'text/html', html)
            if '/api/models/' in url:
                body = {'id': 'example/model', 'sha': REV, 'cardData': {'license': 'non-commercial'}, 'tags': ['arxiv:2310.10688'],
                        'siblings': [{'rfilename': 'subdir/weights.safetensors', 'lfs': {'sha256': SHA, 'size': 4}}]}
            elif '/api/spaces/' in url:
                body = {'id': 'example/eval', 'sha': REV, 'cardData': {}}
            elif 'api.github.com' in url:
                body = {'full_name': 'example/code', 'license': {'spdx_id': 'Apache-2.0'}}
            else: raise Invalid('Synthetic metadata unavailable')
            return WebDocument(url, 'application/json', json.dumps(body))
        result = ResourceInspector(fetch).inspect(ImportDraft.create(SEED, NOW), threading.Event())
        self.assertEqual(result.status, 'ready')
        self.assertEqual({r.kind for r in result.resources}, {'web_article', 'model', 'code', 'benchmark', 'paper'})
        model = next(r for r in result.resources if r.kind == 'model')
        self.assertEqual((model.license, model.assets[0].size, model.assets[0].filename), ('non-commercial', 4, 'weights.safetensors'))
        paper = next(r for r in result.resources if r.kind == 'paper')
        self.assertEqual(paper.relation, 'cites')
        self.assertTrue(paper.unresolved)
        self.assertFalse(any('unrelated' in url for url in urls))
        self.assertLessEqual(len(urls), 18)

    def test_github_commit_is_source_observed_and_identity_checked(self):
        for repository, commit, branch, expected in (
            ('example/code', {'sha': REV, 'html_url': 'https://github.com/example/code/commit/' + REV}, 'feature/research', REV),
            ('other/code', {'sha': REV, 'html_url': 'https://github.com/other/code/commit/' + REV}, 'main', None),
            ('example/code', {'sha': REV[:7], 'html_url': 'https://github.com/example/code/commit/' + REV[:7]}, 'main', None),
            ('example/code', {'sha': REV, 'html_url': 'https://github.com/other/code/commit/' + REV}, 'main', None),
            ('example/code', None, 'main', None),
            ('example/code', {'sha': REV}, None, None),
        ):
            calls = []
            def fetch(url, **_kwargs):
                calls.append(url)
                if '/commits/' in url:
                    if commit is None:
                        raise Invalid('Metadata unavailable')
                    return WebDocument(url, 'application/json', json.dumps(commit))
                return WebDocument(url, 'application/json', json.dumps({
                    'full_name': repository, 'default_branch': branch, 'license': {'spdx_id': 'MIT'}}))
            result = ResourceInspector(fetch).inspect(ImportDraft.create('https://github.com/example/code', NOW), threading.Event())
            code = next(r for r in result.resources if r.kind == 'code')
            self.assertEqual(code.revision, expected)
            if expected:
                self.assertIn('https://api.github.com/repos/example/code/commits/feature%2Fresearch', calls)
                self.assertTrue(any('/commits/' in evidence.url for evidence in code.evidence))
            else:
                self.assertTrue(code.unresolved)

    def test_malformed_metadata_is_partial_and_redirect_identity_reuses(self):
        final = 'https://canonical.example/release'
        def fetch(url, **_kwargs):
            if 'github' in url:
                return WebDocument(url, 'application/json', 'not valid JSON')
            html = '<meta name><meta property="og:title" content="' + 'T' * 1200 + '"><meta name="author" content="' + 'A' * 500 + '"><main><p>Article excerpt.</p><a href="https://github.com/example/repo">Code</a></main>'
            return WebDocument(final, 'text/html', html)
        inspector = ResourceInspector(fetch)
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            for seed in (SEED, final):
                draft = inspector.inspect(ImportDraft.create(seed, NOW), threading.Event())
                self.assertEqual(draft.status, 'ready')
                self.assertTrue(next(r for r in draft.resources if r.kind == 'code').unresolved)
                store.imports._replace('import-drafts', draft.id, draft.to_dict())
                store.imports.commit(dict(draftId=draft.id, resourceIds=[r.id for r in draft.resources]), NOW)
            self.assertEqual(len(store.library()['papers']), 1)
            self.assertEqual(len(store.library()['bundles']), 1)
            self.assertEqual(len(store.library()['papers'][0]['title']), 1000)
            self.assertEqual(len(store.library()['papers'][0]['authors'][0]), 300)

    def test_worker_deadline_cancel_and_parent_loss_release_process(self):
        draft = ImportDraft.create(SEED, NOW)
        before = {p.pid for p in multiprocessing.active_children()}
        started = time.monotonic()
        result = inspect_bounded(draft, StalledInspector(), threading.Event(), seconds=0.4)
        self.assertEqual(result.status, 'failed')
        self.assertLess(time.monotonic() - started, 3)
        cancelled = threading.Event(); cancelled.set()
        self.assertEqual(inspect_bounded(draft, StalledInspector(), cancelled, seconds=5).status, 'cancelled')
        self.assertEqual({p.pid for p in multiprocessing.active_children()}, before)
        context = multiprocessing.get_context('spawn')
        output, child_output = context.Pipe(duplex=False)
        observed = context.Event()
        cancellation = context.Event()
        parent = context.Process(target=orphan_parent, args=(child_output, observed, cancellation))
        parent.start(); child_output.close()
        try:
            self.assertTrue(observed.wait(5))
            parent.join(timeout=5)
            self.assertFalse(parent.is_alive())
            self.assertTrue(output.poll(5), 'Orphan metadata process must close its pipe')
            with self.assertRaises(EOFError): output.recv_bytes()
        finally:
            if parent.is_alive(): parent.kill(); parent.join()
            parent.close(); output.close()


    @unittest.skipUnless(sys.platform == 'win32', 'Windows process-handle lifecycle evidence runs on hosted Windows')
    def test_worker_force_killed_parent_exits_actual_windows_child_handle(self):
        import ctypes
        from ctypes import wintypes
        context = multiprocessing.get_context('spawn')
        output, child_output = context.Pipe(duplex=False)
        identity, child_identity = context.Pipe(duplex=False)
        started, cancelled = context.Event(), context.Event()
        parent = context.Process(target=parent_waiting_for_force_kill,
                                 args=(child_output, started, cancelled, child_identity))
        parent.start(); child_output.close(); child_identity.close()
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = None
        try:
            self.assertTrue(identity.poll(5))
            child_pid = identity.recv()
            self.assertTrue(started.wait(5))
            handle = kernel.OpenProcess(0x00100000, False, child_pid)  # SYNCHRONIZE, no inherited fake PID check.
            self.assertTrue(handle)
            parent.kill(); parent.join(timeout=5)
            self.assertFalse(parent.is_alive())
            self.assertEqual(kernel.WaitForSingleObject(handle, 5000), 0, 'Metadata child must terminate after actual parent handle is signaled')
        finally:
            cancelled.set()
            if parent.is_alive(): parent.kill(); parent.join()
            if handle: kernel.CloseHandle(handle)
            parent.close(); output.close(); identity.close()


class ImportPersistenceTest(unittest.TestCase):
    def test_html_grants_persist_independently_without_changing_legacy_bundle_bytes(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            paper = ResearchResource.linked('https://arxiv.org/abs/2310.10688v1', SEED)
            source = ResearchResource.linked('https://arxiv.org/src/2310.10688v1', SEED)
            draft = ImportDraft.create(SEED, NOW).finish((paper, source), ())
            store.imports._replace('import-drafts', draft.id, draft.to_dict())
            body = dict(draftId=draft.id, resourceIds=[paper.id, source.id])
            legacy = store.imports.commit(body, NOW)
            before = canonical(legacy.to_dict())
            self.assertNotIn('htmlDownloadIds', legacy.to_dict())
            self.assertEqual(canonical(ResearchBundle.from_record(json.loads(before)).to_dict()), before)
            self.assertEqual(store.imports.commit(body, 'later'), legacy)
            with self.assertRaisesRegex(Invalid, 'independently confirmed'):
                store.imports.approved_html(legacy.id, paper.id)
            source_only = store.imports.commit(dict(body, sourceIds=[source.id], confirmedDownloads=True), NOW)
            self.assertEqual(store.imports.approved_source(source_only.id, source.id), source)
            with self.assertRaisesRegex(Invalid, 'independently confirmed'):
                store.imports.approved_html(source_only.id, paper.id)
            granted = store.imports.commit(dict(body, htmlIds=[paper.id], confirmedDownloads=True), NOW)
            self.assertEqual(granted.htmlDownloadIds, (paper.id,))
            reopened = ResearchStore(root)
            self.assertEqual(reopened.imports.approved_html(granted.id, paper.id), paper)
            self.assertEqual(reopened.imports.approved_source(granted.id, source.id), source)
            self.assertEqual(reopened.imports.commit(dict(body, htmlIds=[paper.id], confirmedDownloads=True), 'later'), granted)
            newer = ResearchResource.linked('https://arxiv.org/abs/2310.10688v2', SEED)
            self.assertEqual(newer.id, paper.id)
            updated_draft = replace(draft, resources=(newer, source))
            reopened.imports._replace('import-drafts', draft.id, updated_draft.to_dict())
            updated = reopened.imports.commit(body, 'later')
            self.assertEqual(updated.htmlDownloadIds, ())
            self.assertNotIn('htmlDownloadIds', updated.to_dict())
            with self.assertRaisesRegex(Invalid, 'independently confirmed'):
                reopened.imports.approved_html(updated.id, newer.id)
            approved_new = reopened.imports.commit(dict(body, htmlIds=[newer.id], confirmedDownloads=True), 'later')
            self.assertEqual(OfficialHtml.from_resource(reopened.imports.approved_html(approved_new.id, newer.id)).url,
                             'https://arxiv.org/html/2310.10688v2')
            # The old immutable bundle record still replays its own v1 authority.
            frozen = ResearchBundle.from_record(granted.to_dict())
            self.assertEqual(frozen, granted)
            self.assertEqual(OfficialHtml.from_resource(frozen.approved_html(paper.id)).revision, 'v1')

    def test_reimport_restart_snapshots_and_download_handoff(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            article, model = resource_fixture()
            draft = ImportDraft.create(SEED, NOW).finish((article, model), ())
            store.imports._replace('import-drafts', draft.id, draft.to_dict())
            body = dict(draftId=draft.id, resourceIds=[article.id, model.id])
            bundle = store.imports.commit(body, NOW)
            self.assertEqual(bundle.downloadIds, ())
            self.assertEqual(len(store.library()['papers']), 1)
            self.assertEqual(store.library()['papers'][0]['resourceKind'], 'web_article')
            original_snapshot = store.paper(bundle.resources[0].paperId).to_dict()
            self.assertEqual(store.imports.commit(body, '2026-11-02T00:00:00Z'), bundle)
            with self.assertRaisesRegex(Invalid, 'not explicitly confirmed'):
                store.imports.handoff(dict(bundleId=bundle.id, assetId=model.assets[0].id))
            approved = store.imports.commit({**body, 'downloadIds': [model.assets[0].id], 'confirmedDownloads': True}, NOW)
            handoff = store.imports.handoff(dict(bundleId=approved.id, assetId=model.assets[0].id))
            self.assertEqual((handoff['sha256'], handoff['bundleId']), (SHA, approved.id))
            restored = ResearchStore(root)
            self.assertEqual(restored.imports.bundle(bundle.id), approved)
            self.assertEqual(restored.paper(bundle.resources[0].paperId).to_dict(), original_snapshot)
            self.assertEqual(len(restored.library()['bundles']), 1)
            self.assertEqual(list((Path(root) / 'research-v1').glob('**/*.part')), [])

    def test_alias_equivalent_snapshot_reuse_and_sequential_versions(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            first = replace(ResearchResource.linked('https://openalex.org/W123', SEED),
                            aliases=('doi:10.1234/example',), excerpt='One source abstract.', contentKind='abstract')
            doi = replace(ResearchResource.linked('https://doi.org/10.1234/example', SEED),
                          excerpt='One source abstract.', contentKind='abstract')
            draft = ImportDraft.create(first.url, NOW).finish((first, doi), ())
            store.imports._replace('import-drafts', draft.id, draft.to_dict())
            bundle = store.imports.commit(dict(draftId=draft.id, resourceIds=[first.id, doi.id]), NOW)
            self.assertEqual(len(bundle.resources), 1)
            self.assertEqual(len(store.library()['papers']), 1)
            original = store.paper(bundle.resources[0].paperId).to_dict()
            doi_draft = ImportDraft.create(doi.url, NOW).finish((doi,), ())
            store.imports._replace('import-drafts', doi_draft.id, doi_draft.to_dict())
            same = store.imports.commit(dict(draftId=doi_draft.id, resourceIds=[doi.id]), NOW)
            self.assertEqual(same.id, bundle.id)
            self.assertEqual(len(store.library()['papers']), 1)
            self.assertEqual(store.paper(bundle.resources[0].paperId).to_dict(), original)
            prior = None
            for version in ('v1', 'v2'):
                resource = replace(ResearchResource.linked('https://arxiv.org/abs/2310.10688' + version, SEED),
                                   excerpt='Version ' + version, contentKind='abstract')
                observed = ImportDraft.create(resource.originalUrl, NOW).finish((resource,), ())
                store.imports._replace('import-drafts', observed.id, observed.to_dict())
                # A ready v1 draft does not suppress a subsequent requested v2 observation.
                self.assertEqual(store.imports.inspect({'url': resource.originalUrl}, NOW).id, observed.id)
                updated = store.imports.commit(dict(draftId=observed.id, resourceIds=[resource.id]), NOW)
                self.assertEqual(updated.resources[0].revision, version)
                self.assertEqual(store.paper(updated.resources[0].paperId).source_revision, version)
                if prior:
                    self.assertEqual(updated.id, prior.id)
                    self.assertNotEqual(updated.resources[0].paperId, prior.resources[0].paperId)
                prior = updated
            self.assertEqual(len(store.library()['papers']), 3)
            self.assertEqual(len(store.library()['bundles']), 2)

    def test_authenticated_short_http_inspect_commit_cancel(self):
        from paper_agent.http import handler
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root); store.imports.inspector = FixtureInspector()
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler(store, 'token', now=lambda: NOW))
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            def call(path, body, token='token'):
                connection = HTTPConnection('127.0.0.1', server.server_port, timeout=3)
                connection.request('POST', path, json.dumps(body), {'Content-Type': 'application/json', 'X-Pero-App-Token': token})
                response = connection.getresponse(); result = (response.status, json.loads(response.read())); connection.close(); return result
            try:
                self.assertEqual(call('/api/research/inspect', {'url': SEED}, 'wrong')[0], 401)
                status, draft = call('/api/research/inspect', {'url': SEED})
                self.assertEqual(status, 200)
                running = store.imports.running.get(draft['id'])
                if running: running[1].join(timeout=5)
                status, draft = call('/api/research/inspect', {'draftId': draft['id']})
                self.assertEqual(draft['status'], 'ready', draft)
                status, bundle = call('/api/research/commit', {'draftId': draft['id'], 'resourceIds': [r['id'] for r in draft['resources']]})
                self.assertEqual(status, 201)
                self.assertEqual(bundle['downloadIds'], [])
                self.assertEqual(call('/api/research/handoff', {'bundleId': bundle['id'], 'assetId': draft['resources'][1]['assets'][0]['id']})[0], 403)
                self.assertEqual(call('/api/research/inspect', {'url': SEED})[1]['id'], draft['id'])
                self.assertEqual(call('/api/research/inspect', {'url': SEED, 'refresh': True})[1]['status'], 'inspecting')
                worker = store.imports.running.get(draft['id'])
                if worker: worker[1].join(timeout=5)
                self.assertEqual(len(store.library()['bundles']), 1)
                store.imports.inspector = StalledInspector()
                _, waiting = call('/api/research/inspect', {'url': 'https://research.example/another'})
                self.assertEqual(call('/api/research/inspect', {'draftId': waiting['id'], 'cancel': True})[1]['status'], 'cancelled')
            finally:
                store.imports.close(); server.shutdown(); thread.join(timeout=3); server.server_close()
