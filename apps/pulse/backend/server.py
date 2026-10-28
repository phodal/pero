"""Loopback backend, supervised and authenticated by Pero Host."""
from datetime import datetime, timezone
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import signal
import threading
from uuid import uuid4

from cabinet import Invalid
from store import Store

MAX_BODY = 256 * 1024


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def watch_id():
    return "w" + uuid4().hex[:12]


def authenticated(secret, token):
    return bool(secret) and hmac.compare_digest(secret, token)


def handler(store, secret):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, status, value):
            body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def dispatch(self):
            if self.command == "GET" and self.path == "/health":
                return self.reply(200, {"ok": True})
            try:
                if self.headers.get("Transfer-Encoding"):
                    return self.reply(400, {"code": "body_invalid"})
                length = int(self.headers.get("Content-Length", 0))
                if not 0 <= length <= MAX_BODY:
                    return self.reply(413, {"code": "body_too_large"})
                self.connection.settimeout(15)
                body = self.rfile.read(length)
                if len(body) != length:
                    return self.reply(400, {"code": "body_invalid"})
                if not authenticated(secret, self.headers.get("X-Pero-App-Token", "")):
                    return self.reply(401, {"code": "proxy_auth_required"})
                data = json.loads(body) if body else {}
                if not isinstance(data, dict):
                    raise Invalid("request_invalid")
                if self.command == "GET" and self.path == "/api/home":
                    return self.reply(200, store.home())
                if self.command == "GET" and self.path.startswith("/api/editions/"):
                    return self.reply(200, store.edition(self.path.removeprefix("/api/editions/")))
                if self.command == "POST" and self.path == "/api/editions":
                    return self.reply(201, store.publish(data, now()))
                if self.command == "POST" and self.path == "/api/watches":
                    return self.reply(200, store.add_watch(data.get("text"), data.get("cadence"), now(), watch_id()))
                if self.command == "POST" and self.path == "/api/watches/remove":
                    return self.reply(200, store.remove_watch(data.get("id")))
                if self.command == "POST" and self.path == "/api/proactivity":
                    return self.reply(200, store.set_proactivity(data.get("value")))
                if self.command == "POST" and self.path == "/api/seen":
                    return self.reply(200, store.mark_seen(data.get("cards")))
                if self.command == "POST" and self.path == "/api/dismissed":
                    return self.reply(200, store.set_dismissed(data.get("edition"), data.get("card"), data.get("dismissed")))
                if self.command == "POST" and self.path == "/api/feedback":
                    return self.reply(200, store.set_feedback(data.get("edition"), data.get("card"), data.get("vote"), data.get("note", ""), now()))
                self.reply(404, {"code": "route_missing"})
            except Invalid as error:
                self.reply(400, {"code": error.code})
            except (ValueError, TypeError, KeyError, UnicodeError, RecursionError):
                self.reply(400, {"code": "request_invalid"})
            except OSError:
                self.reply(500, {"code": "backend_io_error"})

        do_GET = do_POST = dispatch
    return Handler


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler(Store(os.environ["PERO_APP_DATA"]), os.environ["PERO_APP_TOKEN"]))
    server.daemon_threads = True
    print(json.dumps({"port": server.server_port}), flush=True)

    def stop(_signal, _frame):
        threading.Thread(target=server.shutdown, daemon=True).start()

    for name in (signal.SIGTERM, signal.SIGINT):
        signal.signal(name, stop)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
