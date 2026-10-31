"""Carry Point's stdlib HTTP backend in Pero's existing owned process.

The transport boundary authenticates Pero before signing for the unchanged
Point handler. No token or signature crosses into the browser.
"""
import hashlib
import hmac
import http.server
import io
import json
import os
from pathlib import Path
import runpy
import sys
import time
from urllib.parse import unquote, urlsplit


def main():
    root = Path(__file__).resolve().parent
    app = json.loads((root / "point-source/app.json").read_text())
    token = os.environ["PERO_APP_TOKEN"]
    secret = os.urandom(32).hex()
    os.environ.update(PORT="0", POINT_APP_DATA=os.environ["PERO_APP_DATA"],
                      POINT_APP_NAME=app["name"], POINT_APP_PROXY_SECRET=secret)
    server_type = http.server.ThreadingHTTPServer
    limit = app["backend"]["maxBodyBytes"]

    class Server(server_type):
        def __init__(self, address, handler, *args, **kwargs):
            class Authenticated(handler):
                def bridge(self):
                    if self.command == "GET" and self.path == "/health":
                        return handler.do_GET(self)
                    if not hmac.compare_digest(token, self.headers.get("X-Pero-App-Token", "")):
                        self.send_error(401)
                        return
                    parsed = urlsplit(self.path)
                    path = unquote(parsed.path)
                    full = f"/apps/{app['name']}{path}"
                    if parsed.scheme or parsed.netloc or "\\" in path or any(part in (".", "..") for part in path.split("/")) or not any(
                        full == prefix or full.startswith(prefix + "/") for prefix in app["permissions"].get("api", [])
                    ):
                        self.send_error(403)
                        return
                    if self.headers.get("Transfer-Encoding"):
                        self.send_error(400)
                        return
                    raw = self.headers.get("Content-Length", "0")
                    if not raw.isdigit() or not 0 <= int(raw) <= limit:
                        self.send_error(413)
                        return
                    self.connection.settimeout(15)
                    body = self.rfile.read(int(raw))
                    if len(body) != int(raw):
                        self.send_error(400)
                        return
                    seconds = str(int(time.time()))
                    payload = f"{seconds}:{self.command}:{self.path}:{hashlib.sha256(body).hexdigest()}".encode()
                    signature = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
                    del self.headers["X-Point-App-Proxy"]
                    self.headers["X-Point-App-Proxy"] = f"{seconds}:{signature}"
                    original = self.rfile
                    self.rfile = io.BytesIO(body)
                    try:
                        getattr(handler, "do_" + self.command)(self)
                    finally:
                        self.rfile = original
                do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = bridge
            super().__init__(("127.0.0.1", 0), Authenticated, *args, **kwargs)
            print(json.dumps({"port": self.server_port}), flush=True)

    http.server.ThreadingHTTPServer = Server
    entry = root / "point-source" / app["backend"]["entryPoint"]
    sys.path.insert(0, str(entry.parent))
    os.chdir(root / "point-source")
    runpy.run_path(str(entry), run_name="__main__")


if __name__ == "__main__":
    main()
