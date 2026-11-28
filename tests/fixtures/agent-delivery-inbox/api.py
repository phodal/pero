"""Run with: python3 api.py /absolute/path/inbox.db."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import sys

from store import Inbox


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        if self.path == "/tasks":
            self.send_json(200, {"tasks": self.server.inbox.list()})
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/tasks":
            self.send_json(404, {"error": "not found"})
            return
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        except (ValueError, TypeError):
            self.send_json(400, {"error": "invalid request"})
            return
        title = body.get("title") if isinstance(body, dict) else None
        if not isinstance(title, str) or not title.strip():
            self.send_json(400, {"error": "title required"})
            return
        self.send_json(201, self.server.inbox.create(title.strip()))


if __name__ == "__main__":
    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        server.inbox = Inbox(sys.argv[1])
        print(server.server_port, flush=True)
        server.serve_forever()
