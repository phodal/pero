"""Real loopback byte streams, never a production dataset download."""
from dataclasses import replace
import errno
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import fixture
from contract import Invalid, canonical
from dataset_download import (DatasetChecksums, DatasetDownload, DatasetDownloadState,
                              DownloadOutcome, FixedDatasetSource)
from server import handler
from workbench import Workbench


def observed(read, timeout=10):
    deadline = time.monotonic() + timeout
    while True:
        result = read()
        if result:
            return result
        if time.monotonic() >= deadline:
            raise AssertionError("download condition was not observed")
        threading.Event().wait(0.01)


class ByteStream:
    """One actual streaming HTTP source, injected only at the Python seam."""
    def __init__(self):
        self.expected = bytes(range(256)) * 1024
        self.body = self.expected
        self.status = 200
        self.requests = []
        self.release = threading.Event()
        self.release.set()
        stream = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                stream.requests.append({"path": self.path, "range": self.headers.get("Range")})
                self.send_response(stream.status)
                self.send_header("Content-Length", str(len(stream.expected)))
                self.end_headers()
                try:
                    self.wfile.write(stream.body[:16384])
                    self.wfile.flush()
                    stream.release.wait(10)
                    self.wfile.write(stream.body[16384:])
                except OSError:
                    pass  # A cancelled real client is allowed to close early.

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.source = FixedDatasetSource(
            "loopback-fixture", "synthetic-bytes-v1", "fixture.h5ad",
            f"http://127.0.0.1:{self.server.server_port}/fixed-source", "https://example.invalid/source",
            len(self.expected), hashlib.md5(self.expected).hexdigest(), hashlib.sha256(self.expected).hexdigest(),
            "Synthetic fixture only", "test-only", "https://example.invalid/license", "Not biological data")

    def close(self):
        self.release.set()
        self.server.shutdown()
        self.thread.join()
        self.server.server_close()


class DownloadDomainTests(unittest.TestCase):
    def test_verification_and_completion_are_distinct_from_requesting_a_stop(self):
        source = FixedDatasetSource("test", "v1", "test.h5ad", "https://example.invalid/fixed",
                                    "https://example.invalid", 3, "a" * 32, "b" * 64, "fixture", "test", "", "")
        actual = DatasetChecksums(3, "a" * 32, "b" * 64)
        for changed, code in [(replace(actual, bytes=2), "download_size_mismatch"),
                              (replace(actual, md5="c" * 32), "download_md5_mismatch"),
                              (replace(actual, sha256="c" * 64), "download_sha256_mismatch")]:
            with self.subTest(code=code), self.assertRaisesRegex(Invalid, code):
                source.check(changed)
        running = DatasetDownloadState().begin("start")
        cancelling = running.cancel()
        self.assertEqual(cancelling.status, "cancelling")
        self.assertFalse(cancelling.transfer_stopped)
        self.assertEqual(cancelling.completed(DownloadOutcome("ready", 3, 3, actual), "end").status, "ready")
        cancelled = cancelling.completed(DownloadOutcome("cancelled", 1, 0), "end")
        self.assertTrue(cancelled.transfer_stopped)
        for pending in (running, cancelling):
            interrupted = pending.restarted("restart", 1, None)
            self.assertEqual(interrupted.status, "interrupted")
            self.assertFalse(interrupted.transfer_stopped)
            self.assertIsNone(interrupted.checksums)


class DownloadStreamTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.stream = ByteStream()
        self.addCleanup(self.stream.close)
        self.download = DatasetDownload(self.temporary.name, self.stream.source)
        self.addCleanup(self.download.close)

    def terminal(self, download=None):
        download = download or self.download
        return observed(lambda: (state if (state := download.read())["transferStopped"] else None))

    def test_real_http_download_explicit_cache_verification_and_no_arbitrary_source(self):
        app = ThreadingHTTPServer(("127.0.0.1", 0), handler(Workbench(self.temporary.name), "download-test", dataset=self.download))
        serving = threading.Thread(target=app.serve_forever)
        serving.start()
        self.addCleanup(app.server_close)
        self.addCleanup(serving.join)
        self.addCleanup(app.shutdown)
        base = f"http://127.0.0.1:{app.server_port}"

        def request(path, body=None):
            with urlopen(Request(base + path, data=canonical(body) if body is not None else None,
                                 headers={"X-Pero-App-Token": "download-test"})) as response:
                return response.status, json.load(response)

        status, initial = request("/api/dataset")
        self.assertEqual((status, initial["status"], initial["expectedBytes"]), (200, "idle", len(self.stream.expected)))
        self.assertEqual(self.stream.requests, [])
        for fields in ({"url": "http://example.invalid"}, {"path": "../outside"}, {"command": "ignored"}):
            with self.assertRaises(HTTPError) as caught:
                request("/api/dataset/download", fields)
            with caught.exception as error:
                self.assertEqual(error.code, 400)
                self.assertEqual(json.load(error)["code"], "dataset_request_fields")
        self.assertEqual(self.stream.requests, [])
        self.assertEqual(request("/api/dataset/verify", {})[0], 202)
        self.assertEqual(self.terminal()["error"], "download_file_missing")
        self.assertEqual(self.stream.requests, [], "The verify route cannot download a missing file")
        self.assertEqual(request("/api/dataset/download", {})[0], 202)
        result = self.terminal()
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["receivedBytes"], len(self.stream.expected))
        self.assertEqual(Path(result["path"]).read_bytes(), self.stream.expected)
        self.assertFalse(result["prepared"])
        self.assertFalse(Path(result["partialPath"]).exists())
        self.assertEqual(result["checksums"]["sha256"], self.stream.source.sha256)
        self.assertEqual(len(self.stream.requests), 1)
        self.assertEqual(request("/api/dataset/cancel", {})[1]["status"], "ready")
        self.download.close()
        reopened = DatasetDownload(self.temporary.name, self.stream.source)
        self.addCleanup(reopened.close)
        self.assertEqual(reopened.read()["status"], "cached")
        self.assertTrue(reopened.read()["verificationRequired"])
        self.assertEqual(len(self.stream.requests), 1)
        reopened.start(verify_only=True)
        self.assertEqual(self.terminal(reopened)["status"], "ready")
        self.assertEqual(len(self.stream.requests), 1, "A verified existing file must not be downloaded again")

    def test_cancel_closes_and_joins_before_confirmation_then_retry_restarts_from_zero(self):
        self.stream.release.clear()
        self.download.start()
        observed(lambda: self.download.read()["receivedBytes"] > 0)
        with self.assertRaisesRegex(Invalid, "dataset_download_active"):
            self.download.start()
        cancellation = threading.Thread(target=self.download.cancel)
        cancellation.start()
        observed(lambda: self.download.read()["status"] == "cancelling")
        self.assertFalse(self.download.read()["transferStopped"])
        self.assertFalse(self.download.path.exists())
        self.stream.release.set()
        cancellation.join(10)
        self.assertFalse(cancellation.is_alive())
        stopped = self.download.read()
        self.assertEqual(stopped["status"], "cancelled")
        self.assertTrue(stopped["transferStopped"])
        self.assertFalse(self.download.worker.is_alive())
        self.assertTrue(self.download.partial.exists())
        self.assertFalse(self.download.path.exists())
        self.download.start()
        result = self.terminal()
        self.assertEqual((result["status"], result["attempt"]), ("ready", 2))
        self.assertEqual(self.download.path.read_bytes(), self.stream.expected)
        self.assertEqual(len(self.stream.requests), 2)
        self.assertTrue(all(request["range"] is None for request in self.stream.requests))

    def test_bad_bytes_truncation_http_error_and_sha_mismatch_never_publish(self):
        cases = [(b"x" * len(self.stream.expected), 200, self.stream.source, "download_md5_mismatch"),
                 (self.stream.expected[:10000], 200, self.stream.source, "download_size_mismatch"),
                 (self.stream.expected, 503, self.stream.source, "download_http_503"),
                 (self.stream.expected, 200, replace(self.stream.source, sha256="0" * 64), "download_sha256_mismatch")]
        for index, (body, status, source, code) in enumerate(cases):
            with self.subTest(code=code):
                self.stream.body, self.stream.status = body, status
                download = DatasetDownload(Path(self.temporary.name) / str(index), source)
                self.addCleanup(download.close)
                download.start()
                result = self.terminal(download)
                self.assertEqual((result["status"], result["error"]), ("failed", code))
                self.assertFalse(download.path.exists())
                self.assertIsNone(result["checksums"])

    def test_unreachable_source_is_an_explicit_failure_without_publish_or_retry(self):
        self.stream.close()
        self.download.start()
        result = self.terminal()
        self.assertEqual((result["status"], result["error"]), ("failed", "download_network_error"))
        self.assertEqual(result["attempt"], 1)
        self.assertTrue(result["transferStopped"])
        self.assertFalse(self.download.path.exists())
        self.assertFalse(self.download.worker.is_alive())

    def test_start_record_failure_leaves_no_transfer_and_can_retry_after_space_is_freed(self):
        with patch.object(self.download, "_save", side_effect=OSError(errno.ENOSPC, "No space left")):
            with self.assertRaisesRegex(Invalid, "download_state_write_failed"):
                self.download.start()
            state = self.download.read()
            self.assertEqual((state["status"], state["error"]), ("failed", "download_state_write_failed"))
            self.assertTrue(state["transferStopped"])
            self.assertIsNone(self.download.worker)
            self.assertIsNone(self.download.observer)
            self.assertEqual(self.download.cancel()["status"], "failed")
            self.assertEqual(self.stream.requests, [])
        self.download.start()
        self.assertEqual(self.terminal()["status"], "ready")
        self.assertEqual(len(self.stream.requests), 1)

    def test_verify_intent_never_downloads_when_cache_disappears_before_or_after_selection(self):
        self.download.start(verify_only=True)
        self.assertEqual(self.terminal()["error"], "download_file_missing")
        self.assertEqual(self.stream.requests, [])
        self.download.path.write_bytes(self.stream.expected)
        entered, release = threading.Event(), threading.Event()
        read_cache = self.download._hash_cached

        def paused_cache_read():
            entered.set()
            if not release.wait(10):
                raise AssertionError("cache-read gate was not released")
            return read_cache()

        with patch.object(self.download, "_hash_cached", paused_cache_read):
            self.download.start(verify_only=True)
            self.assertTrue(entered.wait(5))
            self.assertEqual(self.download.read()["status"], "verifying")
            self.download.path.unlink()
            release.set()
            result = self.terminal()
        self.assertEqual((result["status"], result["error"]), ("failed", "download_file_missing"))
        self.assertTrue(result["transferStopped"])
        self.assertEqual(self.stream.requests, [])

    def test_missing_ready_file_is_reported_without_automatic_network(self):
        self.download.start()
        self.assertEqual(self.terminal()["status"], "ready")
        self.download.path.unlink()
        state = self.download.read()
        self.assertEqual((state["status"], state["error"]), ("failed", "download_file_missing"))
        self.assertIsNone(state["checksums"])
        self.assertEqual(len(self.stream.requests), 1)

    def test_restart_retains_partial_bytes_without_network_or_false_readiness(self):
        self.stream.release.clear()
        self.download.start()
        observed(lambda: self.download.read()["receivedBytes"] > 0)
        unconfirmed = self.download.state.document()
        closing = threading.Thread(target=self.download.close)
        closing.start()
        observed(lambda: self.download.read()["status"] == "cancelling")
        self.stream.release.set()
        closing.join(10)
        self.assertFalse(closing.is_alive())
        self.assertFalse(self.download.worker.is_alive())
        # Restore the actual pre-stop checkpoint, as after an abrupt backend
        # exit that never persisted its final observation.
        self.download.record.write_bytes(canonical(unconfirmed))
        reopened = DatasetDownload(self.temporary.name, self.stream.source)
        self.addCleanup(reopened.close)
        state = reopened.read()
        self.assertEqual(state["status"], "interrupted")
        self.assertEqual(state["receivedBytes"], reopened.partial.stat().st_size)
        self.assertFalse(state["prepared"])
        self.assertFalse(reopened.path.exists())
        self.assertEqual(len(self.stream.requests), 1)

    def test_corrupt_cache_is_only_replaced_after_explicit_download_and_valid_checksum(self):
        self.download.start()
        self.assertEqual(self.terminal()["status"], "ready")
        self.download.close()
        self.download.path.write_bytes(b"x" * len(self.stream.expected))
        reopened = DatasetDownload(self.temporary.name, self.stream.source)
        self.addCleanup(reopened.close)
        self.assertEqual(reopened.read()["status"], "cached")
        self.assertEqual(len(self.stream.requests), 1)
        reopened.start(verify_only=True)
        rejected = self.terminal(reopened)
        self.assertEqual((rejected["status"], rejected["error"]), ("failed", "download_md5_mismatch"))
        self.assertTrue(rejected["cacheRejected"])
        self.assertEqual(len(self.stream.requests), 1, "Verify local file cannot silently initiate a download")
        reopened.close()
        retry = DatasetDownload(self.temporary.name, self.stream.source)
        self.addCleanup(retry.close)
        self.assertEqual(retry.read()["status"], "failed")
        self.assertTrue(retry.read()["cacheRejected"])
        retry.start()
        self.assertEqual(self.terminal(retry)["status"], "ready")
        self.assertEqual(len(self.stream.requests), 2)
        self.assertEqual(retry.path.read_bytes(), self.stream.expected)
