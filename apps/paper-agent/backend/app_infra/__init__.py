"""Shared app infrastructure. Paper Agent depends on this package; it does not import Paper Agent."""

from .embed import NullEmbedder, open_embedder
from .rag import fuse_hits, passage_input, query_input, space_signature, vector_ranks

__all__ = [
    "NullEmbedder",
    "fuse_hits",
    "open_embedder",
    "passage_input",
    "query_input",
    "space_signature",
    "vector_ranks",
]
