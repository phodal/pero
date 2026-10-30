"""Explicit download of one pinned raw dataset into the Host-owned App root.

No discovery of user caches, arbitrary URLs, resuming, preparation or retries.
The source constructor is the internal seam for loopback streaming tests.
"""
from dataclasses import dataclass, replace
from datetime import datetime, timezone
import hashlib
from http.client import HTTPException
import json
import os
from pathlib import Path
import re
import threading
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from contract import Invalid, canonical

ACTIVE = frozenset(("downloading", "verifying", "cancelling"))
CHUNK = 64 * 1024
CHECKPOINT = 1024 * 1024


@dataclass(frozen=True)
class DatasetChecksums:
    bytes: int
    md5: str
    sha256: str


@dataclass(frozen=True)
class FixedDatasetSource:
    id: str
    revision: str
    filename: str
    url: str
    record: str
    bytes: int
    md5: str
    sha256: str
    sha256_evidence: str
    license_id: str
    license_url: str
    warning: str

    @classmethod
    def load(cls):
        manifest = json.loads((Path(__file__).parent / "data_sources/norman.json").read_bytes())
        if (manifest.get("schema") != "pero.virtual-cell.source.v1"
                or urlparse(manifest["download_url"]).scheme != "https"
                or not re.fullmatch(r"[A-Za-z0-9_.-]+\.h5ad", manifest["filename"])
                or not isinstance(manifest["bytes"], int) or isinstance(manifest["bytes"], bool) or manifest["bytes"] <= 0
                or not re.fullmatch(r"[0-9a-f]{32}", manifest["md5"])
                or not re.fullmatch(r"[0-9a-f]{64}", manifest["sha256"])):
            raise Invalid("dataset_source_invalid")
        return cls(manifest["id"], manifest["revision"], manifest["filename"], manifest["download_url"],
                   manifest["record"], manifest["bytes"], manifest["md5"], manifest["sha256"],
                   manifest["sha256_evidence"], manifest["license"]["id"], manifest["license"]["url"],
                   manifest["warning"])

    def require_size(self, size):
        if size != self.bytes:
            raise Invalid("download_size_mismatch")

    def check(self, actual: DatasetChecksums):
        self.require_size(actual.bytes)
        if actual.md5 != self.md5:
            raise Invalid("download_md5_mismatch")
        if actual.sha256 != self.sha256:
            raise Invalid("download_sha256_mismatch")

    def document(self):
        return {"id": self.id, "revision": self.revision, "filename": self.filename,
                "downloadUrl": self.url, "record": self.record, "bytes": self.bytes,
                "md5": self.md5, "sha256": self.sha256, "sha256Evidence": self.sha256_evidence,
                "license": {"id": self.license_id, "url": self.license_url}, "warning": self.warning}


@dataclass(frozen=True)
class DownloadOutcome:
    status: str
    received: int
    verified: int
    checksums: DatasetChecksums | None = None
    error: str | None = None
    cache_rejected: bool = False


@dataclass(frozen=True)
class DatasetDownloadState:
    status: str = "idle"
    received: int = 0
    verified: int = 0
    attempt: int = 0
    started_at: str | None = None
    finished_at: str | None = None
    error: str | None = None
    checksums: DatasetChecksums | None = None
    transfer_stopped: bool = True
    cache_rejected: bool = False

    def begin(self, now, verify_only=False, cached_bytes=None):
        if self.status in ACTIVE:
            raise Invalid("dataset_download_active")
        return DatasetDownloadState("verifying" if verify_only else "downloading",
                                    cached_bytes or 0, 0, self.attempt + 1, now,
                                    transfer_stopped=False, cache_rejected=self.cache_rejected)

    def progress(self, phase, received, verified):
        if self.status not in ACTIVE:
            raise Invalid("dataset_download_transition_invalid")
        return replace(self, status="cancelling" if self.status == "cancelling" else phase,
                       received=received, verified=verified)

    def cancel(self):
        return replace(self, status="cancelling") if self.status in ACTIVE else self

    def completed(self, outcome: DownloadOutcome, now):
        if self.status not in ACTIVE or outcome.status not in ("ready", "cancelled", "failed"):
            raise Invalid("dataset_download_transition_invalid")
        if outcome.status == "ready" and outcome.checksums is None:
            raise Invalid("dataset_download_verification_missing")
        # A completed and atomically published valid file wins a cancel race.
        return replace(self, status=outcome.status, received=outcome.received, verified=outcome.verified,
                       finished_at=now, error=outcome.error, checksums=outcome.checksums,
                       transfer_stopped=True,
                       cache_rejected=False if outcome.status == "ready" else self.cache_rejected or outcome.cache_rejected)

    def restarted(self, now, partial_bytes, cached_bytes):
        if self.status in ACTIVE:
            return replace(self, status="interrupted", received=partial_bytes, verified=0,
                           finished_at=now, error="download_interrupted", checksums=None,
                           transfer_stopped=False)
        if cached_bytes is not None and not self.cache_rejected:
            return replace(self, status="cached", received=cached_bytes, verified=0,
                           checksums=None, transfer_stopped=True)
        if self.status == "ready":
            return replace(self, status="failed", received=0, verified=0,
                           error="download_file_missing", checksums=None)
        return self

    def file_missing(self, now):
        return replace(self, status="failed", received=0, verified=0, finished_at=now,
                       error="download_file_missing", checksums=None, transfer_stopped=True)

    def storage_failed(self, now):
        """Only after no transfer was started, or its thread was joined."""
        return replace(self, status="failed", finished_at=now, error="download_state_write_failed",
                       checksums=None, transfer_stopped=True)

    def document(self):
        return {"status": self.status, "receivedBytes": self.received, "verifiedBytes": self.verified,
                "attempt": self.attempt, "startedAt": self.started_at, "finishedAt": self.finished_at,
                "error": self.error, "transferStopped": self.transfer_stopped,
                "cacheRejected": self.cache_rejected,
                "checksums": ({"md5": self.checksums.md5, "sha256": self.checksums.sha256}
                              if self.checksums else None)}

    @classmethod
    def restore(cls, doc):
        checksums = doc["checksums"]
        return cls(doc["status"], doc["receivedBytes"], doc["verifiedBytes"], doc["attempt"],
                   doc["startedAt"], doc["finishedAt"], doc["error"],
                   DatasetChecksums(doc["receivedBytes"], checksums["md5"], checksums["sha256"]) if checksums else None,
                   doc["transferStopped"], doc.get("cacheRejected", False))


class DownloadCancelled(Exception):
    pass


class DatasetDownload:
    def __init__(self, root, source=None):
        self.source = source or FixedDatasetSource.load()
        self.root = Path(root) / "datasets"
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / self.source.filename
        self.partial = self.root / (self.source.filename + ".part")
        self.record = self.root / "download.json"
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.worker = None
        self.observer = None
        self.outcome = None
        self.closed = False
        self.state = (DatasetDownloadState.restore(json.loads(self.record.read_bytes()))
                      if self.record.exists() else DatasetDownloadState())
        self.state = self.state.restarted(self._now(), self.partial.stat().st_size if self.partial.exists() else 0,
                                          self.path.stat().st_size if self.path.exists() else None)
        self._save()

    @staticmethod
    def _now():
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    def _save(self):
        temporary = self.root / "download.tmp"
        temporary.write_bytes(canonical(self.state.document()))
        os.replace(temporary, self.record)

    def read(self):
        with self.lock:
            if self.state.status in ("ready", "cached") and not self.path.exists():
                self.state = self.state.file_missing(self._now())
                try:
                    self._save()
                except OSError:
                    self.state = self.state.storage_failed(self._now())
            return {**self.state.document(), "source": self.source.document(),
                    "expectedBytes": self.source.bytes, "path": str(self.path.resolve()),
                    "partialPath": str(self.partial.resolve()), "prepared": False,
                    "verificationRequired": self.path.exists() and self.state.status != "ready"}

    def start(self, verify_only=False):
        with self.lock:
            if self.closed:
                raise Invalid("dataset_download_stopping")
            self.state = self.state.begin(self._now(), verify_only,
                                          self.path.stat().st_size if self.path.exists() else None)
            self.stop.clear()
            self.outcome = None
            self.worker = self.observer = None
            try:
                self._save()
            except OSError:
                self.state = self.state.storage_failed(self._now())
                raise Invalid("download_state_write_failed") from None
            # Intent is fixed by the explicit route, never inferred from a
            # later filesystem observation inside the transfer thread.
            self.worker = threading.Thread(target=self._transfer, args=(verify_only,), daemon=True)
            self.observer = threading.Thread(target=self._observe, daemon=True)
            self.worker.start()
            self.observer.start()
            return self.read()

    def _progress(self, phase, received, verified, persist=False):
        with self.lock:
            self.state = self.state.progress(phase, received, verified)
            if persist:
                self._save()

    def _check_cancel(self):
        if self.stop.is_set():
            raise DownloadCancelled()

    def _hash_cached(self):
        size = self.path.stat().st_size
        self.source.require_size(size)
        md5, sha256 = hashlib.md5(usedforsecurity=False), hashlib.sha256()
        verified = 0
        with self.path.open("rb") as handle:
            while True:
                self._check_cancel()
                chunk = handle.read(CHUNK)
                if not chunk:
                    break
                verified += len(chunk)
                md5.update(chunk)
                sha256.update(chunk)
                self._progress("verifying", size, verified)
        actual = DatasetChecksums(verified, md5.hexdigest(), sha256.hexdigest())
        self.source.check(actual)
        return actual

    def _transfer(self, verify_only):
        received, verified = 0, 0
        try:
            self._check_cancel()
            if verify_only or self.path.exists():
                try:
                    actual = self._hash_cached()
                except Invalid as error:
                    if verify_only:
                        self.outcome = DownloadOutcome("failed", self.state.received, self.state.verified,
                                                       error=error.code, cache_rejected=True)
                        return
                else:
                    self.outcome = DownloadOutcome("ready", actual.bytes, actual.bytes, actual)
                    return
            self._check_cancel()
            self._progress("downloading", 0, 0, persist=True)
            md5, sha256 = hashlib.md5(usedforsecurity=False), hashlib.sha256()
            checkpoint = 0
            request = Request(self.source.url, headers={"Accept": "application/octet-stream"})
            with urlopen(request, timeout=5) as response, self.partial.open("wb") as handle:
                if response.status != 200:
                    raise Invalid("download_response_invalid")
                length = response.headers.get("Content-Length")
                if length is not None and length != str(self.source.bytes):
                    raise Invalid("download_size_mismatch")
                while True:
                    self._check_cancel()
                    chunk = response.read1(CHUNK)
                    self._check_cancel()
                    if not chunk:
                        break
                    received += len(chunk)
                    if received > self.source.bytes:
                        raise Invalid("download_size_mismatch")
                    handle.write(chunk)
                    md5.update(chunk)
                    sha256.update(chunk)
                    persist = received - checkpoint >= CHECKPOINT
                    self._progress("downloading", received, 0, persist)
                    if persist:
                        checkpoint = received
                handle.flush()
            self._check_cancel()
            self._progress("verifying", received, received, persist=True)
            actual = DatasetChecksums(received, md5.hexdigest(), sha256.hexdigest())
            self.source.check(actual)
            verified = received
            self._check_cancel()
            os.replace(self.partial, self.path)
            self.outcome = DownloadOutcome("ready", received, verified, actual)
        except DownloadCancelled:
            self.outcome = DownloadOutcome("cancelled", self.state.received, self.state.verified)
        except HTTPError as error:
            error.close()
            self.outcome = DownloadOutcome("failed", received, verified, error=f"download_http_{error.code}")
        except Invalid as error:
            self.outcome = DownloadOutcome("failed", received, verified, error=error.code)
        except (URLError, TimeoutError):
            self.outcome = DownloadOutcome("cancelled" if self.stop.is_set() else "failed", received, verified,
                                           error=None if self.stop.is_set() else "download_network_error")
        except HTTPException:
            self.outcome = DownloadOutcome("failed", received, verified, error="download_response_invalid")
        except FileNotFoundError:
            self.outcome = DownloadOutcome("failed", received, verified, error="download_file_missing")
        except OSError:
            self.outcome = DownloadOutcome("failed", received, verified, error="download_io_error")

    def _observe(self):
        self.worker.join()
        with self.lock:
            outcome = self.outcome or DownloadOutcome("failed", self.state.received, self.state.verified,
                                                      error="download_transfer_failed")
            self.state = self.state.completed(outcome, self._now())
            try:
                self._save()
            except OSError:
                self.state = self.state.storage_failed(self._now())

    def cancel(self):
        with self.lock:
            active = self.state.status in ACTIVE
            self.state = self.state.cancel()
            self.stop.set()
            if active:
                try:
                    self._save()
                except OSError:
                    # A full disk must not prevent the real stop. The joined
                    # observer publishes its terminal state or storage error.
                    pass
            observer = self.observer
        if observer is not None:
            observer.join()
        return self.read()

    def close(self):
        with self.lock:
            self.closed = True
        self.cancel()
