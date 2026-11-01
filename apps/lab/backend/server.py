"""Authenticated, Host-supervised local App API; no generic code/device endpoint."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import json
import os
import signal
import sys
import threading
from urllib.parse import urlsplit

from domain import LabError, example_steps, object_fields
from experiments import Experiments
from pylabrobot_adapter import capability


def agent_step(store: Experiments, payload: object) -> dict:
    if not isinstance(payload, dict):
        raise LabError("Expected an action object")
    action = payload.get("action")
    common = {"action", "experiment_id"}
    if action in ("read", "observe", "compare"):
        p = object_fields(payload, common)
        return store.read(p["experiment_id"])
    if action == "propose":
        keys = {"input_hash", "steps", "reason", "parent_id"}
        p = object_fields(payload, common | keys)
        return store.propose(p["experiment_id"], {k: p[k] for k in keys})
    methods = {"validate": store.validate, "simulate": store.simulate,
               "synthetic": store.observe, "evaluate": store.evaluate, "cancel": store.cancel}
    if not isinstance(action, str) or action not in methods:
        raise LabError("Unsupported lab action")
    p = object_fields(payload, common | {"trial_id"})
    return methods[action](p["experiment_id"], p["trial_id"])


def handler(store: Experiments, token: str):
    if not token:
        raise ValueError("PERO_APP_TOKEN must be nonempty")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, status: int, value: dict):
            if "error" in value:
                value = {**value, "detail": value["error"]}
            data = json.dumps(value, ensure_ascii=False, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(data)

        def serve(self, write: bool):
            if not hmac.compare_digest(self.headers.get("X-Pero-App-Token", "").encode(), token.encode()):
                self.reply(401, {"error": "Unauthorized"})
                return
            path = urlsplit(self.path).path
            try:
                if not write:
                    if path == "/api/experiments":
                        result = {"experiments": store.list(), "capability": capability(),
                                  "example_steps": example_steps()}
                    elif path.startswith("/api/experiments/") or path.startswith("/api/export/"):
                        result = store.read(path.rsplit("/", 1)[-1])
                    else:
                        self.reply(404, {"error": "Not found"})
                        return
                else:
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 < length <= 512 * 1024:
                        self.reply(413, {"error": "Request must be 1–524288 bytes"})
                        return
                    payload = json.loads(self.rfile.read(length))
                    if path == "/api/experiments":
                        result = store.create(payload)
                    elif path == "/api/agent-step":
                        result = agent_step(store, payload)
                    elif path == "/api/observations":
                        p = object_fields(payload, {"experiment_id", "trial_id", "filename", "content_base64"})
                        result = store.observe(p["experiment_id"], p["trial_id"],
                                               {"filename": p["filename"], "content_base64": p["content_base64"]})
                    elif path == "/api/review":
                        p = object_fields(payload, {"experiment_id", "trial_id", "decision", "note"})
                        result = store.review(p["experiment_id"], p["trial_id"],
                                              {"decision": p["decision"], "note": p["note"]})
                    else:
                        self.reply(404, {"error": "Not found"})
                        return
                self.reply(200, result)
            except LabError as exc:
                self.reply(400, {"error": str(exc), "step": exc.step})
            except (ValueError, UnicodeError) as exc:
                self.reply(400, {"error": f"Invalid input: {exc}"})
            except OSError:
                self.reply(503, {"error": "Lab storage is unavailable; no success recorded"})

        def do_GET(self):
            self.serve(False)

        def do_POST(self):
            self.serve(True)

    return Handler


def main():
    store = Experiments(os.environ["PERO_APP_DATA"])
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler(store, os.environ["PERO_APP_TOKEN"]))
    server.daemon_threads = True
    print(json.dumps({"port": server.server_port}), flush=True)
    sys.stdout = sys.stderr  # Chatterbox diagnostics must not look like Host readiness messages.

    def stop(_signum, _frame):
        store.cancelled.set()
        threading.Thread(target=server.shutdown, daemon=True).start()
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, stop)
    try:
        server.serve_forever()
    finally:
        store.close()
        server.server_close()


if __name__ == "__main__":
    main()
