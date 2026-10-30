"""Hybrid keyword and vector ranking.

The fusion rule follows KiroCrew's knowledge retriever (Apache-2.0): reciprocal
rank fusion with k = 60, keyword weight 1, vector weight 2. Cosine similarity
refuses a vector whose width differs, and a signature names the embedding space
so an older model cannot be scored as if it were the current one.

Query strings use the Qwen3-Embedding instruction prefix. Passages are embedded
as the title plus the original slice, without that prefix.
"""
import hashlib
import struct

VECTOR_WEIGHT = 2.0
RRF_K = 60
QUERY_TASK = "Given a research question, retrieve paper passages that answer the query"


def query_input(question: str) -> str:
    return f"Instruct: {QUERY_TASK}\nQuery: {question}"


def passage_input(title: str, content: str) -> str:
    title = title.strip()
    return f"{title}\n{content}" if title else content


def space_signature(model_id: str, dim: int) -> str:
    raw = f"{model_id}|{dim}|last|{QUERY_TASK}|title-newline"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def pack_vector(values) -> bytes:
    return struct.pack(f"<{len(values)}f", *[float(value) for value in values])


def unpack_vector(blob) -> list:
    if not blob or len(blob) % 4:
        return []
    return list(struct.unpack(f"<{len(blob) // 4}f", blob))


def _norm(values) -> float:
    return sum(value * value for value in values) ** 0.5


def vector_ranks(query, rows) -> list:
    """Rank ``(id, vector)`` rows by cosine. Rank 1 is the closest positive score.

    A different width, a zero vector, or a non-positive cosine is omitted.
    """
    query_norm = _norm(query)
    if query_norm == 0.0:
        return []
    width = len(query)
    scored = []
    for identity, vector in rows:
        if len(vector) != width:
            continue
        norm = _norm(vector)
        if norm == 0.0:
            continue
        similarity = sum(left * right for left, right in zip(query, vector)) / (query_norm * norm)
        if similarity > 0.0:
            scored.append((identity, similarity))
    scored.sort(key=lambda item: (-item[1], item[0]))
    return [(identity, rank) for rank, (identity, _) in enumerate(scored, start=1)]


def rrf_fuse(ranked_lists, weights, k=RRF_K) -> list:
    scores = {}
    for listed, weight in zip(ranked_lists, weights):
        if not listed:
            continue
        for identity, rank in listed:
            scores[identity] = scores.get(identity, 0.0) + weight / (k + rank)
    return sorted(scores, key=lambda identity: (-scores[identity], identity)), scores


def fuse_hits(keyword_ids, vector_ranked):
    """Fused ``(id, score)`` order, or None when the vector leg did not run."""
    if not vector_ranked:
        return None
    keyword_ranked = [(identity, rank) for rank, identity in enumerate(keyword_ids, start=1)]
    order, scores = rrf_fuse((keyword_ranked, vector_ranked), (1.0, VECTOR_WEIGHT))
    return [(identity, scores[identity]) for identity in order]
