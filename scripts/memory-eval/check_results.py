#!/usr/bin/env python3
"""Check live-process receipts and compare deterministic outcomes across runs."""
import argparse
from hashlib import sha256
import json
from pathlib import Path


def check(path):
    report = json.loads(path.read_text())
    fixture = Path(__file__).with_name("fixtures.json")
    assert report["fixture_sha256"] == sha256(fixture.read_bytes()).hexdigest()
    assert (report["fixture_records"], report["fixture_questions"]) == (15, 25)
    assert report["paid_api_calls"] == report["api_cost_usd"] == 0
    for field in ("model", "model_tokens", "llm_answer_accuracy", "dreaming_quality", "wiki_quality"):
        assert report[field] is None, field
    rows = report["observations"]
    backends = set(report["summary"])
    assert backends in ({"no_memory", "search_files", "engram"}, {"no_memory", "search_files", "engram", "hindsight_chunks"})
    assert len(rows) == 25 * len(backends)
    assert len({(r["question"], r["backend"]) for r in rows}) == len(rows)
    assert all(r["raw_wrong_scope"] == 0 for r in rows)
    expected_misses = {
        "search_files": ["Q15-semantic-query"],
        "engram": ["Q15-semantic-query", "Q22-source-changed"],
    }
    if "hindsight_chunks" in backends:
        expected_misses["hindsight_chunks"] = ["Q15-semantic-query", "Q22-source-changed"]
        probe = report["hindsight_probe"]
        assert "LLMNotAvailableError" in probe["reflect_attempt"]["error"]
        assert len(probe["caller_selected_beta_bank"]["hits"]) == 1
        assert any(row.get("phase") == "hindsight_note_deleted" and row.get("absent") for row in report["lifecycle"])
        assert any(row.get("phase") == "hindsight_process_restart" and row.get("fresh_process") for row in report["lifecycle"])
        h = {r["question"]: r for r in rows if r["backend"] == "hindsight_chunks"}
        for q in ("Q19-note-deleted", "Q20-process-restart", "Q23-rebuild-deleted"):
            assert "a10" not in h[q]["raw_ids"]
        assert h["Q25-rebuild-changed"]["decision"]["ids"] == ["a12"]
    for backend, misses in expected_misses.items():
        selected = [r for r in rows if r["backend"] == backend]
        assert [r["question"] for r in selected if not r["gate_matches_fixture"]] == misses
        positives = [r for r in selected if r["expected_ids"]]
        assert len(positives) == 12
        assert sum(r["retrieval_covers_expected"] for r in positives) == 11
    engram = {r["question"]: r for r in rows if r["backend"] == "engram"}
    for question, reason in (
        ("Q05-expired", "expired"), ("Q12-injection-as-data", "untrusted_data"),
        ("Q13-missing-source", "missing_source"),
        ("Q14-false-verification", "no_supporting_verifier_receipt"),
        ("Q17-source-revoked", "revoked"), ("Q18-source-missing", "missing_source"),
        ("Q22-source-changed", "changed_source"),
    ):
        row = engram[question]
        assert row["raw_ids"] and row["decision"]["status"] == "abstain", question
        assert reason in [item[1] for item in row["decision"]["rejected"]], question
    for question in ("Q11-cross-project", "Q19-note-deleted", "Q20-process-restart",
                     "Q23-rebuild-deleted", "Q24-rebuild-revoked"):
        assert engram[question]["raw_ids"] == [], question
    assert engram["Q25-rebuild-changed"]["decision"]["ids"] == ["a12"]
    assert report["lifecycle"][0]["readback"]["isError"] is True
    # Exclude timings, byte counts, storage sizes and ranking ties from replay equality.
    outcomes = []
    for row in rows:
        decision = dict(row["decision"], rejected=sorted(row["decision"]["rejected"]))
        outcomes.append((row["question"], row["backend"], row["raw_ids"], decision,
                         sorted((r["source_ref"], r["source_sha256"]) for r in row["references"])))
    print(f"PASS {path}: {len(rows)} outcomes; known retrieval limitations retained")
    return outcomes


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", nargs="+", type=Path)
    args = parser.parse_args()
    outcomes = [check(path) for path in args.reports]
    assert all(result == outcomes[0] for result in outcomes), "replay outcomes changed"
    if len(outcomes) > 1:
        print(f"PASS identical deterministic outcomes across {len(outcomes)} isolated runs")
