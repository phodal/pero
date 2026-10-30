"""Disposable installed-App composition for Sample data download acceptance.

Only the fixed external source changes. The actual DatasetDownload class,
worker, filesystem writes, checksums, cancellation and HTTP handler are intact.
Neither this module nor its configuration is included in production Apps.
"""
import json
from pathlib import Path
import socket
from urllib.parse import urlparse

from dataset_download import DatasetDownload, FixedDatasetSource


def make_download(root):
    source = json.loads(Path(__file__).with_name("download-fixture-source.json").read_bytes())
    # A mistaken fixture configuration must never fetch the 699 MB public file.
    url = urlparse(source["url"])
    if url.scheme != "http" or url.hostname != "127.0.0.1":
        raise ValueError("Download acceptance requires an explicit loopback Sample data source")
    return DatasetDownload(root, FixedDatasetSource(**source))


def wrap_handler(real_handler):
    """Observe real cancellation joins and lose one accepted transport reply."""
    def build(*args):
        download = args[3]
        class SampleHandler(real_handler(*args)):
            def reply(self, status, value):
                marker = Path(__file__).with_name("drop-next-download-response")
                if self.command == "POST" and self.path == "/api/dataset/cancel" and status == 200:
                    event = {"event": "cancel_returned", "status": value["status"],
                             "workerAlive": bool(download.worker and download.worker.is_alive()),
                             "observerAlive": bool(download.observer and download.observer.is_alive())}
                    with marker.with_name("download-fixture-events.jsonl").open("a") as log:
                        log.write(json.dumps(event) + "\n")
                if (self.command == "POST" and self.path == "/api/dataset/download"
                        and status == 202 and marker.exists()):
                    marker.unlink()
                    event = {"event": "accepted_response_dropped", "path": self.path, "attempt": value["attempt"],
                             "status": value["status"], "source": value["source"]["id"]}
                    with marker.with_name("download-fixture-events.jsonl").open("a") as log:
                        log.write(json.dumps(event) + "\n")
                    # DatasetDownload.start already ran. Only its transport
                    # receipt is lost; subsequent GET sees authoritative state.
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.connection.close()
                    return
                super().reply(status, value)
        return SampleHandler
    return build
