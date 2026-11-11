#!/usr/bin/env python3
"""Synthetic-only local recall experiment; no credentials or live model calls."""
import argparse
from contextlib import ExitStack
from dataclasses import asdict, replace
from hashlib import sha256
import json
import os
from pathlib import Path
import platform
import selectors
import statistics
import subprocess
import time

from model import Claim, Source, Question, Retrieved, Receipt, assess

ENGRAM_REF = "ba9e46ced152c37a7cb9e576153c41995873e2fc"
TOOLS = "mem_save,mem_search,mem_get_observation,mem_delete,mem_stats"
MARKER = "EVAL_PAYLOAD="


class JsonProcess:
    def __init__(self, args, cwd, env, stderr):
        self.log = stderr.open("w")
        self.process = subprocess.Popen(args, cwd=cwd, env=env, stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=self.log, text=True, bufsize=1)
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.process.stdout, selectors.EVENT_READ)
        self.index = 0
        self.received_bytes = 0

    def exchange(self, request):
        self.process.stdin.write(json.dumps(request) + "\n")
        self.process.stdin.flush()
        while True:
            if not self.selector.select(timeout=20):
                raise TimeoutError("local process did not respond within 20 seconds")
            line = self.process.stdout.readline()
            if not line:
                raise RuntimeError(f"local process exited {self.process.poll()}; inspect stderr log")
            self.received_bytes += len(line.encode())
            response = json.loads(line)
            if "id" not in request or response.get("id") == request["id"]:
                return response

    def rpc(self, method, params):
        self.index += 1
        response = self.exchange({"jsonrpc": "2.0", "id": self.index, "method": method, "params": params})
        if "error" in response:
            raise RuntimeError(response["error"])
        return response["result"]

    def tool(self, name, arguments, allow_error=False):
        result = self.rpc("tools/call", {"name": name, "arguments": arguments})
        if result.get("isError") and not allow_error:
            raise RuntimeError(result)
        # This pinned MCP implementation returns its envelope as JSON text.
        blocks = result.get("content", [])
        if len(blocks) == 1 and blocks[0].get("type") == "text" and blocks[0]["text"].startswith("{"):
            result["structuredContent"] = json.loads(blocks[0]["text"])
        return result

    def close(self):
        if self.process.stdin.closed:
            return
        self.process.stdin.close()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        self.process.stdout.close()
        self.selector.close()
        self.log.close()


def start_engram(stack, binary, root, project, logs, suffix):
    data = root / "engram" / project
    data.mkdir(parents=True, exist_ok=True)
    env = {"PATH": os.environ.get("PATH", ""), "HOME": os.environ["HOME"], "ENGRAM_DATA_DIR": str(data),
           "ENGRAM_PROJECT": project, "ENGRAM_CLOUD_AUTOSYNC": "0"}
    process = JsonProcess([str(binary), "mcp", "--project", project, f"--tools={TOOLS}"],
                          root, env, logs / f"engram-{project}-{suffix}.stderr")
    stack.callback(process.close)
    process.rpc("initialize", {"protocolVersion": "2024-11-05", "capabilities": {},
                                "clientInfo": {"name": "pero-synthetic-memory-eval", "version": "1"}})
    process.process.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
    process.process.stdin.flush()
    return process


def save(process, claim):
    payload = {"source_ref": claim.source_ref, "source_sha256": claim.digest()}
    result = process.tool("mem_save", {"title": claim.id + " " + claim.topic,
        "content": claim.text() + "\n" + MARKER + json.dumps(payload, sort_keys=True),
        "type": "decision", "capture_prompt": False})
    return result["structuredContent"]["id"]


def source_snapshot(root, claims):
    sources = {}
    for claim in claims:
        path = root / "transcripts" / claim.project / f"{claim.id}.jsonl"
        if path.exists():
            data = path.read_bytes()
            value = Claim.parse(json.loads(data))
            sources[value.source_ref] = Source(value, sha256(data).hexdigest())
    return sources


def search_native(process, root, question):
    before = process.received_bytes
    response = process.exchange({"root": str(root / "transcripts" / question.project), "text": question.query})
    if response.get("error"):
        raise RuntimeError(response["error"])
    if response["search"]["truncated"]:
        raise RuntimeError("fixture exceeded actual search_files budget")
    hits = []
    for read in response.get("reads") or []:
        if read["truncated"]:
            raise RuntimeError("source readback is incomplete")
        claim = Claim.parse(json.loads(read["content"]))
        hits.append(Retrieved(claim.source_ref, read["digest"].removeprefix("sha256:")))
    return hits, process.received_bytes - before, 1 + len(hits)


def search_engram(process, question):
    # all_projects is deliberate: a separate directory, not a query filter, owns isolation.
    before = process.received_bytes
    response = process.tool("mem_search", {"query": question.query, "limit": 20, "all_projects": True})
    hits, calls = [], 1
    for item in response.get("structuredContent", {}).get("results", []):
        full = process.tool("mem_get_observation", {"id": item["id"]})
        calls += 1
        payloads = [line[len(MARKER):] for line in full["structuredContent"]["result"].splitlines() if line.startswith(MARKER)]
        if len(payloads) != 1:
            raise ValueError("full observation lost its source payload")
        hits.append(Retrieved(**json.loads(payloads[0])))
    return hits, process.received_bytes - before, calls


def run(args):
    build_info = subprocess.run(["go", "version", "-m", str(args.engram.resolve())],
                                check=True, capture_output=True, text=True).stdout
    if f"vcs.revision={ENGRAM_REF}\n" not in build_info or "vcs.modified=false\n" not in build_info:
        raise ValueError("Engram must be built from the clean pinned source revision")
    fixture_path = Path(__file__).with_name("fixtures.json")
    raw = json.loads(fixture_path.read_text())
    if raw["schema"] != 1 or raw["synthetic"] is not True:
        raise ValueError("this runner accepts only its synthetic fixture")
    claims = tuple(Claim.parse(row) for row in raw["records"])
    questions = tuple(Question.parse(row) for row in raw["questions"])
    if len({c.id for c in claims}) != len(claims):
        raise ValueError("duplicate source identity")
    # Golden answer fields never enter a source, note or query sent to a backend.
    root = args.output.resolve()
    root.mkdir(parents=True, exist_ok=False)
    logs = root / "logs"
    logs.mkdir()
    paths = {}
    for claim in claims:
        path = root / "transcripts" / claim.project / f"{claim.id}.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        paths[claim.id] = path
        if claim.export:
            path.write_text(claim.text() + "\n")
    by_id = {c.id: c for c in claims}
    receipt = Receipt("verifier://synthetic/run-blue", by_id["a06"].source_ref, "0.62", "passed", True)
    receipt_path = root / "synthetic-verifier.json"
    receipt_path.write_text(json.dumps(asdict(receipt), sort_keys=True))
    receipts = (Receipt(**json.loads(receipt_path.read_text())),)
    observations, revoked, lifecycle = [], set(), []
    started = time.perf_counter()
    with ExitStack() as stack:
        search = JsonProcess([str(args.search_binary.resolve())], root,
                             {"PATH": os.environ.get("PATH", "")}, logs / "search.stderr")
        stack.callback(search.close)
        processes = {p: start_engram(stack, args.engram.resolve(), root, p, logs, "initial") for p in ("alpha", "beta")}
        ids = {c.id: save(processes[c.project], c) for c in claims}
        ingest_ms = (time.perf_counter() - started) * 1000
        # Close producer session and start fresh readers; no transcript is passed as prompt history.
        for process in processes.values():
            process.close()
        processes = {p: start_engram(stack, args.engram.resolve(), root, p, logs, "reader") for p in ("alpha", "beta")}
        last_phase = "initial"
        for question in questions:
            if question.phase != last_phase:
                last_phase = question.phase
                if last_phase == "revoked":
                    revoked.add(by_id["a11"].source_ref)
                elif last_phase == "source_deleted":
                    paths["a10"].unlink()
                elif last_phase == "note_deleted":
                    result = processes["alpha"].tool("mem_delete", {"id": ids["a10"], "hard_delete": True})
                    read = processes["alpha"].tool("mem_get_observation", {"id": ids["a10"]}, allow_error=True)
                    if not read.get("isError"):
                        raise AssertionError("deleted note remains readable by ID")
                    lifecycle.append({"phase": last_phase, "delete": result, "readback": read})
                elif last_phase == "restarted":
                    processes["alpha"].close()
                    processes["alpha"] = start_engram(stack, args.engram.resolve(), root, "alpha", logs, "restart")
                elif last_phase == "source_changed":
                    changed = replace(by_id["a12"], value="REPLACED-19", statement="mutabletext: REPLACED-19")
                    paths["a12"].write_text(changed.text() + "\n")
                elif last_phase == "rebuilt":
                    processes["alpha"].close()
                    # A new derived store from currently allowed source exports; old DB is retained as experiment evidence.
                    before = source_snapshot(root, claims)
                    for claim in claims:
                        if claim.source_ref in revoked and paths[claim.id].exists():
                            paths[claim.id].unlink()
                    rebuild = root / "rebuild"
                    rebuild.mkdir()
                    processes["alpha"] = start_engram(stack, args.engram.resolve(), rebuild, "alpha", logs, "rebuilt")
                    for snapshot in before.values():
                        source = snapshot.claim
                        if source.project == "alpha" and source.source_ref not in revoked:
                            save(processes["alpha"], source)
                    lifecycle.append({"phase": last_phase, "sources": sorted(s.claim.id for s in before.values()
                                      if s.claim.project == "alpha" and s.claim.source_ref not in revoked)})
                else:
                    raise ValueError("unknown phase")
            sources = source_snapshot(root, claims)
            for backend in ("no_memory", "search_files", "engram"):
                begin = time.perf_counter()
                if backend == "no_memory":
                    hits, size, calls = [], 0, 0
                elif backend == "search_files":
                    hits, size, calls = search_native(search, root, question)
                else:
                    hits, size, calls = search_engram(processes[question.project], question)
                elapsed_ms = (time.perf_counter() - begin) * 1000
                decision = assess(question, hits, sources, revoked, receipts)
                raw_ids = sorted({by_id_ref.id for hit in hits for by_id_ref in claims if hit.source_ref == by_id_ref.source_ref})
                row = {"question": question.id, "phase": question.phase, "backend": backend,
                       "raw_ids": raw_ids, "references": [asdict(h) for h in hits],
                       "decision": asdict(decision), "expected_ids": question.expected_ids,
                       "expected_status": question.expected_status,
                       "gate_matches_fixture": decision.ids == question.expected_ids and decision.status == question.expected_status,
                       "retrieval_covers_expected": set(question.expected_ids).issubset(raw_ids),
                       "raw_wrong_scope": sum(by_id[i].project != question.project for i in raw_ids),
                       "source_readback_valid": sum(h.source_ref in sources and sources[h.source_ref].sha256 == h.source_sha256 for h in hits),
                       "response_bytes": size, "tool_calls": calls, "retrieval_ms": elapsed_ms}
                observations.append(row)
        stats = {p: process.tool("mem_stats", {}) for p, process in processes.items()}
    summary = {}
    for backend in ("no_memory", "search_files", "engram"):
        rows = [r for r in observations if r["backend"] == backend]
        positive = [r for r in rows if r["expected_ids"]]
        times = sorted(r["retrieval_ms"] for r in rows)
        summary[backend] = {"questions": len(rows), "positive_questions": len(positive),
            "covered_positive_questions": sum(r["retrieval_covers_expected"] for r in positive),
            "gate_matches": sum(r["gate_matches_fixture"] for r in rows),
            "gate_mismatches": [r["question"] for r in rows if not r["gate_matches_fixture"]],
            "wrong_scope_hits": sum(r["raw_wrong_scope"] for r in rows),
            "source_readback_valid": sum(r["source_readback_valid"] for r in rows),
            "returned_hits": sum(len(r["references"]) for r in rows),
            "response_bytes": sum(r["response_bytes"] for r in rows),
            "tool_calls": sum(r["tool_calls"] for r in rows),
            "median_retrieval_ms": statistics.median(times), "p95_retrieval_ms": times[int(len(times)*.95)]}
    report = {"schema": 1, "fixture_sha256": sha256(fixture_path.read_bytes()).hexdigest(),
              "environment": {"python": platform.python_version(), "system": platform.system(),
                              "release": platform.release(), "machine": platform.machine()},
              "engram_build_info": build_info,
              "evaluation_sha256": {p.name: sha256(p.read_bytes()).hexdigest() for p in
                                    Path(__file__).parent.glob("*.py")},
              "engram_ref": ENGRAM_REF, "fixture_records": len(claims), "fixture_questions": len(questions),
              "model": None, "llm_answer_accuracy": None, "dreaming_quality": None, "wiki_quality": None,
              "model_tokens": None, "paid_api_calls": 0, "api_cost_usd": 0,
              "ingest_and_startup_ms": ingest_ms, "summary": summary, "observations": observations,
              "lifecycle": lifecycle, "stats": stats,
              "disk_bytes": {label: sum(p.stat().st_size for p in (root / label).rglob('*') if p.is_file())
                             for label in ("transcripts", "engram", "rebuild")},
              "binary_sha256": {"engram": sha256(args.engram.read_bytes()).hexdigest(),
                                "search_files": sha256(args.search_binary.read_bytes()).hexdigest()}}
    (root / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engram", type=Path, required=True)
    parser.add_argument("--search-binary", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True, help="new, isolated experiment directory")
    run(parser.parse_args())
