"""Host-authenticated loopback App server for fixed local benchmark evidence."""
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import re
import signal
import threading

from domain import Invalid
from store import BenchmarkStore, canonical


def handler(store, secret):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, code, value):
            body = canonical(value)
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def agent_step(self, value):
            action = value.get('action')
            fields = {'read': {'runId', 'specDigest'}, 'run': {'benchmarkId', 'specDigest'},
                      'verify': {'runId', 'specDigest'}, 'cancel': {'runId', 'specDigest'},
                      'compare': {'runIds'}}
            if not isinstance(action, str) or action not in fields or set(value) - (fields[action] | {'action'}):
                raise Invalid('Unknown Agent benchmark action or field')
            if action == 'read' and not value.get('runId'):
                return store.state()
            if action == 'compare':
                return dict(comparison=store.compare(value.get('runIds')))
            if action == 'run':
                benchmark = next((item for item in store.benchmarks if item.id == value.get('benchmarkId')), None)
                if benchmark is None or value.get('specDigest') != benchmark.spec_digest:
                    raise Invalid('The frozen benchmark definition does not match; read the catalog again')
                return dict(run=store.create(benchmark.id))
            identity = value.get('runId')
            with store.lock:
                record = store.get(identity)
                if value.get('specDigest') != record.spec_digest:
                    raise Invalid('The frozen execution definition does not match')
                result = store.read(identity) if action == 'read' else getattr(store, action)(identity)
            return dict(run=result)

        def dispatch(self):
            if not secret or not hmac.compare_digest(secret, self.headers.get('X-Pero-App-Token', '')):
                return self.reply(401, dict(detail='Host authentication is required'))
            try:
                self.connection.settimeout(15)
                if self.headers.get('Transfer-Encoding'):
                    raise Invalid('Transfer encoding is unsupported')
                if self.command == 'GET':
                    if self.path == '/api/state':
                        return self.reply(200, store.state())
                    match = re.fullmatch(r'/api/runs/([a-f0-9]{32})(/export|/series)?', self.path)
                    if match:
                        if not match[2]:
                            return self.reply(200, dict(run=store.read(match[1])))
                        if match[2] == '/series':
                            return self.reply(200, store.series(match[1]))
                        body = store.export(match[1])
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/zip')
                        self.send_header('Content-Disposition', f'attachment; filename="hpc-{match[1]}.zip"')
                        self.send_header('Cache-Control', 'no-store')
                        self.send_header('Content-Length', str(len(body)))
                        self.end_headers()
                        self.wfile.write(body)
                        return
                if self.command == 'POST':
                    if not self.headers.get('Content-Type', '').startswith('application/json'):
                        raise Invalid('JSON content type is required')
                    length = int(self.headers.get('Content-Length', 0))
                    if not 0 < length <= 65536:
                        raise Invalid('Request must be between 1 and 65536 bytes')
                    raw = self.rfile.read(length)
                    if len(raw) != length:
                        raise Invalid('Incomplete request')
                    value = json.loads(raw)
                    if not isinstance(value, dict):
                        raise Invalid('Expected a JSON object')
                    if self.path == '/api/runs':
                        if set(value) != {'benchmarkId'}:
                            raise Invalid('Choose one fixed benchmark; custom execution parameters are unsupported')
                        return self.reply(202, dict(run=store.create(value['benchmarkId'])))
                    if self.path == '/api/compare':
                        if set(value) != {'runIds'}:
                            raise Invalid('Comparison requires only runIds')
                        return self.reply(200, dict(comparison=store.compare(value['runIds'])))
                    if self.path == '/api/agent-step':
                        return self.reply(200, self.agent_step(value))
                    match = re.fullmatch(r'/api/runs/([a-f0-9]{32})/(verify|cancel)', self.path)
                    if match:
                        if value:
                            raise Invalid('This action has no adjustable parameters')
                        return self.reply(202, dict(run=getattr(store, match[2])(match[1])))
                self.reply(404, dict(detail='Route not found'))
            except (Invalid, ValueError, TypeError, KeyError) as error:
                self.reply(400, dict(detail=str(error)))
            except OSError:
                self.reply(500, dict(detail='Local evidence could not be read or saved; check the App data directory'))

        do_GET = do_POST = dispatch
    return Handler


def main():
    store = BenchmarkStore(os.environ['PERO_APP_DATA'])
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler(store, os.environ['PERO_APP_TOKEN']))
    server.daemon_threads = True
    print(json.dumps(dict(port=server.server_port)), flush=True)

    def stop(_signal, _frame):
        threading.Thread(target=server.shutdown, daemon=True).start()

    for name in (signal.SIGINT, signal.SIGTERM):
        signal.signal(name, stop)
    try:
        server.serve_forever()
    finally:
        store.close()
        server.server_close()


if __name__ == '__main__':
    main()
