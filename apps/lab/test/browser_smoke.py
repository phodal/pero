"""Actual browser + App API smoke, NOT Desktop or real-provider acceptance.

Default uses real PyLabRobot. --fixture explicitly substitutes only the executor.
--bundle loads the production AppProvider/frame bundle in a test parent, not Electron.
"""
import argparse
import json
import mimetypes
import os
from pathlib import Path
import re
import sys
import tempfile
import threading
from urllib.parse import urlsplit
from http.server import ThreadingHTTPServer

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP / 'backend'))
sys.path.insert(0, str(APP / 'test'))
import server as api
from experiments import Experiments
from pylabrobot_adapter import PyLabRobotRun, capability
from test_lab import FixtureRun
from playwright.sync_api import sync_playwright, expect


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--fixture', action='store_true')
    parser.add_argument('--bundle', action='store_true')
    parser.add_argument('--artifacts', default='test-results/lab')
    args = parser.parse_args()
    artifacts = Path(args.artifacts).resolve()
    artifacts.mkdir(parents=True, exist_ok=True)
    caps = ({'available': True, 'engine': 'TEST FIXTURE', 'version': 'not-PLR', 'mode': 'simulation'}
            if args.fixture else capability())
    if not caps['available']:
        raise RuntimeError(f'Real engine required: {caps}')
    api.capability = lambda: dict(caps)
    factory = FixtureRun if args.fixture else PyLabRobotRun
    label = 'Browser fixture — not Desktop / not PyLabRobot' if args.fixture else 'Bundled App browser harness — not Desktop'
    entry = '/dist/index.html' if args.bundle else '/preview'
    home = tempfile.TemporaryDirectory()

    def start():
        store = Experiments(home.name, runner_factory=factory)
        backend_handler = api.handler(store, 'browser-test-only')
        class Handler(backend_handler):
            def do_GET(self):
                path = urlsplit(self.path).path
                if path.startswith('/api/'):
                    self.headers['X-Pero-App-Token'] = 'browser-test-only'
                    return super().do_GET()
                if path == '/':
                    content = f'''<!doctype html><html><head><style>body{{margin:0;font:12px system-ui}}aside{{padding:6px 12px;background:#dae2ec;color:#223}}iframe{{width:100%;height:calc(100vh - 30px);border:0}}</style></head><body><aside>{label}</aside><iframe title="Lab" src="{entry}"></iframe><script>
window.addEventListener('message', event => {{
 if(event.data?.type==='pero:app:ready') event.source.postMessage({{type:'pero:app:context',context:{{locale:'en',dark:false,active:true}}}},'*');
 if(event.data?.type==='pero:app:chat') event.source.postMessage({{type:'pero:app:chat-result',id:event.data.id,ok:true,value:{{}}}},'*');
}});</script></body></html>'''.encode()
                    mime = 'text/html'
                elif path == '/preview':
                    content = b'''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui-src/styles.css"></head><body><div id="app"></div><script type="module">
import {mountLab} from '/ui-src/lab.mjs';
async function request(path,body){const response=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Error(value.detail||value.error);return value;}
mountLab(document.querySelector('#app'),{get:request,post:request,ask:()=>{}});
</script></body></html>'''
                    mime = 'text/html'
                else:
                    target = (APP / path.lstrip('/')).resolve()
                    if APP not in target.parents or not target.is_file() or not path.startswith(('/dist/', '/ui-src/')):
                        self.reply(404, {'error': 'Not found'})
                        return
                    content = target.read_bytes()
                    mime = mimetypes.guess_type(target)[0] or 'application/octet-stream'
                self.send_response(200)
                self.send_header('Content-Type', mime + ('; charset=utf-8' if mime.startswith('text/') else ''))
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)

            def do_POST(self):
                # A test-only local proxy replaces Host authentication, explicitly not a Host test.
                self.headers['X-Pero-App-Token'] = 'browser-test-only'
                super().do_POST()
        http = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()
        return store, http, thread

    store, http, thread = start()
    errors = []
    try:
        with sync_playwright() as playwright:
            options = {'headless': True}
            if os.environ.get('PERO_CHROMIUM_PATH'):
                options['executable_path'] = os.environ['PERO_CHROMIUM_PATH']
            browser = playwright.chromium.launch(**options)
            page = browser.new_page(viewport={'width': 1280, 'height': 900}, accept_downloads=True)
            page.on('pageerror', lambda failure: errors.append(str(failure)))
            page.goto(f'http://127.0.0.1:{http.server_port}/')
            frame = page.frame_locator('iframe')
            expect(frame.get_by_role('heading', name='Design your first experiment')).to_be_visible()
            page.screenshot(path=str(artifacts / '01-empty.png'), full_page=True)
            frame.get_by_role('button', name='New experiment', exact=True).last.click()
            frame.get_by_role('button', name='Freeze experiment').click()
            frame.get_by_label('Candidate rationale').fill('Baseline allocation')
            frame.get_by_role('button', name='Save candidate').click()

            def finish_and_evaluate():
                frame.get_by_role('button', name='Run simulation').click()
                expect(frame.locator('select option:checked')).to_contain_text('completed', timeout=30000)
                frame.get_by_role('button', name='Results', exact=True).click()
                frame.get_by_role('button', name='Use synthetic fixture').click()
                frame.get_by_role('button', name='Evaluate', exact=True).click()
            finish_and_evaluate()
            expect(frame.locator('h3 .badge')).to_have_text('FAIL')
            frame.get_by_role('button', name='Revise from this trial').click()
            steps = json.loads(frame.get_by_label('Protocol JSON').input_value())
            for index in (1, 2):
                steps[index]['volume_ul'] = 100 / 0.9
            for index in (5, 6):
                steps[index]['volume_ul'] = 200 - 100 / 0.9
            frame.get_by_label('Protocol JSON').fill(json.dumps(steps, indent=2))
            frame.get_by_label('Candidate rationale').fill('Compensate the disclosed synthetic sensor gain')
            frame.get_by_role('button', name='Save candidate').click()
            finish_and_evaluate()
            expect(frame.locator('h3 .badge')).to_have_text('PASS')
            expect(frame.get_by_text('Lower error.', exact=False)).to_be_visible()
            page.screenshot(path=str(artifacts / '03-results-light.png'), full_page=True)
            frame.get_by_role('button', name='Deck', exact=True).click()
            expect(frame.get_by_role('button', name=re.compile(r'^B1: 200'))).to_be_visible()
            page.screenshot(path=str(artifacts / '02-deck-light.png'), full_page=True)
            frame.get_by_role('button', name='Results', exact=True).click()
            frame.get_by_text('Review decision', exact=True).click()
            frame.get_by_label('Review note').fill('Accept the synthetic software result only')
            frame.get_by_role('button', name='Accept result').click()
            expect(frame.get_by_text('accepted: Accept the synthetic software result only')).to_be_attached()
            page.emulate_media(color_scheme='dark')
            page.evaluate("document.querySelector('iframe').contentWindow.postMessage({type:'pero:app:context',context:{locale:'en',dark:true,active:true}},'*')")
            page.screenshot(path=str(artifacts / '04-results-dark.png'), full_page=True)
            page.set_viewport_size({'width': 390, 'height': 844})
            frame.get_by_role('button', name='Deck', exact=True).click()
            actual_frame = page.frames[1]
            assert actual_frame.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'Horizontal overflow'
            expect(frame.get_by_role('button', name=re.compile(r'^B1: 200')).locator('small')).to_be_hidden()
            frame.get_by_role('button', name=re.compile(r'^A1:')).focus()
            frame.get_by_role('button', name=re.compile(r'^A1:')).press('Enter')
            expect(frame.get_by_role('button', name=re.compile(r'^A1:'))).to_have_attribute('aria-pressed', 'true')
            page.screenshot(path=str(artifacts / '05-narrow.png'), full_page=True)
            frame.get_by_role('button', name='Results', exact=True).click()
            assert actual_frame.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'Results overflow'
            page.screenshot(path=str(artifacts / '05b-results-narrow.png'), full_page=True)
            page.set_viewport_size({'width': 1280, 'height': 900})
            page.emulate_media(color_scheme='light')
            page.evaluate("document.querySelector('iframe').contentWindow.postMessage({type:'pero:app:context',context:{locale:'en',dark:false,active:true}},'*')")
            frame.get_by_role('button', name='Protocol', exact=True).click()
            frame.get_by_role('button', name='Revise', exact=True).click()
            frame.get_by_label('Protocol JSON').fill('[{"action":"execute_hardware"}]')
            frame.get_by_label('Candidate rationale').fill('Should be refused')
            frame.get_by_role('button', name='Save candidate').click()
            expect(frame.get_by_role('alert')).to_contain_text('Unsupported operation')
            page.screenshot(path=str(artifacts / '06-error.png'), full_page=True)
            frame.get_by_role('button', name='Cancel edit').click()
            with page.expect_download() as received:
                frame.get_by_role('button', name='Export', exact=True).click()
            received.value.save_as(str(artifacts / 'experiment.json'))
            evidence = json.loads((artifacts / 'experiment.json').read_text())
            assert len(evidence['trials']) == 2
            assert evidence['trials'][1]['verification']['status'] == 'PASS'
            http.shutdown(); http.server_close(); thread.join(timeout=5); store.close()
            store, http, thread = start()
            page.goto(f'http://127.0.0.1:{http.server_port}/')
            frame.get_by_role('button', name='Match a virtual dye target', exact=True).click()
            frame.get_by_role('button', name='Results', exact=True).click()
            expect(frame.locator('h3 .badge')).to_have_text('PASS')
            assert store.read(evidence['id']) == evidence, 'History view replayed or changed saved evidence'
            caps.update(available=False, error='Injected missing dependency for UI acceptance')
            page.reload()
            expect(frame.get_by_text(re.compile('PyLabRobot unavailable:'))).to_be_visible()
            page.screenshot(path=str(artifacts / '07-unavailable.png'), full_page=True)
            browser.close()
        if errors:
            raise AssertionError(errors)
        (artifacts / 'receipt.json').write_text(json.dumps({
            'status': 'PASS', 'executor': 'test-fixture' if args.fixture else 'pylabrobot==0.2.1',
            'view': 'production-bundle' if args.bundle else 'same-view-unbundled',
            'desktop': 'NOT RUN', 'real_agent': 'NOT RUN',
            'checks': ['two linked trials', 'FAIL then PASS', 'explicit review', 'restart without replay',
                       'export', 'light/dark', 'narrow deck/results', 'keyboard well selection', 'invalid action', 'unavailable dependency'],
            'page_errors': errors}, indent=2))
    finally:
        http.shutdown(); http.server_close(); thread.join(timeout=5); store.close(); home.cleanup()


if __name__ == '__main__':
    main()
