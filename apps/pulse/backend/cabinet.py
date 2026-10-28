"""Pulse cabinet: one edition, one watch, and the person's reading marks.

`(state, command) -> (next state, editions to archive)`. No clock, files, or
randomness. A publish cannot set seen, dismissed, or feedback. Publishing the
same edition again is the same edition.
"""
import json
import re

KINDS = frozenset({"needs_you", "risk", "change", "done", "watch", "filtered"})
CADENCES = frozenset({"brief", "hourly", "daily", "weekday"})
PROACTIVITY = frozenset({"off", "decisions", "brief", "active"})
ENTITIES = frozenset({"pr", "issue", "commit", "session", "file", "meeting", "automation", "branch", "project"})
EDITION_KEYS = frozenset({"id", "createdAt", "cards", "tomorrow", "goalId", "automation"})
CARD_KEYS = frozenset({"id", "kind", "title", "conclusion", "body", "why", "impact", "handled", "entity", "sources"})
READING_KEYS = frozenset({"seen", "dismissed", "feedback"})
ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
MAX_DAILY = 14
MAX_REPORTS = 60
MAX_CARDS = 20
MAX_WATCHES = 30
MAX_SOURCES = 6


class Invalid(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code
        self.detail = None


def empty():
    return {"version": 1, "proactivity": "brief", "watches": [], "editions": [],
            "reading": {"seen": [], "dismissed": [], "feedback": {}}, "archive": []}


def load_state(document):
    reading = document.get("reading") if isinstance(document, dict) else None
    if (not isinstance(document, dict) or document.get("version") != 1
            or document.get("proactivity") not in PROACTIVITY
            or not isinstance(document.get("watches"), list)
            or not isinstance(document.get("editions"), list)
            or not isinstance(document.get("archive"), list)
            or not isinstance(reading, dict)
            or not isinstance(reading.get("seen"), list)
            or not isinstance(reading.get("dismissed"), list)
            or not isinstance(reading.get("feedback"), dict)):
        raise Invalid("state_invalid")
    return document


def apply(state, command, library=None, archived_body=None):
    """Return (next state, edition bodies that left the hot window)."""
    load_state(state)
    if not isinstance(command, dict) or not isinstance(command.get("type"), str):
        raise Invalid("command_invalid")
    kind = command["type"]
    if kind == "publish":
        _keys(command, {"type", "edition"})
        return _publish(state, command["edition"], archived_body)
    if kind == "watch":
        _keys(command, {"type", "id", "text", "cadence", "now"})
        return _watch(state, command), []
    if kind == "remove_watch":
        _keys(command, {"type", "id"})
        return _remove_watch(state, command["id"]), []
    if kind == "proactivity":
        _keys(command, {"type", "value"})
        return _proactivity(state, command["value"]), []
    if kind == "seen":
        _keys(command, {"type", "cards"})
        return _seen(state, command["cards"], library or {}), []
    if kind == "dismissed":
        _keys(command, {"type", "edition", "card", "dismissed"})
        return _dismissed(state, command, library or {}), []
    if kind == "feedback":
        _keys(command, {"type", "edition", "card", "vote", "note", "now"})
        return _feedback(state, command, library or {}), []
    raise Invalid("command_invalid")


def home_view(state):
    load_state(state)
    return {"proactivity": state["proactivity"], "watches": state["watches"],
            "editions": [_present(state, edition) for edition in _newest(state["editions"])],
            "archive": state["archive"]}


def present_edition(state, edition):
    load_state(state)
    return _present(state, edition)


def _publish(state, document, archived_body):
    edition = _edition(document)
    if edition.get("goalId") and not any(watch["id"] == edition["goalId"] for watch in state["watches"]):
        raise Invalid("watch_missing")
    hot = next((item for item in state["editions"] if item["id"] == edition["id"]), None)
    if hot is not None:
        if hot != edition:
            raise Invalid("edition_conflict")
        return state, []
    archived = next((item for item in state["archive"] if item["id"] == edition["id"]), None)
    if archived is not None:
        if archived_body is None:
            raise Invalid("archive_missing")
        if archived_body != edition:
            raise Invalid("edition_conflict")
        return state, []
    nxt = _copy(state)
    nxt["editions"] = [edition, *state["editions"]]
    kept, dropped = _retain(nxt["editions"])
    nxt["editions"] = _newest(kept)
    nxt["archive"] = _newest([_summary(item) for item in dropped] + state["archive"])
    return nxt, dropped


def _watch(state, command):
    watch_id = _id(command["id"], "watch_invalid")
    if any(watch["id"] == watch_id for watch in state["watches"]):
        raise Invalid("watch_duplicate")
    if len(state["watches"]) >= MAX_WATCHES:
        raise Invalid("watch_limit")
    cadence = command["cadence"]
    if cadence not in CADENCES:
        raise Invalid("cadence_invalid")
    watch = {"id": watch_id, "text": _text(command["text"], 500, "watch_invalid"),
             "cadence": cadence, "createdAt": _stamp(command["now"])}
    nxt = _copy(state)
    nxt["watches"] = [watch, *state["watches"]]
    return nxt


def _remove_watch(state, watch_id):
    if not any(watch["id"] == watch_id for watch in state["watches"]):
        raise Invalid("watch_missing")
    nxt = _copy(state)
    nxt["watches"] = [watch for watch in state["watches"] if watch["id"] != watch_id]
    return nxt


def _proactivity(state, value):
    if value not in PROACTIVITY:
        raise Invalid("proactivity_invalid")
    if state["proactivity"] == value:
        return state
    nxt = _copy(state)
    nxt["proactivity"] = value
    return nxt


def _seen(state, cards, library):
    if not isinstance(cards, list) or len(cards) > MAX_CARDS:
        raise Invalid("seen_invalid")
    marks = []
    for card in cards:
        if not isinstance(card, dict) or set(card) != {"edition", "card"}:
            raise Invalid("seen_invalid")
        marks.append(_known(state, card["edition"], card["card"], library))
    fresh = [mark for mark in marks if mark not in state["reading"]["seen"]]
    if not fresh:
        return state
    nxt = _copy(state)
    nxt["reading"]["seen"] = sorted(set(state["reading"]["seen"]) | set(fresh))
    return nxt


def _dismissed(state, command, library):
    if not isinstance(command["dismissed"], bool):
        raise Invalid("dismissed_invalid")
    mark = _known(state, command["edition"], command["card"], library)
    dismissed = set(state["reading"]["dismissed"])
    if command["dismissed"]:
        dismissed.add(mark)
    else:
        dismissed.discard(mark)
    if dismissed == set(state["reading"]["dismissed"]):
        return state
    nxt = _copy(state)
    nxt["reading"]["dismissed"] = sorted(dismissed)
    return nxt


def _feedback(state, command, library):
    mark = _known(state, command["edition"], command["card"], library)
    if command["vote"] not in ("more", "less"):
        raise Invalid("feedback_invalid")
    note = command["note"]
    if not isinstance(note, str) or note.strip() != note or len(note) > 300:
        raise Invalid("feedback_invalid")
    record = {"vote": command["vote"], "note": note, "at": _stamp(command["now"])}
    if state["reading"]["feedback"].get(mark) == record:
        return state
    nxt = _copy(state)
    nxt["reading"]["feedback"] = {**state["reading"]["feedback"], mark: record}
    return nxt


def _known(state, edition_id, card_id, library):
    if not isinstance(edition_id, str) or not isinstance(card_id, str):
        raise Invalid("card_missing")
    edition = next((item for item in state["editions"] if item["id"] == edition_id), None)
    if edition is None and any(item["id"] == edition_id for item in state["archive"]):
        edition = library.get(edition_id)
        if edition is None:
            raise Invalid("archive_unloaded")
    cards = edition.get("cards") if isinstance(edition, dict) and edition.get("id") == edition_id else None
    if not isinstance(cards, list) or not any(isinstance(card, dict) and card.get("id") == card_id for card in cards):
        raise Invalid("card_missing")
    return f"{edition_id}/{card_id}"


def _edition(document):
    if not isinstance(document, dict) or set(document) - EDITION_KEYS:
        raise Invalid("edition_invalid")
    edition = {"id": _id(document.get("id"), "edition_invalid"), "createdAt": _stamp(document.get("createdAt")),
               "cards": _cards(document.get("cards"))}
    tomorrow = document.get("tomorrow", "")
    if not isinstance(tomorrow, str) or tomorrow.strip() != tomorrow or len(tomorrow) > 1000:
        raise Invalid("edition_invalid")
    if tomorrow:
        edition["tomorrow"] = tomorrow
    if "goalId" in document:
        edition["goalId"] = _id(document["goalId"], "edition_invalid")
    if "automation" in document:
        edition["automation"] = _text(document["automation"], 80, "edition_invalid")
    return edition


def _cards(cards):
    if not isinstance(cards, list) or len(cards) > MAX_CARDS:
        raise Invalid("edition_invalid")
    cleaned = [_card(card) for card in cards]
    if len({card["id"] for card in cleaned}) != len(cleaned):
        raise Invalid("card_duplicate")
    return cleaned


def _card(card):
    if not isinstance(card, dict) or set(card) & READING_KEYS:
        raise Invalid("reading_forbidden")
    if set(card) - CARD_KEYS:
        raise Invalid("card_invalid")
    if card.get("kind") not in KINDS:
        raise Invalid("card_invalid")
    cleaned = {"id": _id(card.get("id"), "card_invalid"), "kind": card["kind"],
               "title": _text(card.get("title"), 200, "card_invalid"),
               "conclusion": _text(card.get("conclusion"), 300, "card_invalid"),
               "body": _body(card.get("body"))}
    for field, limit in (("why", 1000), ("impact", 80)):
        if field in card:
            cleaned[field] = _text(card[field], limit, "card_invalid")
    if card.get("handled") is True:
        cleaned["handled"] = True
    elif "handled" in card:
        raise Invalid("card_invalid")
    if "entity" in card:
        cleaned["entity"] = _entity(card["entity"])
    if "sources" in card:
        cleaned["sources"] = _sources(card["sources"])
    return cleaned


def _body(value):
    if not isinstance(value, str) or value.strip() != value or len(value) > 4000:
        raise Invalid("card_invalid")
    return value


def _entity(entity):
    if not isinstance(entity, dict) or set(entity) - {"type", "label", "id", "url"} or entity.get("type") not in ENTITIES:
        raise Invalid("card_invalid")
    cleaned = {"type": entity["type"], "label": _text(entity.get("label"), 200, "card_invalid")}
    if "id" in entity:
        cleaned["id"] = _text(entity["id"], 80, "card_invalid")
    if "url" in entity:
        cleaned["url"] = _url(entity["url"])
    return cleaned


def _sources(sources):
    if not isinstance(sources, list) or len(sources) > MAX_SOURCES:
        raise Invalid("card_invalid")
    cleaned = []
    for source in sources:
        if not isinstance(source, dict) or set(source) - {"label", "url"}:
            raise Invalid("card_invalid")
        item = {"label": _text(source.get("label"), 200, "card_invalid")}
        if "url" in source:
            item["url"] = _url(source["url"])
        cleaned.append(item)
    return cleaned


def _retain(editions):
    daily = [edition for edition in editions if "goalId" not in edition]
    reports = [edition for edition in editions if "goalId" in edition]
    keep = set()
    dropped = []
    for group, limit in ((daily, MAX_DAILY), (reports, MAX_REPORTS)):
        ordered = sorted(group, key=lambda edition: (edition["createdAt"], edition["id"]))
        dropped.extend(ordered[:-limit] if len(ordered) > limit else [])
        keep.update(edition["id"] for edition in ordered[-limit:])
    return [edition for edition in editions if edition["id"] in keep], dropped


def _summary(edition):
    item = {"id": edition["id"], "createdAt": edition["createdAt"], "cards": len(edition["cards"])}
    if "goalId" in edition:
        item["goalId"] = edition["goalId"]
    return item


def _present(state, edition):
    if not isinstance(edition, dict) or not isinstance(edition.get("cards"), list):
        raise Invalid("state_invalid")
    cards = []
    for card in edition["cards"]:
        if not isinstance(card, dict) or not isinstance(card.get("id"), str):
            raise Invalid("state_invalid")
        shown = dict(card)
        mark = f"{edition['id']}/{card['id']}"
        if mark in state["reading"]["seen"]:
            shown["seen"] = True
        if mark in state["reading"]["dismissed"]:
            shown["dismissed"] = True
        if mark in state["reading"]["feedback"]:
            shown["feedback"] = state["reading"]["feedback"][mark]
        cards.append(shown)
    shown = dict(edition)
    shown["cards"] = cards
    return shown


def _newest(items):
    return sorted(items, key=lambda item: (item["createdAt"], item["id"]), reverse=True)


def _copy(state):
    return json.loads(json.dumps(state))


def _keys(command, allowed):
    if set(command) != allowed:
        raise Invalid("command_invalid")


def _id(value, code):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise Invalid(code)
    return value


def _stamp(value):
    if not isinstance(value, str) or not STAMP.fullmatch(value):
        raise Invalid("time_invalid")
    return value


def _text(value, limit, code):
    if not isinstance(value, str) or not value or value.strip() != value or len(value) > limit:
        raise Invalid(code)
    return value


def _url(value):
    if (not isinstance(value, str) or len(value) > 500 or any(ord(ch) < 32 or ch == " " for ch in value)
            or not (value.startswith("https://") or value.startswith("http://"))):
        raise Invalid("card_invalid")
    return value
