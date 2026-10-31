"""Host-authenticated transport for the standalone Data App."""
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import signal
import threading

from catalog import Catalog, IMPORT_LIMIT, ImportFile
from downloads import Downloads


def handler(downloads, secret):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, code, value):
            body = json.dumps(value, allow_nan=False).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def dispatch(self):
            if not secret or not hmac.compare_digest(secret, self.headers.get('X-Pero-App-Token', '')):
                return self.reply(401, {'error': 'Host authentication required'})
            try:
                self.connection.settimeout(20)
                if self.command == 'GET' and self.path == '/api/state':
                    return self.reply(200, downloads.state())
                if self.command != 'POST' or self.path not in ('/api/import', '/api/download', '/api/cancel'):
                    return self.reply(404, {'error': 'Route not found'})
                if self.headers.get('Transfer-Encoding') or not self.headers.get('Content-Type', '').startswith('application/json'):
                    raise ValueError('A JSON request with Content-Length is required')
                limit = ((IMPORT_LIMIT + 2) // 3) * 4 + 4096 if self.path == '/api/import' else 4096
                length = int(self.headers.get('Content-Length', 0))
                if not 0 < length <= limit:
                    raise ValueError('Request exceeds the import limit (10 MiB file)')
                raw = self.rfile.read(length)
                if len(raw) != length:
                    raise ValueError('Incomplete request')
                data = json.loads(raw)
                if not isinstance(data, dict):
                    raise ValueError('Expected a JSON object')
                if self.path == '/api/import':
                    downloads.catalog.import_file(ImportFile.parse(data))
                elif self.path == '/api/download':
                    if set(data) != {'sourceId'} or not isinstance(data['sourceId'], str):
                        raise ValueError('Choose a registered source')
                    downloads.start(data['sourceId'])
                else:
                    if data:
                        raise ValueError('Cancel requires an empty object')
                    downloads.cancel()
                return self.reply(200, downloads.state())
            except (ValueError, TypeError) as error:
                return self.reply(400, {'error': str(error), 'detail': str(error)})
            except OSError:
                return self.reply(500, {'error': 'Local file operation failed; check disk space and retry'})

        do_GET = dispatch
        do_POST = dispatch
    return Handler


def main():
    downloads = Downloads(Catalog(os.environ['PERO_APP_DATA']))
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler(downloads, os.environ['PERO_APP_TOKEN']))
    server.daemon_threads = True
    print(json.dumps({'port': server.server_port}), flush=True)

    def stop(_signal, _frame):
        downloads.cancel()
        threading.Thread(target=server.shutdown, daemon=True).start()

    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, stop)
    try:
        server.serve_forever()
    finally:
        downloads.close()
        server.server_close()


if __name__ == '__main__':
    main()
