"""Host-authenticated local cluster-draft API. No remote operations."""
import hmac
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os

from clusters import ClusterDraft, ClusterStore, Selection


def handler(store, secret):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, status, value):
            body = json.dumps(value, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def dispatch(self):
            if not secret or not hmac.compare_digest(secret, self.headers.get('X-Pero-App-Token', '')):
                return self.reply(401, {'detail': 'Host authentication required'})
            try:
                if self.command == 'GET' and self.path == '/api/state':
                    return self.reply(200, store.state())
                if self.command != 'POST' or self.path not in ('/api/clusters', '/api/selection'):
                    return self.reply(404, {'detail': 'Route not found'})
                self.connection.settimeout(10)
                if self.headers.get('Transfer-Encoding') or not self.headers.get('Content-Type', '').startswith('application/json'):
                    raise ValueError('A JSON request with Content-Length is required')
                length = int(self.headers.get('Content-Length', 0))
                if not 0 < length <= 8192:
                    raise ValueError('Cluster configuration request exceeds its size limit')
                content = self.rfile.read(length)
                if len(content) != length:
                    raise ValueError('Incomplete request')
                value = json.loads(content)
                result = store.save(ClusterDraft.parse(value)) if self.path == '/api/clusters' else store.select(Selection.parse(value))
                return self.reply(200, result)
            except (ValueError, TypeError) as error:
                return self.reply(400, {'detail': str(error)})
            except OSError:
                return self.reply(500, {'detail': 'Could not save cluster drafts; check local disk space and retry'})

        do_GET = dispatch
        do_POST = dispatch
    return Handler


if __name__ == '__main__':
    # Configuration requests are serialized; no background connection or job runs.
    server = HTTPServer(('127.0.0.1', 0), handler(ClusterStore(os.environ['PERO_APP_DATA']), os.environ['PERO_APP_TOKEN']))
    print(json.dumps({'port': server.server_port}), flush=True)
    server.serve_forever()
