"""Loopback backend, supervised and authenticated by Pero Host."""
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import signal
import threading

from contract import Invalid, canonical
from workbench import MAX_BODY, Workbench


def authenticated(secret, token):
    return bool(secret) and hmac.compare_digest(secret, token)


def handler(workbench, secret):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, status, value):
            body = canonical(value)
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
                if self.command == "GET" and self.path == "/api/inputs":
                    return self.reply(200, workbench.catalog())
                if self.command == "POST" and self.path == "/api/inputs":
                    return self.reply(201, workbench.import_documents(data.get("documents")))
                if self.command == "GET" and self.path == "/api/example":
                    return self.reply(200, {"content": (Path(__file__).parents[1] / "examples/synthetic.json").read_text()})
                if self.command == "GET" and self.path in ("/api/evidence/all", "/api/evidence/exclude_bad_coverage"):
                    protocol = self.path.rsplit("/", 1)[1]
                    return self.reply(200, {"content": (Path(__file__).parents[1] / "evidence/norman-sc0-v1" / protocol / "evaluation.json").read_text()})
                if self.command == "POST" and self.path == "/api/execute":
                    return self.reply(200, workbench.execute(data.get("inputId"), data.get("operation")))
                if self.command == "GET" and self.path.startswith("/api/artifacts/"):
                    identity = self.path.removeprefix("/api/artifacts/")
                    if identity.endswith("/export"):
                        doc = workbench.read(identity.removesuffix("/export"))
                        return self.reply(200, {"content": canonical(doc["bundle"] if doc.get("kind") == "inputs" else doc).decode()})
                    return self.reply(200, workbench.read(identity))
                self.reply(404, {"code": "route_missing"})
            except Invalid as error:
                self.reply(400, {"code": error.code, "detail": error.detail})
            except (ValueError, TypeError, KeyError, UnicodeError, RecursionError):
                self.reply(400, {"code": "request_invalid"})
            except OSError:
                self.reply(500, {"code": "backend_io_error"})

        do_GET = do_POST = dispatch
    return Handler


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0),
                                handler(Workbench(os.environ["PERO_APP_DATA"]), os.environ["PERO_APP_TOKEN"]))
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
