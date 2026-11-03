"""Host-authenticated transport for the independent Data App."""
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import signal
import threading

from analysis import Analysis
from catalog import Catalog, IMPORT_LIMIT, ImportFile
from datasets import DatasetEdit, PreviewRequest, SaveView
from downloads import Downloads
from sources import ResearchAsset, ResearchSelection


def handler(downloads, secret):
    analysis = Analysis(downloads.catalog)

    def state():
        with downloads.catalog.lock:
            return downloads.state() | downloads.catalog.workspace()

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
                    return self.reply(200, state())
                if self.command == 'GET' and self.path == '/api/charts':
                    return self.reply(200, {'charts': analysis.list_charts()})
                if self.command == 'GET' and self.path.startswith('/api/chart/'):
                    return self.reply(200, analysis.read_chart(self.path.removeprefix('/api/chart/')))
                routes = (
                    '/api/import', '/api/download', '/api/cancel', '/api/inspect',
                    '/api/datasets/update', '/api/views', '/api/source', '/api/records', '/api/export',
                    '/api/chart', '/api/chart/validate',
                    '/api/research-download', '/api/research-status', '/api/research-cancel',
                )
                if self.command != 'POST' or self.path not in routes:
                    return self.reply(404, {'error': 'Route not found'})
                if self.headers.get('Transfer-Encoding') or not self.headers.get('Content-Type', '').startswith('application/json'):
                    raise ValueError('A JSON request with Content-Length is required')
                limit = ((IMPORT_LIMIT + 2) // 3) * 4 + 4096 if self.path == '/api/import' else (
                    2 * 1024 * 1024 + 4096 if self.path in ('/api/chart', '/api/chart/validate', '/api/export') else (
                        128 * 1024 if self.path in ('/api/inspect', '/api/views', '/api/records', '/api/source') else 8192))
                length = int(self.headers.get('Content-Length', 0))
                if not 0 < length <= limit:
                    raise ValueError('Request exceeds its size limit (10 MiB for imported files)')
                raw = self.rfile.read(length)
                if len(raw) != length:
                    raise ValueError('Incomplete request')
                data = json.loads(raw)
                if not isinstance(data, dict):
                    raise ValueError('Expected a JSON object')
                if self.path == '/api/research-download':
                    return self.reply(200, downloads.start_research(ResearchAsset.parse(data)))
                if self.path in ('/api/research-status', '/api/research-cancel'):
                    return self.reply(200, downloads.research_state(ResearchSelection.parse(data),
                                                                   cancel=self.path == '/api/research-cancel'))
                if self.path == '/api/inspect':
                    return self.reply(200, downloads.catalog.inspect(PreviewRequest.parse(data)))
                if self.path == '/api/source':
                    return self.reply(200, analysis.source(data))
                if self.path == '/api/records':
                    return self.reply(200, analysis.read(data))
                if self.path == '/api/export':
                    return self.reply(200, analysis.export(data))
                if self.path == '/api/chart':
                    return self.reply(200, analysis.create_chart(data))
                if self.path == '/api/chart/validate':
                    return self.reply(200, analysis.validate_chart(data))
                if self.path == '/api/views':
                    view = downloads.catalog.save_view(SaveView.parse(data))
                    return self.reply(200, state() | {'savedViewId': view.id})
                if self.path == '/api/import':
                    asset = downloads.catalog.import_file(ImportFile.parse(data))
                    with downloads.catalog.lock:
                        dataset = next(d for d in downloads.catalog.datasets if asset.id in d.versions)
                        return self.reply(200, state() | {'selectedDatasetId': dataset.id, 'selectedAssetId': asset.id})
                if self.path == '/api/datasets/update':
                    downloads.catalog.edit_dataset(DatasetEdit.parse(data))
                elif self.path == '/api/download':
                    if set(data) != {'sourceId'} or not isinstance(data['sourceId'], str):
                        raise ValueError('Choose a registered source')
                    downloads.start(data['sourceId'])
                else:
                    if data:
                        raise ValueError('Cancel requires an empty object')
                    downloads.cancel()
                return self.reply(200, state())
            except (ValueError, TypeError) as error:
                return self.reply(400, {'error': str(error), 'detail': str(error)})
            except OSError:
                return self.reply(500, {'error': 'Local file operation failed; check disk space and retry',
                                        'detail': 'Local file operation failed; check disk space and retry'})

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
