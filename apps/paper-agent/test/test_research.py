"""Behavioral parity for the Python port of Point Paper Agent's local core."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parents[1] / "backend"))
from paper_agent.model import Invalid, PaperSnapshot, ResearchInput, ResearchRequest, REPORT_SCHEMA, digest
from paper_agent.reports import EvidenceReference, ResearchReport
from paper_agent.store import ResearchStore

NOW = "2026-10-29T08:00:00Z"


def reading(content="# Method\nExact original evidence.\nNo experiment was performed.", **changes):
    return {**dict(title="Synthetic paper", source="import", sourceId="fixture-v1", url="https://example.invalid/paper",
                   contentKind="full-text", content=content, authors=["Synthetic fixture"]), **changes}


def request(papers, verify=False, **changes):
    return ResearchRequest.parse({**dict(question="What does the source support?", paperIds=[paper.id for paper in papers],
                                         requestId="request-one", verifyCode=verify,
                                         verificationPlan="CPU only; no dependencies" if verify else ""), **changes})


def report_value(intent):
    return dict(schema=REPORT_SCHEMA, intentId=intent.id, title="Research evidence", sections=[
        dict(heading="Finding", content="Only a synthetic example is established.", paperIds=[intent.papers[0].id],
             evidence=[dict(paperId=intent.papers[0].id, quote="Exact original evidence.")])],
        experiments=[], limitations="Synthetic evidence; scientific acceptance remains unverified.")


class ResearchDocuments(unittest.TestCase):
    def test_source_and_input_integrity(self):
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            paper = store.save_paper(PaperSnapshot.from_reading(reading(), NOW))
            later = store.save_paper(PaperSnapshot.from_reading(reading(), "2026-10-30T08:00:00Z"))
            self.assertEqual(later, paper)
            frozen = store.prepare(request([paper]), NOW)
            self.assertEqual(store.prepare(request([paper]), "2026-10-30T08:00:00Z"), frozen)
            changed = dict(question="A different question", paperIds=[paper.id], requestId="request-one", verifyCode=False)
            with self.assertRaises(Invalid) as conflict:
                store.prepare(ResearchRequest.parse(changed), NOW)
            self.assertEqual(conflict.exception.status, 409)
            reopened = ResearchStore(root)
            self.assertEqual(reopened.intent(frozen.id), frozen)
            self.assertEqual(reopened.library()["papers"][0]["contentDigest"], paper.content_digest)
            self.assertNotIn("content", reopened.library()["papers"][0])
        for value in [reading(contentDigest="sha256:" + "0" * 64), reading(content=""), reading(contentKind="pdf"), reading(url="file:///tmp/paper")]:
            with self.subTest(value=value), self.assertRaises(Invalid):
                PaperSnapshot.from_reading(value, NOW)

    def test_research_selection_and_context_budget(self):
        paper = PaperSnapshot.from_reading(reading(), NOW)
        for selected in ([], [paper.id] * 2, [paper.id] * 6, ["missing"]):
            with self.subTest(selected=selected), self.assertRaises(Invalid):
                ResearchRequest.parse(dict(question="Question", paperIds=selected, requestId="test"))
        for request_id in ("legacy:request", "x" * 49):
            with self.subTest(request_id=request_id), self.assertRaises(Invalid):
                request([paper], requestId=request_id)
        large = PaperSnapshot.from_reading(reading(content="研" * 50000), NOW)
        with self.assertRaisesRegex(Invalid, "128,000-byte"):
            ResearchInput.prepare(request([large]), [large], NOW)
        too_large = PaperSnapshot.from_reading(reading(content="x" * 80001), NOW)
        with self.assertRaisesRegex(Invalid, "80,000"):
            ResearchInput.prepare(request([too_large]), [too_large], NOW)

    def test_report_contract_and_exact_evidence(self):
        paper = PaperSnapshot.from_reading(reading(), NOW)
        other = PaperSnapshot.from_reading(reading(content="A second paper has no matching quote."), NOW)
        intent = ResearchInput.prepare(request([paper, other]), [paper, other], NOW)
        valid = report_value(intent)
        mutations = [
            lambda item: item.update(intentId="0" * 64),
            lambda item: item.update(sections=[]),
            lambda item: item["sections"][0].update(paperIds=["0" * 64]),
            lambda item: item["sections"][0].update(evidence=item["sections"][0]["evidence"] * 9),
            lambda item: item["sections"][0]["evidence"][0].update(quote="Invented evidence."),
            lambda item: item["sections"][0]["evidence"][0].update(paperId=other.id),
            lambda item: item["sections"][0].update(paperIds=[other.id]),
        ]
        for mutate in mutations:
            value = copy.deepcopy(valid)
            mutate(value)
            with self.subTest(value=value), self.assertRaises(Invalid):
                ResearchReport.parse(value, intent)
        legacy = {**valid, "schema": "point.paper-agent-report.v1", "acceptance": "verified"}
        parsed = ResearchReport.from_text("```json\n" + json.dumps(legacy) + "\n```", intent)
        self.assertEqual(parsed.to_dict()["acceptance"], "unverified")
        legacy["sections"][0].pop("evidence")
        self.assertEqual(ResearchReport.parse(legacy, intent).sections[0].evidence, ())
        ref = EvidenceReference(paper.id, "\nExact original evidence.\n")
        located = ref.locate(intent.papers)
        self.assertEqual(located["heading"], "Method")
        self.assertEqual(paper.content[located["start"]:located["end"]], ref.quote)

    def test_evidence_matrix_values_and_source_boundaries(self):
        paper = PaperSnapshot.from_reading(reading(), NOW)
        intent = ResearchInput.prepare(request([paper]), [paper], NOW)
        value = report_value(intent)
        self.assertNotIn("matrix", ResearchReport.parse(value, intent).to_dict())
        value["matrix"] = dict(columns=[dict(id="finding", label="Finding"), dict(id="data", label="Data")], cells=[
            dict(paperId=paper.id, columnId="finding", value="Synthetic only", status="supported",
                 evidence=[dict(paperId=paper.id, quote="Exact original evidence.")]),
            dict(paperId=paper.id, columnId="data", value="", status="missing", evidence=[])])
        value["sections"][0]["content"] = "Read [source](evidence:1)"
        parsed = ResearchReport.parse(value, intent)
        self.assertIn("[source](https://example.invalid/paper)", parsed.markdown(intent))
        self.assertEqual(parsed.to_dict()["matrix"], value["matrix"])
        self.assertIn("## Evidence matrix", parsed.markdown(intent))
        self.assertIn("Exact original evidence.", parsed.markdown(intent))
        mutations = [
            lambda m: m["columns"].append(m["columns"][0]),
            lambda m: m["cells"].append(m["cells"][0]),
            lambda m: m["cells"][0].update(paperId="0" * 64),
            lambda m: m["cells"][0].update(columnId="unknown"),
            lambda m: m["cells"][0].update(evidence=[]),
            lambda m: m["cells"][0].update(status="conflict"),
            lambda m: m["cells"][0]["evidence"][0].update(quote="Invented quote"),
            lambda m: m["cells"][1].update(value="Unsupported result"),
            lambda m: m["cells"][1].update(value=0),
        ]
        for mutate in mutations:
            invalid = copy.deepcopy(value)
            mutate(invalid["matrix"])
            with self.subTest(matrix=invalid["matrix"]), self.assertRaises(Invalid):
                ResearchReport.parse(invalid, intent)
        value["matrix"]["cells"][0].update(status="conflict", evidence=[
            dict(paperId=paper.id, quote="Exact original evidence."),
            dict(paperId=paper.id, quote="No experiment was performed.")])
        self.assertEqual(ResearchReport.parse(value, intent).matrix.cells[0].status, "conflict")
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            store.save_paper(paper)
            frozen = store.prepare(request([paper]), NOW)
            saved = store.save_report(frozen.id, json.dumps(value), NOW)
            self.assertEqual(store.report(saved.id), saved)
            self.assertEqual(json.loads(store.export(saved.id, "json")["content"])["matrix"], value["matrix"])

    def test_experiments_and_portable_export(self):
        paper = PaperSnapshot.from_reading(reading(), NOW)
        intent = ResearchInput.prepare(request([paper], True), [paper], NOW)
        value = report_value(intent)
        with self.assertRaisesRegex(Invalid, "experiment"):
            ResearchReport.parse(value, intent)
        experiment = dict(title="Verification", paperIds=[paper.id], status="blocked", files=[], commands=[],
                          expected="Run against fixed reference", observed="Required data is unavailable", limitations="Not executed")
        value["experiments"] = [experiment]
        self.assertEqual(ResearchReport.parse(value, intent).experiments[0].status, "blocked")
        for mutation in [dict(status="passed"), dict(status="skipped"), dict(files=[dict(path="../escape.py", language="python", content="pass")])]:
            invalid = copy.deepcopy(value)
            invalid["experiments"][0].update(mutation)
            with self.subTest(mutation=mutation), self.assertRaises(Invalid):
                ResearchReport.parse(invalid, intent)
        code = 'print("````")\nprint("<script>")'
        experiment.update(status="passed", files=[dict(path="check.py", language="python", content=code)], commands=["python check.py"])
        value["sections"][0]["content"] = "<script>model draft</script>"
        result = ResearchReport.parse(value, intent)
        markdown = result.markdown(intent)
        self.assertIn("`````python\n" + code + "\n`````", markdown)
        self.assertIn("&lt;script&gt;model draft&lt;/script&gt;", markdown)
        self.assertIn("agent-reported", markdown)
        with tempfile.TemporaryDirectory() as root:
            store = ResearchStore(root)
            store.save_paper(paper)
            stored_input = store.prepare(request([paper], True), NOW)
            saved = store.save_report(stored_input.id, json.dumps(value), NOW, "session-example")
            again = store.save_report(stored_input.id, json.dumps(value), "2026-10-30T08:00:00Z", "session-example")
            self.assertEqual(saved, again)
            self.assertEqual(store.report(saved.id), saved)
            self.assertEqual(store.export(saved.id, "json")["mime"], "application/json")
            self.assertEqual(store.export(saved.id, "markdown")["content"], markdown)
            self.assertEqual(saved.to_dict()["binding"]["provenance"], "client-reported")


if __name__ == "__main__":
    unittest.main()
