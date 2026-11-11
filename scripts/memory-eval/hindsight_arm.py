#!/usr/bin/env python3
"""Pinned Hindsight API/process probe, synthetic chunks only; no LLM or ML model."""
import argparse
import faulthandler
import asyncio
from contextlib import redirect_stdout
from datetime import datetime
from hashlib import sha256
import json
import math
import os
from pathlib import Path
import re
import sys

# Set before importing upstream configuration. No credential/provider fallback.
os.environ.update(HINDSIGHT_API_LLM_PROVIDER="none", HINDSIGHT_API_RETAIN_EXTRACTION_MODE="chunks",
                  HINDSIGHT_API_RERANKER_PROVIDER="rrf", HINDSIGHT_API_EMBEDDINGS_PROVIDER="openai",
                  HINDSIGHT_API_SKIP_LLM_VERIFICATION="true", HINDSIGHT_API_ENABLE_OBSERVATIONS="false")

from pg0 import Pg0
from hindsight_api.engine.embeddings import Embeddings
from hindsight_api.engine.cross_encoder import RRFPassthroughCrossEncoder
from hindsight_api.engine.memory_engine import MemoryEngine
from hindsight_api.models import RequestContext


class HashEmbeddings(Embeddings):
    """Explicit deterministic test seam; not a semantic embedding quality test."""
    provider_name = "synthetic-hash-bag-64"
    dimension = 64

    async def initialize(self):
        pass

    async def encode(self, texts):
        vectors = []
        for text in texts:
            vector = [0.0] * self.dimension
            for word in re.findall(r"\w+", text.lower()):
                vector[int.from_bytes(sha256(word.encode()).digest()[:4], "big") % self.dimension] += 1
            norm = math.sqrt(sum(v * v for v in vector)) or 1
            vectors.append([v / norm for v in vector])
        return vectors


async def serve(root, output):
    # Pg0 owns a fresh explicit data directory and auto-selected port, not a user's DB.
    database = Pg0(name="pero-synthetic-" + sha256(str(root).encode()).hexdigest()[:12],
                   data_dir=str(root / "postgres"), config={"listen_addresses": "127.0.0.1"})
    engine = None
    generation = 0
    context = RequestContext()
    try:
        while line := await asyncio.to_thread(sys.stdin.readline):
            request = json.loads(line)
            action = request["action"]
            print(json.dumps({"phase": "begin", "action": action}), file=sys.stderr, flush=True)
            faulthandler.dump_traceback_later(30, file=sys.stderr)
            try:
                async with asyncio.timeout(90):
                    if action == "init":
                        info = database.start()
                        engine = MemoryEngine(db_url=info.uri, memory_llm_provider="none",
                            embeddings=HashEmbeddings(), cross_encoder=RRFPassthroughCrossEncoder(),
                            pool_min_size=1, pool_max_size=4, skip_llm_verification=True)
                        await engine.initialize()
                        result = {"ready": True, "embedding": "synthetic-hash-bag-64", "llm": None}
                    elif action == "save":
                        claim = json.loads(request["text"])
                        bank = claim["project"] + (f"-rebuild-{generation}" if generation and claim["project"] == "alpha" else "")
                        ids = await engine.retain_async(bank, request["text"], document_id=claim["id"],
                            event_date=datetime.fromisoformat(claim["observed_at"].replace("Z", "+00:00")),
                            request_context=context)
                        result = {"ids": ids}
                    elif action == "query":
                        bank = request["project"] + (f"-rebuild-{generation}" if generation and request["project"] == "alpha" else "")
                        recalled = await engine.recall_async(bank, request["query"], max_tokens=4096,
                            request_context=context, reranking="rrf")
                        documents = []
                        for item in recalled.results:
                            if item.document_id and item.document_id not in documents:
                                documents.append(item.document_id)
                        hits = []
                        for document_id in documents[:20]:
                            document = await engine.get_document(document_id, bank, request_context=context)
                            text = document["original_text"]
                            claim = json.loads(text)
                            hits.append({"source_ref": claim["source_ref"],
                                         "source_sha256": sha256((text + "\n").encode()).hexdigest()})
                        result = {"hits": hits, "calls": 1 + len(hits)}
                    elif action == "delete":
                        await engine.delete_document(request["id"], request["project"], request_context=context)
                        result = {"absent": await engine.get_document(request["id"], request["project"], request_context=context) is None}
                    elif action == "rebuild":
                        generation += 1
                        result = {"generation": generation}
                    elif action == "reflect":
                        result = await engine.reflect_async("alpha", "What is the retry budget?", request_context=context)
                        result = {"result": str(result)}
                    elif action == "close":
                        break
                    else:
                        raise ValueError("unknown probe action")
                print(json.dumps({"phase": "end", "action": action}), file=sys.stderr, flush=True)
                print(json.dumps(result, default=str), file=output, flush=True)
            except Exception as error:
                print(json.dumps({"error": type(error).__name__ + ": " + str(error), "action": action}), file=output, flush=True)
                if action == "init":
                    break
            finally:
                faulthandler.cancel_dump_traceback_later()
    finally:
        if engine is not None:
            await engine.close()
        database.stop()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    args.root.mkdir(parents=True, exist_ok=True)
    with redirect_stdout(sys.stderr):
        asyncio.run(serve(args.root.resolve(), sys.__stdout__))
