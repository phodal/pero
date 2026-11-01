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
from paper_agent.model import Invalid
from paper_agent.research_resources import ImportDraft, ImportSelection, ResearchAsset, ResearchBundle, ResearchResource, ResourceIdentity
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


class ResourceIdentityTest(unittest.TestCase):
    def test_classification_and_aliases(self):
        cases = [
            ('https://huggingface.co/org/model', 'model', 'hf:model:org/model'),
            ('https://huggingface.co/models/org/model', 'model', 'hf:model:org/model'),
            ('https://huggingface.co/datasets/org/data', 'dataset', 'hf:dataset:org/data'),
            ('https://huggingface.co/spaces/org/demo', 'service', 'hf:service:org/demo'),
            ('https://arxiv.org/pdf/2310.10688v2.pdf', 'paper', 'arxiv:2310.10688'),
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
        review = ImportDraft.create(SEED, NOW).finish((article, model), ())
        body = dict(draftId=review.id, resourceIds=[model.id], downloadIds=[model.assets[0].id])
        with self.assertRaisesRegex(Invalid, 'Confirm'):
            ImportSelection.parse(body, review)
        self.assertEqual(ImportSelection.parse({**body, 'confirmedDownloads': True}, review).downloadIds, (model.assets[0].id,))
        with self.assertRaises(Invalid):
            ImportSelection.parse({**body, 'resourceIds': [article.id], 'confirmedDownloads': True}, review)


class MetadataSafetyTest(unittest.TestCase):
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
        replies.append(response(status=302, Location='https://private.example/secret'))
        with self.assertRaisesRegex(Invalid, 'Private'): fetch(SEED)
        replies.append(response(b'12345'))
        with self.assertRaisesRegex(Invalid, 'byte limit'): fetch(SEED, limit=4)
        replies.append(response(**{'Content-Type': 'application/octet-stream'}))
        with self.assertRaisesRegex(Invalid, 'binary'): fetch(SEED)
        replies.extend(response(status=302, Location=SEED) for _ in range(4))
        with self.assertRaisesRegex(Invalid, 'redirects'): fetch(SEED)

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


class ImportPersistenceTest(unittest.TestCase):
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
                store.imports.inspector = StalledInspector()
                _, waiting = call('/api/research/inspect', {'url': 'https://research.example/another'})
                self.assertEqual(call('/api/research/inspect', {'draftId': waiting['id'], 'cancel': True})[1]['status'], 'cancelled')
            finally:
                store.imports.close(); server.shutdown(); thread.join(timeout=3); server.server_close()
