#!/usr/bin/env python3
"""One-shot synthetic review, artifact/checkpoint failure recovery and Wiki comparison."""
import argparse
from dataclasses import asdict
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
import time

from model import Claim, Question, Retrieved, Source, assess
from review import ReviewState, analyze, publish, revoke, context
from evaluate import JsonProcess, search_native, source_snapshot


def run(args):
    fixture = Path(__file__).with_name("fixtures.json")
    raw = json.loads(fixture.read_text())
    claims = tuple(Claim.parse(row) for row in raw["records"])
    sources = {c.source_ref: Source(c, c.digest()) for c in claims if c.export}
    references = tuple(Retrieved(c.source_ref, c.digest()) for c in claims)
    questions = [Question.parse(row) for row in raw["questions"]]
    root = args.output.absolute()
    root.mkdir(parents=True, exist_ok=args.resume)
    for claim in claims:
        if claim.export:
            path = root / "transcripts" / claim.project / (claim.id + ".jsonl")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(claim.text() + "\n")
    sources = source_snapshot(root, claims)
    checkpoint = root / "checkpoint.json"
    state = ReviewState.parse(json.loads(checkpoint.read_text())) if checkpoint.exists() else ReviewState()
    start = time.perf_counter()
    draft = analyze(questions[0], references, sources, (), (), closed=True, permitted=True, watermark=3)
    (root / "review-draft.md").write_text(draft.markdown)
    if not args.approve:
        print(json.dumps({"status": "review_required", "active_pages": len(state.active)}))
        return
    next_state = publish(state, draft, sources, (), (), approved_key=draft.key, expected_revision=state.revision)
    artifact = root / (draft.key + ".md")
    if artifact.exists() and artifact.read_text() != draft.markdown:
        raise ValueError("artifact_content_changed")
    artifact.write_text(draft.markdown)
    # Crash here leaves an unreferenced version, never an active approved page.
    if args.fail_after_artifact:
        print(json.dumps({"status": "injected_failure_before_checkpoint", "active_pages": len(state.active)}))
        return 3
    temporary = root / "checkpoint.tmp"
    temporary.write_text(json.dumps(asdict(next_state), indent=2))
    os.replace(temporary, checkpoint)
    state = next_state
    search = JsonProcess([str(args.search_binary.resolve())], root,
                         {"PATH": os.environ.get("PATH", "")}, root / "search.stderr")
    rows = []
    for q in (questions[8], questions[5]):  # Single source and conflicting cross-document question.
        hits, wire_bytes, calls = search_native(search, root, q)
        baseline = assess(q, hits, sources, (), ())
        page = analyze(q, hits, sources, (), (), closed=True, permitted=True, watermark=3)
        wiki_state = publish(state, page, sources, (), (), approved_key=page.key, expected_revision=state.revision)
        body, decision = context(wiki_state, q, sources, (), (), 4096)
        (root / (q.topic + ".md")).write_text(body)
        rows.append({"question": q.id, "sources": len(decision.ids), "search_decision": asdict(baseline),
                     "wiki_decision": asdict(decision), "same_decision": baseline.ids == decision.ids and baseline.status == decision.status,
                     "search_transport_bytes": wire_bytes, "search_calls": calls,
                     "search_source_bytes": sum(len(sources[r.source_ref].claim.text().encode()) for r in hits),
                     "wiki_bytes": len(body.encode()), "llm_answer_accuracy": None})
    search.close()
    (root / "_index.md").write_text("# Synthetic reviewed pages\n\n" + "\n".join(
        f"- [{name}]({name}.md)" for name in (questions[8].topic, questions[5].topic)) + "\n")
    ref = draft.references[0].source_ref
    withdrawn = revoke(state, {ref})
    assert context(withdrawn, questions[0], sources, {ref}, (), 4096)[0] == ""
    report = {"fixture_sha256": sha256(fixture.read_bytes()).hexdigest(), "revision": state.revision,
              "watermark": state.watermark, "active_pages": len(state.active),
              "immutable_versions": len(list(root.glob("[0-9a-f]" * 64 + ".md"))),
              "review": "explicit synthetic operator approval", "revocation_hides_context": True,
              "wiki_comparison": rows, "wall_ms": (time.perf_counter()-start)*1000,
              "analyzer": "deterministic authored annotations, not LLM Dreaming",
              "model_tokens": None, "dreaming_quality": None, "paid_api_calls": 0, "api_cost_usd": 0,
              "page_bytes": sum(p.stat().st_size for p in root.glob("*.md"))}
    (root / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--search-binary", type=Path, required=True)
    parser.add_argument("--approve", action="store_true", help="explicit approval of this synthetic draft only")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--fail-after-artifact", action="store_true")
    sys.exit(run(parser.parse_args()) or 0)
