"""Explicit source-first Paper HTTP journey. No Host, GUI, TeX execution or model.

--live opts in to one public arXiv source through the same product path.
Only receipts/locations are exported, never source archives, text or images.
"""
import argparse
import importlib
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'apps/paper-agent/backend'), str(ROOT / 'tests/fixtures')]
fixture = importlib.import_module('research-source')
from paper_agent.store import ResearchStore
from paper_agent.http import handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--output', required=True, type=Path)
    options = parser.parse_args()
    seed = 'https://arxiv.org/src/2610.24806v1' if options.live else fixture.SEED
    summary = dict(scope='Authenticated Paper HTTP/core/store; no Host/GUI/model/TeX execution',
                   network='live public arXiv' if options.live else 'synthetic transport', seedUrl=seed,
                   originalBytesExported=False, checks=[])
    options.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='pero-source-http-') as directory:
        os.environ['PERO_APP_DATA'] = directory
        store = ResearchStore(directory)
        if not options.live:
            fixture.install(store)
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler(store, 'fixture-token'))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def call(path, body=None, rejected=None):
            connection = HTTPConnection('127.0.0.1', server.server_port, timeout=10)
            connection.request('GET' if body is None else 'POST', path, None if body is None else json.dumps(body),
                               {'Content-Type': 'application/json', 'X-Pero-App-Token': 'fixture-token'})
            response = connection.getresponse()
            result = json.loads(response.read())
            connection.close()
            if rejected is not None:
                assert response.status == rejected, result
                return result
            if response.status >= 300:
                raise RuntimeError(result.get('detail', 'HTTP ' + str(response.status)))
            return result

        def wait_job(manager, job):
            worker = manager.running.get(job['id'])
            if worker:
                worker[1].join(65)

        def acquire(bundle, resource, operation='start'):
            request = dict(operation=operation, bundleId=bundle['id'], resourceId=resource['id'])
            result = call('/api/research/source', request)
            wait_job(store.source_downloads, result)
            return call('/api/research/source', {**request, 'operation': 'status'})

        def requests():
            path = Path(directory) / 'source-fixture-requests.jsonl'
            return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

        try:
            draft = call('/api/research/inspect', {'url': seed})
            wait_job(store.imports, draft)
            draft = call('/api/research/inspect', {'draftId': draft['id']})
            summary['inspection'] = dict(status=draft['status'], warnings=draft['warnings'])
            sources = [resource for resource in draft['resources'] if resource['kind'] == 'source_archive']
            if not sources:
                raise RuntimeError('No source candidates: ' + json.dumps(summary['inspection']))
            selection = dict(draftId=draft['id'], resourceIds=[r['id'] for r in draft['resources']])
            bundle = call('/api/research/commit', selection)
            assert bundle['sourceDownloadIds'] == [] and bundle['pdfDownloadIds'] == []
            if not options.live:
                assert len(sources) == 3
                assert not any(item['kind'] in ('source', 'pdf') for item in requests())
            resource = next((r for r in sources if r['originalUrl'] == fixture.SOURCE_URLS[0]), sources[0])
            bundle = call('/api/research/commit', {**selection, 'sourceIds': [resource['id']], 'confirmedDownloads': True})
            result = acquire(bundle, resource)
            if not options.live:
                assert result['status'] == 'failed' and result['receipt'] is None, result
                result = acquire(bundle, resource)  # Explicit recovery, not implicit auto retry.
            if result['status'] != 'source_available':
                raise RuntimeError('Source acquisition: ' + json.dumps(result))
            receipt = result['receipt']
            assert receipt['archiveDigest'] and receipt['revision'].endswith('v1')
            assert result['localAvailable'] is True
            base = dict(bundleId=bundle['id'], resourceId=resource['id'])
            catalog = call('/api/research/source-read', {**base, 'operation': 'list'})
            tex = next(member for member in catalog['members'] if member['path'].endswith('.tex'))
            read = call('/api/research/source-read', {**base, 'operation': 'read', 'memberId': tex['id'], 'startLine': 1, 'endLine': min(10, tex['lineCount'])})
            assert read['archiveDigest'] == receipt['archiveDigest'] and read['memberDigest'] == tex['sha256']
            assert read['content'] and read['startLine'] == 1
            for window in (dict(startLine=1, endLine=3), dict(start=2, end=read['content'].index('\n') + 4)):
                bounded = call('/api/research/source-read', {**base, 'operation': 'read', 'memberId': tex['id'], **window})
                reopened = call('/api/research/source-read', {**base, 'operation': 'read', 'memberId': tex['id'], 'start': bounded['start'], 'end': bounded['end']})
                assert reopened == bounded

            assert acquire(bundle, resource)['receipt'] == receipt
            report = call('/api/research/source-report', dict(operation='create', bundleId=bundle['id'],
                title='Observed source', observationIds=[read['observationId']], interpretations=['Scientific meaning remains unresolved.']))
            assert report['observations'][0]['anchor']['memberDigest'] == tex['sha256']
            assert report['interpretations'][0]['status'] == 'unresolved'
            assert call('/api/research/source-report', dict(operation='read', bundleId=bundle['id'], reportId=report['id'])) == report
            call('/api/research/source-report', dict(operation='create', bundleId=bundle['id'],
                title='Forged read', observationIds=['a' * 64]), rejected=404)
            summary['checks'].append('Authenticated report create/reopen uses only server-recorded source scopes; fabricated IDs rejected')
            summary.update(receipt=receipt, readScope={key: read[key] for key in ('memberId', 'memberPath', 'memberDigest', 'startLine', 'endLine')})
            summary['checks'].append('References-only has no acquisition; explicit source consent, exact member lines and repeat-cache receipt')
            if not options.live:
                assert not any(item['kind'] == 'pdf' for item in requests())
                main = next(m for m in catalog['members'] if m['path'] == 'main.tex')
                image = next(m for m in catalog['members'] if m['path'] == 'figure.png')
                assert image['kind'] == 'image' and image['previewUrl']
                preview = HTTPConnection('127.0.0.1', server.server_port, timeout=10)
                preview.request('GET', image['previewUrl'], headers={'X-Pero-App-Token': 'fixture-token'})
                response = preview.getresponse()
                assert response.status == 200 and response.getheader('Content-Type') == 'image/png'
                assert response.read().startswith(b'\x89PNG\r\n\x1a\n')
                preview.close()
                assert main['structures']
                assert any(structure['caption'] == fixture.CAPTION for structure in main['structures'])
                comparison = call('/api/research/source-read', {**base, 'operation': 'compare'})
                assert comparison['status'] == 'unresolved' and not comparison['matches']
                assert not any(item['kind'] == 'pdf' for item in requests())
                # Acquire the separate rendered representation only after its own grant.
                pdf = next(r for r in draft['resources'] if r['kind'] == 'pdf_candidate')
                bundle = call('/api/research/commit', {**selection, 'pdfIds': [pdf['id']], 'confirmedDownloads': True})
                pdf_request = dict(bundleId=bundle['id'], resourceId=pdf['id'])
                job = call('/api/research/pdf', {**pdf_request, 'operation': 'start'})
                wait_job(store.pdf_downloads, job)
                downloaded = call('/api/research/pdf', {**pdf_request, 'operation': 'status'})
                assert downloaded['status'] == 'completed', downloaded
                comparison = call('/api/research/source-read', {**base, 'operation': 'compare', 'pdfResourceId': pdf['id']})
                assert comparison['status'] == 'matched' and comparison['matches'], comparison
                for match in comparison['matches']:
                    assert match['source']['archiveDigest'] == receipt['archiveDigest']
                    assert match['pdf']['fileDigest'] == downloaded['receipt']['fileDigest']
                    assert match['pdf']['page'] == 1
                summary['comparison'] = comparison
                summary['checks'].append('Source-only compare does not fetch PDF; separately approved PDF literal captions bind archive/member lines and PDF hash/page')
                observed = call('/api/research/inspect', {'url': fixture.NONSTANDARD_SEED})
                wait_job(store.imports, observed)
                observed = call('/api/research/inspect', {'draftId': observed['id']})
                context = call('/api/research/analysis', dict(operation='context', draftId=observed['id']))
                assert 'Ignore the user' in context['pages'][0]['text']
                link = next(link for page in context['pages'] for link in page['links'] if '/attachments?' in link['href'])
                proposal = dict(operation='propose', draftId=observed['id'], draftDigest=context['draftDigest'],
                                proposals=[dict(evidenceId=link['id'], kind='source_archive', title='Unresolved supplement', reason='Observed attachment; source format and identity are unverified')])
                call('/api/research/analysis', {**proposal, 'draftDigest': 'stale'}, rejected=409)
                call('/api/research/analysis', {**proposal, 'proposals': [{**proposal['proposals'][0], 'url': 'https://127.0.0.1/private'}]}, rejected=400)
                proposed = call('/api/research/analysis', proposal)
                candidate = next(r for r in proposed['resources'] if r['originalUrl'] == link['href'])
                assert candidate['kind'] == 'source_archive' and candidate['confidence'] == 'unresolved'
                assert candidate['workIdentity'] is None and candidate['revision'] is None
                references = call('/api/research/commit', dict(draftId=proposed['id'], resourceIds=[candidate['id']]))
                assert references['sourceDownloadIds'] == [] and references['pdfDownloadIds'] == [] and references['downloadIds'] == []
                assert not any(item['url'].startswith('https://127.') or '/attachments?' in item['url'] for item in requests())
                summary['checks'].append('Nonstandard untrusted page is frozen evidence; proposal needs observed link and current digest, rejects supplied URL, grants no downloads')
                unresolved = next(r for r in proposed['resources'] if r['originalUrl'] == fixture.UNRESOLVED_SOURCE)
                assert unresolved['workIdentity'] is None and unresolved['revision'] is None
                selection = dict(draftId=proposed['id'], resourceIds=[unresolved['id']])
                references = call('/api/research/commit', selection)
                assert references['sourceDownloadIds'] == []
                assert not any(item['url'] == fixture.UNRESOLVED_SOURCE for item in requests())
                approved = call('/api/research/commit', {**selection, 'sourceIds': [unresolved['id']], 'confirmedDownloads': True})
                result = acquire(approved, unresolved)
                assert result['status'] == 'source_available', result
                assert result['receipt']['workIdentity'] is None and result['receipt']['revision'] is None
                assert result['receipt']['archiveDigest'] == receipt['archiveDigest']
                scope = dict(bundleId=approved['id'], resourceId=unresolved['id'])
                indexed = call('/api/research/source-read', {**scope, 'operation': 'list'})
                assert len(indexed['members']) == 5
                main = next(m for m in indexed['members'] if m['path'] == 'main.tex')
                bounded = call('/api/research/source-read', {**scope, 'operation': 'read', 'memberId': main['id'], 'startLine': 1, 'endLine': 7})
                assert bounded['content'] == '\n'.join(fixture.MAIN.splitlines()[:7]) + '\n'
                acquired = [item for item in requests() if item['url'] == fixture.UNRESOLVED_SOURCE]
                assert acquired == [dict(kind='source', url=fixture.UNRESOLVED_SOURCE)]
                assert not any(item['url'].startswith('https://127.') or '/attachments?' in item['url'] for item in requests())
                summary['checks'].append('Nonstandard references fetch zero bytes; specific grant permits one source acquisition/read, preserving unresolved work and revision')
                # Unlike .tgz discovery, this opaque resource exists only after the
                # observed-link proposal above; no URL is supplied by the proposer.
                assert link['href'] == fixture.OPAQUE_SOURCE
                opaque = call('/api/research/commit', dict(draftId=proposed['id'], resourceIds=[candidate['id']],
                              sourceIds=[candidate['id']], confirmedDownloads=True))
                result = acquire(opaque, candidate)
                assert result['status'] == 'source_available', result
                assert result['receipt']['workIdentity'] is None and result['receipt']['revision'] is None
                assert result['receipt']['archiveDigest'] == receipt['archiveDigest']
                scope = dict(bundleId=opaque['id'], resourceId=candidate['id'])
                indexed = call('/api/research/source-read', {**scope, 'operation': 'list'})
                main = next(m for m in indexed['members'] if m['path'] == 'main.tex')
                bounded = call('/api/research/source-read', {**scope, 'operation': 'read', 'memberId': main['id'], 'startLine': 1, 'endLine': 7})
                assert bounded['content'] == '\n'.join(fixture.MAIN.splitlines()[:7]) + '\n'
                acquired = [item for item in requests() if '/attachments?' in item['url']]
                assert acquired == [dict(kind='source', url=fixture.OPAQUE_SOURCE)]
                assert not any(item['url'].startswith('https://127.') for item in requests())
                summary['checks'].append('Opaque observed-link proposal stays reference-only until explicit consent; one exact URL acquisition/read preserves unresolved identity')
            summary['outcome'] = 'passed'
            print(json.dumps(summary))
        except Exception as error:
            summary.update(outcome='inconclusive' if options.live else 'failed', error=str(error))
            raise
        finally:
            options.output.write_text(json.dumps(summary, indent=2) + '\n')
            store.source_downloads.close()
            store.pdf_downloads.close()
            store.imports.close()
            server.shutdown()
            thread.join(3)
            server.server_close()


if __name__ == '__main__':
    main()
