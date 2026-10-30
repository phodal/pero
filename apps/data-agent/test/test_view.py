import json
from pathlib import Path
import sys
import tempfile
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer
import threading

sys.path.insert(0, str(Path(__file__).parents[1] / "backend"))
from dataset import Dataset, Invalid
from server import handler
from store import DatasetId, DatasetStore
from view import DatasetView


class DatasetViews(unittest.TestCase):
    def test_view_selection_chart_and_export_share_the_same_records(self):
        data = Dataset.parse('[{"g":"A","n":9007199254740993},{"g":"B","n":2},{"g":"A","n":3}]', 'data.json')
        view = DatasetView.admit({"filter":{"field":"g","operator":"eq","value":"A"},"selection":[2],
                                  "columns":["g"],"limit":10,"chart":{"category":"g","measure":"n","aggregation":"sum"}}, data)
        projected = view.project(data)
        self.assertEqual((projected["matching"], projected["selected"]), (2, 1))
        self.assertEqual(projected["chart"]["points"][0]["exact"], "3")
        self.assertEqual(projected["rows"][0]["cells"], {"g":{"kind":"string","display":"A","truncated":False}})
        exported = json.loads(view.export(data)["content"])
        self.assertEqual(exported["rows"], [{"g":"A","n":3}])
        self.assertEqual(exported["manifest"]["provenance"], [{"ordinal":2,"pointer":"/2","line":None}])
        self.assertEqual(exported["manifest"]["dataset"], data.id)
        selected_read = view.read(data)
        self.assertEqual([row["ordinal"] for row in selected_read["records"]], [2])
        for value in [
            {"columns":["absent"]}, {"selection":[99]}, {"selection":[1,1]}, {"limit":1000},
            {"filter":{"field":"n","operator":"gte","value":"NaN"}},
            {"chart":{"category":"g","measure":"n","aggregation":"invented"}},
        ]:
            with self.subTest(value=value), self.assertRaises(Invalid):
                DatasetView.admit(value, data)

    def test_authenticated_loopback_persists_exact_sources_and_exports(self):
        with tempfile.TemporaryDirectory() as directory:
            store = DatasetStore(directory)
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler(store, "fixture-secret"))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            def call(path, value=None, token="fixture-secret"):
                request = Request(f"http://127.0.0.1:{server.server_port}" + path,
                                  data=json.dumps(value).encode() if value is not None else None,
                                  headers={"X-Pero-App-Token":token,"Content-Type":"application/json"})
                with urlopen(request, timeout=5) as response:
                    return json.load(response)
            try:
                with self.assertRaises(HTTPError) as denied:
                    call('/api/datasets', token='wrong')
                self.assertEqual(denied.exception.code, 401)
                denied.exception.close()
                source = '[\r\n{"n":9007199254740993,"note":"核对"}\r\n]\r\n'
                created = call('/api/import', {"name":"source.json","content":source,"format":"json"})["dataset"]
                ref = DatasetId(created["id"])
                self.assertEqual(DatasetStore(directory).read(ref).source, source)
                self.assertEqual(call('/api/source/' + ref.value)["content"], source)
                result = call('/api/query', {"dataset":ref.value,"columns":["n"]})
                self.assertEqual(result["rows"][0]["cells"]["n"]["display"], "9007199254740993")
                export = call('/api/export', {"dataset":ref.value})
                self.assertIn('9007199254740993', export["content"])
                self.assertEqual((Path(directory)/(export["id"]+'.export.json')).read_text(), export["content"])
                self.assertEqual(call('/api/datasets')["datasets"][0]["id"], ref.value)
            finally:
                server.shutdown();server.server_close();thread.join(5)


if __name__ == "__main__":
    unittest.main()
