"""Loopback JSON App, supervised and authenticated by Pero Host."""
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import signal
import threading
from hashlib import sha256
from chart_document import ChartDocument, document_for_view
from dataset import Dataset, Invalid
from store import DatasetId, DatasetStore
from view import DatasetView, metadata


def handler(store: DatasetStore, secret: str):
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
            if not secret or not hmac.compare_digest(secret, self.headers.get("X-Pero-App-Token", "")):
                return self.reply(401, {"detail": "App authentication is required"})
            try:
                if self.headers.get("Transfer-Encoding"):
                    raise Invalid("Chunked requests are unsupported")
                length = int(self.headers.get("Content-Length", 0))
                if not 0 <= length <= 18 * 1024 * 1024:
                    return self.reply(413, {"detail": "The request exceeds 18 MiB"})
                self.connection.settimeout(15)
                body = self.rfile.read(length)
                if len(body) != length:
                    raise Invalid("Incomplete request")
                value = json.loads(body) if body else {}
                if not isinstance(value, dict):
                    raise Invalid("The request must be an object")
                if self.command == "GET" and self.path == "/api/datasets":
                    return self.reply(200, {"datasets": store.catalog()})
                if self.command == "GET" and self.path == "/api/charts":
                    charts = []
                    for path in sorted(store.root.glob("*.chart.json")):
                        content = path.read_text(encoding="utf-8")
                        identity = path.name.removesuffix(".chart.json")
                        if sha256(content.encode()).hexdigest() != identity:
                            continue
                        document = json.loads(content)
                        charts.append({"artifactId": identity, "title": document["title"],
                                       "type": document["chart"]["type"], "source": document["source"]["label"]})
                    return self.reply(200, {"charts": charts})
                if self.command == "GET" and self.path == "/api/example":
                    return self.reply(200, {"content": (Path(__file__).parents[1] / "examples/observations.json").read_text()})
                if self.command == "GET" and self.path.startswith("/api/source/"):
                    dataset = store.read(DatasetId(self.path.removeprefix("/api/source/")))
                    return self.reply(200, {"dataset": metadata(dataset), "content": dataset.source})
                if self.command == "GET" and self.path.startswith("/api/chart/"):
                    identity = DatasetId(self.path.removeprefix("/api/chart/"))
                    try:
                        content = (store.root / (identity.value + ".chart.json")).read_text(encoding="utf-8")
                    except FileNotFoundError:
                        raise Invalid("The chart is unavailable") from None
                    if sha256(content.encode()).hexdigest() != identity.value:
                        raise Invalid("The saved chart digest does not match")
                    return self.reply(200, {"document": json.loads(content), "artifactId": identity.value, "content": content})
                if self.command == "POST" and self.path == "/api/import":
                    if set(value) != {"name", "content", "format"} or not isinstance(value["content"], str) or not isinstance(value["name"], str) or value["format"] not in ("json", "json_lines"):
                        raise Invalid("Import needs a name, JSON content and its format")
                    dataset = Dataset.parse(value["content"], value["name"], value["format"] == "json_lines")
                    store.put(dataset)
                    return self.reply(201, {"dataset": metadata(dataset)})
                if self.command == "POST" and self.path in ("/api/chart", "/api/chart/validate"):
                    if self.path == "/api/chart/validate":
                        if set(value) == {"content"} and isinstance(value["content"], str):
                            content = value["content"]
                        elif set(value) == {"document"}:
                            content = json.dumps(value["document"], ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
                        else:
                            raise Invalid("Supply one chart document or its exact JSON content")
                        if len(content.encode()) > 2 * 1024 * 1024:
                            raise Invalid("The chart document exceeds 2 MiB")
                        identity = sha256(content.encode()).hexdigest()
                        path = store.root / (identity + ".chart.json")
                        if path.is_file() and path.read_text(encoding="utf-8") == content:
                            return self.reply(200, {"document": json.loads(content), "artifactId": identity, "content": content})
                        document = json.loads(content)
                        source = document.get("source") if isinstance(document, dict) else None
                        if isinstance(source, dict) and "dataset" in source:
                            raise Invalid("Dataset provenance is not a saved local chart; create it from the dataset again")
                        document = ChartDocument.admit(document).json()
                    else:
                        request = value.pop("chartDocument", None)
                        aggregation = value.pop("aggregation", None)
                        dataset = store.read(DatasetId(value.get("dataset")))
                        view = DatasetView.admit(value, dataset)
                        document = document_for_view(dataset, view, request, aggregation)
                    content = json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
                    if len(content.encode()) > 2 * 1024 * 1024:
                        raise Invalid("The chart document exceeds 2 MiB")
                    identity = sha256(content.encode()).hexdigest()
                    store.write(identity + ".chart.json", content)
                    return self.reply(200, {"document": document, "artifactId": identity, "content": content})
                if self.command == "POST" and self.path in ("/api/query", "/api/export", "/api/records"):
                    dataset = store.read(DatasetId(value.get("dataset")))
                    if self.path == "/api/records" and "limit" not in value:
                        value = {**value, "limit":10}
                    view = DatasetView.admit(value, dataset)
                    result = view.export(dataset) if self.path == "/api/export" else view.read(dataset) if self.path == "/api/records" else view.project(dataset)
                    if self.path == "/api/export":
                        store.write(result["id"] + ".export.json", result["content"])
                    return self.reply(200, result)
                self.reply(404, {"detail": "Unknown Data Agent route"})
            except Invalid as error:
                self.reply(400, {"detail": str(error)})
            except (ValueError, TypeError, KeyError, UnicodeError, RecursionError, OverflowError):
                self.reply(400, {"detail": "Invalid dataset request"})
            except OSError:
                self.reply(500, {"detail": "Could not read or save the dataset; retry the operation"})
        do_GET = do_POST = dispatch
    return Handler


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler(DatasetStore(os.environ["PERO_APP_DATA"]), os.environ["PERO_APP_TOKEN"]))
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
