"""Deterministic JSON CLI acceptance using its injected-store composition seam.

The cached restart check invokes the actual executable in a fresh process.
No provider, TeX compiler or external network is used.
"""
import argparse
import importlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'apps/paper-agent/backend'), str(ROOT / 'tests/fixtures')]
fixture = importlib.import_module('research-source')
from paper_agent.store import ResearchStore
CLI = ROOT / 'apps/paper-agent/tools/research.py'
spec = importlib.util.spec_from_file_location('paper_research_cli', CLI)
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    options = parser.parse_args()
    checks = []
    with tempfile.TemporaryDirectory(prefix='pero-source-cli-') as directory:
        os.environ['PERO_APP_DATA'] = directory
        store = ResearchStore(directory)
        fixture.install(store)

        def invoke(action, body, code=0):
            output = io.StringIO()
            result_code = cli.main([], store=store, stdin=io.StringIO(json.dumps(dict(action=action, input=body))), stdout=output)
            result = json.loads(output.getvalue())
            assert result_code == code and result['code'] == code, result
            assert result['ok'] is (code == 0)
            return result.get('result', result)

        def inspect(seed):
            draft = invoke('inspect', {'url': seed})
            assert draft['status'] == 'ready'
            selection = dict(draftId=draft['id'], resourceIds=[r['id'] for r in draft['resources']])
            return draft, selection

        try:
            draft, selection = inspect(fixture.HAPPY_SEED)
            source = next(r for r in draft['resources'] if r['kind'] == 'source_archive')
            bundle = invoke('commit', selection)
            request = dict(bundleId=bundle['id'], resourceId=source['id'])
            invoke('source', {**request, 'operation': 'start'}, code=3)
            bundle = invoke('commit', {**selection, 'sourceIds': [source['id']], 'confirmedDownloads': True})
            result = invoke('source', {**request, 'operation': 'start'})
            assert result['status'] == 'source_available' and result['receipt'], result
            receipt = result['receipt']
            assert invoke('source', {**request, 'operation': 'start'})['receipt'] == receipt
            catalog = invoke('source-read', {**request, 'operation': 'list'})
            tex = next(m for m in catalog['members'] if m['path'] == 'main.tex')
            read = invoke('source-read', {**request, 'operation': 'read', 'memberId': tex['id'], 'startLine': 1, 'endLine': 5})
            assert read['archiveDigest'] == receipt['archiveDigest'] and read['memberDigest'] == tex['sha256']
            assert read['startLine'] == 1 and read['endLine'] == 5
            exported = invoke('export', {'bundleId': bundle['id']})
            assert exported['schema'] == 'pero.research-evidence.v1'
            assert 'members' not in exported and 'content' not in exported
            index = exported['sourceIndexes'][0]
            assert index['archiveDigest'] == receipt['archiveDigest']
            indexed_tex = next(member for member in index['members'] if member['id'] == tex['id'])
            assert indexed_tex['sha256'] == tex['sha256'] and indexed_tex['structures']
            assert all(set(anchor) <= {'kind', 'start', 'end', 'startLine', 'endLine'} for anchor in indexed_tex['structures'])
            assert all('caption' not in member and 'data' not in member and 'content' not in member for member in index['members'])
            log = Path(directory) / 'source-fixture-requests.jsonl'
            assert not any(json.loads(line)['kind'] == 'pdf' for line in log.read_text().splitlines())
            checks.append('JSON stdin/out, permission code 3, source-only start waits to terminal, member lines and receipt-only export')
            invoke('not-a-command', {}, code=2)
            failed_draft, failed_selection = inspect(fixture.SEED)
            failed_sources = [r for r in failed_draft['resources'] if r['kind'] == 'source_archive']
            failure = next(r for r in failed_sources if r['originalUrl'] == fixture.SOURCE_URLS[0])
            cancel = next(r for r in failed_sources if r['originalUrl'] == fixture.SOURCE_URLS[1])
            pdf_only = next(r for r in failed_sources if r['originalUrl'] == fixture.SOURCE_URLS[2])
            failed_bundle = invoke('commit', {**failed_selection, 'sourceIds': [failure['id'], cancel['id'], pdf_only['id']], 'confirmedDownloads': True})
            failed_request = dict(bundleId=failed_bundle['id'], resourceId=failure['id'])
            result = invoke('source', {**failed_request, 'operation': 'start'}, code=5)
            assert result['status'] == 'failed' and result['receipt'] is None
            assert invoke('source', {**failed_request, 'operation': 'start'})['status'] == 'source_available'
            cancel_request = dict(bundleId=failed_bundle['id'], resourceId=cancel['id'])
            captured = {}
            def blocked_start():
                try:
                    captured['reply'] = invoke('source', {**cancel_request, 'operation': 'start'}, code=6)
                except BaseException as error:
                    captured['error'] = error
            worker = threading.Thread(target=blocked_start)
            worker.start()
            deadline = time.monotonic() + 10
            while not any(json.loads(line)['url'] == cancel['originalUrl'] for line in log.read_text().splitlines()):
                if time.monotonic() >= deadline:
                    raise AssertionError('CLI source child did not reach the observable fixture request')
                threading.Event().wait(0.05)
            # Two callers share the explicit test composition only, not concurrent production CLI caches.
            cancelled = store.source_downloads.request({**cancel_request, 'operation': 'cancel'})
            worker.join(10)
            assert not worker.is_alive(), cancelled
            if 'error' in captured:
                raise captured['error']
            assert captured['reply']['status'] == 'cancelled'
            recovered = invoke('source', {**cancel_request, 'operation': 'start'})
            assert recovered['status'] == 'source_available' and recovered['receipt']['texCount'] == 1
            pdf_reply = invoke('source', dict(bundleId=failed_bundle['id'], resourceId=pdf_only['id'], operation='start'))
            assert pdf_reply['status'] == 'pdf_only' and pdf_reply['receipt']['texCount'] == 0
            checks.append('Cancelled source retries to gzip single TeX; PDF-only source response records zero TeX rather than invented source')
            checks.append('Stable invalid/failure/cancellation exit codes; failure retries only after another explicit start')
        finally:
            store.source_downloads.close()
            store.pdf_downloads.close()
            store.imports.close()
        # Exact production executable and cache argument, after shutting down the injected composition.
        command = [sys.executable, str(CLI), '--cache', directory]
        cached = subprocess.run(command, input=json.dumps(dict(action='source', input={**request, 'operation': 'start'})), text=True, capture_output=True, timeout=15)
        assert cached.returncode == 0, cached.stderr or cached.stdout
        assert json.loads(cached.stdout)['result']['receipt'] == receipt
        invalid = subprocess.run(command, input='not-json', text=True, capture_output=True, timeout=15)
        assert invalid.returncode == 2 and json.loads(invalid.stdout)['code'] == 2
        empty = subprocess.run([sys.executable, str(CLI), '--cache', str(Path(directory) / 'separate-cache')],
            input=json.dumps(dict(action='export', input={'bundleId': bundle['id']})), text=True, capture_output=True, timeout=15)
        assert empty.returncode == 4 and json.loads(empty.stdout)['code'] == 4
        checks.append('Actual executable cached restart reuses bytes; malformed JSON returns 2; separate cache cannot access prior bundle')
        options.output.parent.mkdir(parents=True, exist_ok=True)
        options.output.write_text(json.dumps(dict(outcome='passed', checks=checks, receipt=receipt,
            scope='Deterministic CLI, same Paper core; synthetic network only, no Host/GUI/model/compilation'), indent=2) + '\n')
        print(json.dumps(dict(outcome='passed', checks=checks)))


if __name__ == '__main__':
    main()
