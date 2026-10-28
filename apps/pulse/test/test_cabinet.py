"""Cabinet fold, durable files, and the authenticated loopback server."""
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from cabinet import Invalid, apply, empty, home_view
from server import handler
from store import Store

EXAMPLE = json.loads((Path(__file__).resolve().parents[1] / "examples" / "brief.json").read_text())


def publish(state, edition, archived_body=None):
    return apply(state, {"type": "publish", "edition": edition}, archived_body=archived_body)


def card(index, kind="done"):
    return {"id": f"c{index}", "kind": kind, "title": f"标题 {index}", "conclusion": "结论", "body": ""}


def daily(index):
    return {"id": f"d{index:02d}", "createdAt": f"2026-10-29T00:{index:02d}:00Z", "cards": [card(index)]}


class FoldTests(unittest.TestCase):
    def test_example_publish_is_idempotent_and_rejects_reading_fields(self):
        state, dropped = publish(empty(), EXAMPLE)
        self.assertEqual(dropped, [])
        self.assertNotIn("seen", state["editions"][0]["cards"][0])
        again, _ = publish(state, EXAMPLE)
        self.assertIs(again, state)
        dirty = json.loads(json.dumps(EXAMPLE))
        dirty["cards"][0]["seen"] = True
        with self.assertRaises(Invalid) as caught:
            publish(state, dirty)
        self.assertEqual(caught.exception.code, "reading_forbidden")
        changed = json.loads(json.dumps(EXAMPLE))
        changed["cards"][0]["title"] = "另一句"
        with self.assertRaises(Invalid) as caught:
            publish(state, changed)
        self.assertEqual(caught.exception.code, "edition_conflict")

    def test_reading_marks_stay_outside_the_edition(self):
        state, _ = publish(empty(), EXAMPLE)
        state, _ = apply(state, {"type": "seen", "cards": [{"edition": "example-brief", "card": "decide"}]})
        state, _ = apply(state, {"type": "dismissed", "edition": "example-brief", "card": "noise", "dismissed": True})
        state, _ = apply(state, {"type": "feedback", "edition": "example-brief", "card": "change", "vote": "more", "note": "这类要", "now": "2026-10-29T02:00:00Z"})
        stored = state["editions"][0]["cards"]
        self.assertTrue(all("seen" not in card and "dismissed" not in card and "feedback" not in card for card in stored))
        view = home_view(state)
        cards = {card["id"]: card for card in view["editions"][0]["cards"]}
        self.assertTrue(cards["decide"]["seen"])
        self.assertTrue(cards["noise"]["dismissed"])
        self.assertEqual(cards["change"]["feedback"]["vote"], "more")
        with self.assertRaises(Invalid) as caught:
            apply(state, {"type": "seen", "cards": [{"edition": "example-brief", "card": "missing"}]})
        self.assertEqual(caught.exception.code, "card_missing")

    def test_hot_window_archives_the_oldest_daily_and_keeps_watch_reports(self):
        state = empty()
        state, _ = apply(state, {"type": "watch", "id": "w1", "text": "盯着示例", "cadence": "daily", "now": "2026-10-28T00:00:00Z"})
        report = {"id": "report", "createdAt": "2026-10-29T03:00:00Z", "goalId": "w1", "cards": [card(1, "watch")]}
        dropped = []
        for index in range(15):
            state, overflow = publish(state, daily(index))
            dropped.extend(overflow)
        state, overflow = publish(state, report)
        dropped.extend(overflow)
        self.assertEqual([item["id"] for item in dropped], ["d00"])
        self.assertNotIn("d00", {item["id"] for item in state["editions"]})
        self.assertIn("d14", {item["id"] for item in state["editions"]})
        self.assertIn("report", {item["id"] for item in state["editions"]})
        self.assertEqual(state["archive"][0]["id"], "d00")
        same, extra = publish(state, daily(0), archived_body=daily(0))
        self.assertIs(same, state)
        self.assertEqual(extra, [])
        with self.assertRaises(Invalid) as caught:
            publish(state, {**daily(0), "tomorrow": "不一样"}, archived_body=daily(0))
        self.assertEqual(caught.exception.code, "edition_conflict")
        with self.assertRaises(Invalid) as caught:
            publish(state, {"id": "orphan", "createdAt": "2026-10-29T04:00:00Z", "goalId": "missing", "cards": []})
        self.assertEqual(caught.exception.code, "watch_missing")

    def test_watch_limit_removal_and_proactivity(self):
        state = empty()
        for index in range(30):
            state, _ = apply(state, {"type": "watch", "id": f"w{index}", "text": f"盯 {index}", "cadence": "brief", "now": "2026-10-29T00:00:00Z"})
        with self.assertRaises(Invalid) as caught:
            apply(state, {"type": "watch", "id": "w30", "text": "再盯", "cadence": "brief", "now": "2026-10-29T00:00:00Z"})
        self.assertEqual(caught.exception.code, "watch_limit")
        state, _ = apply(state, {"type": "remove_watch", "id": "w0"})
        self.assertEqual(len(state["watches"]), 29)
        state, _ = apply(state, {"type": "proactivity", "value": "off"})
        self.assertEqual(state["proactivity"], "off")
        with self.assertRaises(Invalid) as caught:
            apply(state, {"type": "proactivity", "value": "always"})
        self.assertEqual(caught.exception.code, "proactivity_invalid")

    def test_rejects_unsafe_card_fields(self):
        state = empty()
        for mutate, code in (
            (lambda edition: edition["cards"][0].update(entity={"type": "file", "label": "a", "url": "javascript:alert(1)"}), "card_invalid"),
            (lambda edition: edition["cards"].append(edition["cards"][0]), "card_duplicate"),
            (lambda edition: edition.update(id="../escape"), "edition_invalid"),
        ):
            edition = json.loads(json.dumps(EXAMPLE))
            mutate(edition)
            with self.subTest(code=code):
                with self.assertRaises(Invalid) as caught:
                    publish(state, edition)
                self.assertEqual(caught.exception.code, code)


class StoreTests(unittest.TestCase):
    def test_restart_keeps_archive_and_reading(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(directory)
            for index in range(15):
                store.publish(daily(index), "2026-10-29T05:00:00Z")
            store.mark_seen([{"edition": "d14", "card": "c14"}])
            reopened = Store(directory)
            view = reopened.home()
            self.assertEqual(view["archive"][0]["id"], "d00")
            self.assertNotIn("d00", {item["id"] for item in view["editions"]})
            current = next(item for item in view["editions"] if item["id"] == "d14")
            self.assertTrue(current["cards"][0]["seen"])
            archived = reopened.edition("d00")
            self.assertEqual(archived["cards"][0]["id"], "c0")
            seen = reopened.mark_seen([{"edition": "d00", "card": "c0"}])
            self.assertTrue(seen["archive"][0]["id"] == "d00")
            self.assertTrue(reopened.edition("d00")["cards"][0]["seen"])
            again = reopened.publish(daily(0), "2026-10-29T05:00:00Z")
            self.assertEqual(again["archive"][0]["id"], "d00")


class ServerTests(unittest.TestCase):
    def test_token_publish_and_watch(self):
        with tempfile.TemporaryDirectory() as directory:
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler(Store(directory), "secret"))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            self.addCleanup(lambda: (server.shutdown(), server.server_close()))
            base = f"http://127.0.0.1:{server.server_port}"

            def call(method, path, body=None, token="secret"):
                data = None if body is None else json.dumps(body).encode()
                request = Request(base + path, data=data, method=method, headers={"Content-Type": "application/json", "X-Pero-App-Token": token})
                try:
                    with urlopen(request) as response:
                        return response.status, json.load(response)
                except HTTPError as error:
                    with error:
                        return error.code, json.load(error)

            self.assertEqual(call("GET", "/api/home", token="no")[0], 401)
            status, home = call("POST", "/api/editions", EXAMPLE)
            self.assertEqual(status, 201)
            self.assertEqual(home["editions"][0]["id"], "example-brief")
            status, home = call("POST", "/api/watches", {"text": "盯着示例仓库", "cadence": "weekday"})
            self.assertEqual(status, 200)
            self.assertEqual(home["watches"][0]["cadence"], "weekday")
            self.assertEqual(call("GET", "/health", token="")[0], 200)
