"""Durable cabinet files. The fold in cabinet.py decides; this module only reads and writes."""
import json
import os
from pathlib import Path
import threading

from cabinet import ID, Invalid, apply, empty, home_view, load_state, present_edition

LIMIT = 8 * 1024 * 1024


class Store:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self.state = self._load()

    def home(self):
        with self._lock:
            return home_view(self.state)

    def edition(self, edition_id):
        with self._lock:
            _filename(edition_id)
            hot = next((item for item in self.state["editions"] if item["id"] == edition_id), None)
            if hot is not None:
                return present_edition(self.state, hot)
            if any(item["id"] == edition_id for item in self.state["archive"]):
                return present_edition(self.state, self._read_archive(edition_id))
            raise Invalid("edition_missing")

    def publish(self, document, now):
        if not isinstance(document, dict):
            raise Invalid("edition_invalid")
        edition = dict(document)
        with self._lock:
            if "createdAt" not in edition:
                # A retry keeps the time the first publish was given, so identical content stays identical.
                known = next((item for item in [*self.state["editions"], *self.state["archive"]] if item["id"] == edition.get("id")), None)
                edition["createdAt"] = known["createdAt"] if known else now
            return self._update({"type": "publish", "edition": edition}, archived_body=self._archived_body(edition.get("id")))

    def add_watch(self, text, cadence, now, watch_id):
        with self._lock:
            return self._update({"type": "watch", "id": watch_id, "text": text, "cadence": cadence, "now": now})

    def remove_watch(self, watch_id):
        with self._lock:
            return self._update({"type": "remove_watch", "id": watch_id})

    def set_proactivity(self, value):
        with self._lock:
            return self._update({"type": "proactivity", "value": value})

    def mark_seen(self, cards):
        with self._lock:
            return self._update({"type": "seen", "cards": cards}, library=self._library(_ids(cards, "edition")))

    def set_dismissed(self, edition, card, dismissed):
        with self._lock:
            return self._update({"type": "dismissed", "edition": edition, "card": card, "dismissed": dismissed},
                                library=self._library([edition]))

    def set_feedback(self, edition, card, vote, note, now):
        with self._lock:
            return self._update({"type": "feedback", "edition": edition, "card": card, "vote": vote, "note": note, "now": now},
                                library=self._library([edition]))

    def _update(self, command, library=None, archived_body=None):
        state, dropped = apply(self.state, command, library=library, archived_body=archived_body)
        if state is self.state and not dropped:
            return home_view(state)
        for edition in dropped:
            _atomic(self._archive_path(edition["id"]), edition, equal_ok=True)
        _atomic(self.directory / "state.json", state, equal_ok=False)
        self.state = state
        return home_view(state)

    def _load(self):
        path = self.directory / "state.json"
        if not path.exists():
            return empty()
        if path.is_symlink() or path.stat().st_size > LIMIT:
            raise Invalid("state_invalid")
        try:
            return load_state(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, UnicodeError, json.JSONDecodeError, RecursionError):
            raise Invalid("state_invalid") from None

    def _archived_body(self, edition_id):
        if not isinstance(edition_id, str) or not any(item["id"] == edition_id for item in self.state["archive"]):
            return None
        return self._read_archive(edition_id)

    def _library(self, edition_ids):
        library = {}
        for edition_id in edition_ids:
            if any(item["id"] == edition_id for item in self.state["editions"]):
                continue
            if any(item["id"] == edition_id for item in self.state["archive"]):
                library[edition_id] = self._read_archive(edition_id)
        return library

    def _read_archive(self, edition_id):
        path = self._archive_path(edition_id)
        if not path.is_file() or path.is_symlink() or path.stat().st_size > LIMIT:
            raise Invalid("archive_missing")
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError, RecursionError):
            raise Invalid("archive_missing") from None

    def _archive_path(self, edition_id):
        return self.directory / "archive" / _filename(edition_id)


def _ids(cards, field):
    if not isinstance(cards, list):
        return []
    return [card[field] for card in cards if isinstance(card, dict) and isinstance(card.get(field), str)]


def _filename(edition_id):
    if not isinstance(edition_id, str) or not ID.fullmatch(edition_id):
        raise Invalid("edition_invalid")
    return f"{edition_id}.json"


def _atomic(path, document, equal_ok):
    if path.is_symlink():
        raise Invalid("store_symlink")
    if path.exists() and equal_ok:
        try:
            if json.loads(path.read_text(encoding="utf-8")) == document:
                return
        except (OSError, UnicodeError, json.JSONDecodeError, RecursionError):
            raise Invalid("archive_conflict") from None
        raise Invalid("archive_conflict")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    data = (json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()
    try:
        with temporary.open("wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except OSError:
        temporary.unlink(missing_ok=True)
        raise Invalid("store_io") from None
