#!/usr/bin/env python3
"""Execute model-free candidate APIs; never load provider credentials."""
import argparse
import asyncio
from datetime import datetime, timezone
from importlib import metadata
import json
from pathlib import Path
import socket
import time


def langmem_probe():
    from langgraph.store.memory import InMemoryStore
    from langmem import create_manage_memory_tool, create_search_memory_tool

    store = InMemoryStore()
    tool = create_manage_memory_tool(("alpha",), store=store)
    created = tool.invoke({"content": "retrybudget=3; transcript://alpha/session-a#a01"})
    identity = created.rsplit(" ", 1)[1]
    tool.invoke({"action": "update", "id": identity, "content": "retrybudget=5; transcript://alpha/session-b#a02"})
    current = json.loads(create_search_memory_tool(("alpha",), store=store).invoke({"query": "retrybudget"}))
    beta = json.loads(create_search_memory_tool(("beta",), store=store).invoke({"query": "retrybudget"}))
    tool.invoke({"action": "delete", "id": identity})
    deleted = json.loads(create_search_memory_tool(("alpha",), store=store).invoke({"query": "retrybudget"}))
    assert len(current) == 1 and "retrybudget=5" in str(current)
    assert beta == [] and deleted == []
    return {"create_update_search_delete": "passed", "namespace_filter": "passed",
            "historical_versions": "update replaced the same key; caller must retain history separately",
            "storage": "LangGraph InMemoryStore, no embedding index",
            "quality_score": None, "llm_reflection": "not executed: no authorized model",
            "deployment": "Python library; persistence and model remain caller dependencies"}


async def graphiti_probe():
    from graphiti_core.edges import EntityEdge
    from graphiti_core.search.search_filters import SearchFilters, DateFilter, ComparisonOperator, edge_search_filter_query_constructor
    from graphiti_core.driver.driver import GraphProvider
    from neo4j import AsyncGraphDatabase
    from neo4j.exceptions import ServiceUnavailable

    when = datetime(2026, 11, 5, tzinfo=timezone.utc)
    edge = EntityEdge(uuid="synthetic-edge", group_id="alpha", source_node_uuid="source",
        target_node_uuid="target", name="retrybudget", fact="5", episodes=["synthetic-session-b"],
        created_at=when, valid_at=when)
    filters = SearchFilters(valid_at=[[DateFilter(date=when, comparison_operator=ComparisonOperator.less_than_equal)]],
                            invalid_at=[[DateFilter(comparison_operator=ComparisonOperator.is_null)]])
    query, parameters = edge_search_filter_query_constructor(filters, GraphProvider.NEO4J)
    assert any("valid_at" in clause for clause in query)
    assert edge.episodes == ["synthetic-session-b"] and edge.group_id == "alpha"
    # Bind an unused ephemeral port without listening: an actual driver attempt,
    # bounded and guaranteed not to contact an existing/user database.
    with socket.socket() as reserved:
        reserved.bind(("127.0.0.1", 0))
        port = reserved.getsockname()[1]
        driver = AsyncGraphDatabase.driver(f"bolt://127.0.0.1:{port}", auth=("synthetic", "synthetic"), connection_timeout=1)
        try:
            await driver.verify_connectivity()
            raise AssertionError("reserved non-listening socket unexpectedly accepted connection")
        except ServiceUnavailable as error:
            failure = type(error).__name__ + ": " + str(error)
        finally:
            await driver.close()
    return {"temporal_and_episode_API": "passed", "query": query, "parameters": parameters,
            "backend_attempt": failure, "graph_execution": "blocked: no configured graph service; Docker daemon unavailable",
            "quality_score": None, "llm_extraction": "not executed: no authorized model"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidate", choices=("langmem", "graphiti"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    started = time.perf_counter()
    result = langmem_probe() if args.candidate == "langmem" else asyncio.run(graphiti_probe())
    result.update(candidate=args.candidate, elapsed_ms=(time.perf_counter()-started)*1000,
                  paid_api_calls=0, model_tokens=None)
    # Installed metadata, including unknown licenses, is evidence rather than a
    # fabricated blanket transitive-license approval.
    result["dependencies"] = sorted([{"name": d.metadata["Name"], "version": d.version,
        "license": d.metadata.get("License-Expression") or (d.metadata.get("License") or "unknown")[:160]}
        for d in metadata.distributions()], key=lambda row: row["name"].lower())
    args.output.write_text(json.dumps(result, default=str, indent=2) + "\n")
