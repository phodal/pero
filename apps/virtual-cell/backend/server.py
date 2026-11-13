"""Loopback backend, supervised and authenticated by Pero Host."""
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import signal
import socketserver
import threading

from contract import Invalid, canonical
from dataset_download import DatasetDownload
from local_comparisons import ComparisonHistory
from workbench import MAX_BODY, Workbench
from model_endpoint import AdditiveEndpoint
from task_package import PACKAGE
from task_step import TaskStep, execute_step


def authenticated(secret, token):
    return bool(secret) and hmac.compare_digest(secret, token)


def handler(workbench, secret, comparisons=None, dataset=None, model=None):
    comparisons = comparisons or ComparisonHistory(workbench)
    dataset = dataset or DatasetDownload(workbench.root)
    model = model or AdditiveEndpoint.configured(workbench)
    comparisons.model = model
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
                if self.command == "POST" and self.path == "/api/task-step":
                    return self.reply(200, execute_step(TaskStep.parse(data), workbench, comparisons, model))
                if self.command == "GET" and self.path == "/api/task-package":
                    return self.reply(200, PACKAGE.document(workbench.source))
                if self.path == "/api/model" and self.command == "GET":
                    return self.reply(200, model.read())
                if self.command == "POST" and self.path in ("/api/model/start", "/api/model/stop", "/api/model/predict"):
                    if self.path.endswith("/stop"):
                        if data:
                            raise Invalid("model_endpoint_fields")
                        return self.reply(200, model.stop())
                    if set(data) != {"inputId"}:
                        raise Invalid("model_endpoint_fields")
                    return self.reply(200, model.start(data["inputId"]) if self.path.endswith("/start") else model.predict(data["inputId"]))
                if self.command == "GET" and self.path == "/api/dataset":
                    return self.reply(200, dataset.read())
                if self.command == "POST" and self.path in ("/api/dataset/download", "/api/dataset/verify", "/api/dataset/cancel"):
                    if data:
                        raise Invalid("dataset_request_fields")
                    if self.path.endswith("/cancel"):
                        return self.reply(200, dataset.cancel())
                    return self.reply(202, dataset.start(verify_only=self.path.endswith("/verify")))
                if self.command == "GET" and self.path == "/api/inputs":
                    return self.reply(200, workbench.catalog())
                if self.command == "POST" and self.path == "/api/inputs":
                    return self.reply(201, workbench.import_documents(data.get("documents")))
                if self.command == "GET" and self.path == "/api/example":
                    return self.reply(200, {"content": (Path(__file__).parents[1] / "examples/synthetic.json").read_text()})
                if self.command == "GET" and self.path in ("/api/evidence/all", "/api/evidence/exclude_bad_coverage"):
                    protocol = self.path.rsplit("/", 1)[1]
                    return self.reply(200, {"content": (Path(__file__).parents[1] / "evidence/norman-sc0-v1" / protocol / "evaluation.json").read_text()})
                if self.path == "/api/comparisons":
                    if self.command == "GET":
                        return self.reply(200, comparisons.catalog())
                    if self.command == "POST":
                        return self.reply(202, comparisons.start(data.get("inputId")))
                if self.path.startswith("/api/comparisons/"):
                    identity, *action = self.path.removeprefix("/api/comparisons/").split("/")
                    if self.command == "GET" and not action:
                        return self.reply(200, comparisons.read(identity))
                    if self.command == "POST" and action == ["cancel"]:
                        return self.reply(200, comparisons.cancel(identity))
                    if self.command == "GET" and action == ["export"]:
                        return self.reply(200, comparisons.export(identity))
                    if self.command == "POST" and action == ["check"]:
                        if data:
                            raise Invalid("comparison_check_fields")
                        return self.reply(200, comparisons.check(identity))
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
                self.reply(500 if error.code == "download_state_write_failed" else
                           409 if error.code in ("comparison_already_running", "comparison_backend_stopping", "dataset_download_active", "dataset_download_stopping", "model_endpoint_busy", "model_endpoint_input_not_ready", "remote_model_not_ready") else 400,
                           {"code": error.code, "detail": error.detail})
            except (ValueError, TypeError, KeyError, UnicodeError, RecursionError):
                self.reply(400, {"code": "request_invalid"})
            except OSError:
                self.reply(500, {"code": "backend_io_error"})

        do_GET = do_POST = dispatch
    return Handler


class LoopbackServer(ThreadingHTTPServer):
    def server_bind(self):
        # Readiness must not wait for reverse DNS of our fixed loopback address.
        socketserver.TCPServer.server_bind(self)
        self.server_name = "127.0.0.1"
        self.server_port = self.server_address[1]


def main():
    workbench = Workbench(os.environ["PERO_APP_DATA"])
    comparisons = ComparisonHistory(workbench)
    dataset = DatasetDownload(workbench.root)
    server = LoopbackServer(("127.0.0.1", 0),
                                handler(workbench, os.environ["PERO_APP_TOKEN"], comparisons, dataset))
    server.daemon_threads = True
    print(json.dumps({"port": server.server_port}), flush=True)
    def stop(_signal, _frame):
        threading.Thread(target=server.shutdown, daemon=True).start()
    for name in (signal.SIGTERM, signal.SIGINT):
        signal.signal(name, stop)
    try:
        server.serve_forever()
    finally:
        comparisons.close()
        dataset.close()
        server.server_close()


if __name__ == "__main__":
    main()
