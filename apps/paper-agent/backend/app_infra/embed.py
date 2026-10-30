"""Optional in-process embedder for a local GGUF file.

Qwen3-Embedding-0.6B uses last-token pooling and a 1024-wide vector. When the
file or llama-cpp-python is missing, embedding returns None and callers keep
keyword ranking.
"""
import hashlib
import os
from pathlib import Path

from .rag import space_signature

GGUF_NAME = "qwen3-embedding-0.6b.gguf"
MIN_BYTES = 1_000_000
POOLING_LAST = 3
CONTEXT = 2048


class NullEmbedder:
    signature = None
    dim = 0

    def embed(self, _text):
        return None


class LlamaCppEmbedder:
    def __init__(self, path: Path):
        self.path = path
        self._llm = None
        self._failed = False
        self._dim = 0
        self._model_id = ""

    @property
    def dim(self) -> int:
        return self._dim

    @property
    def signature(self):
        if not self._model_id:
            digest = hashlib.sha256()
            with self.path.open("rb") as handle:
                for block in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(block)
            self._model_id = f"qwen3-embedding:0.6b:{digest.hexdigest()[:16]}"
        if not self._dim:
            return None
        return space_signature(self._model_id, self._dim)

    def embed(self, text: str):
        if self._failed or not text or not text.strip():
            return None
        llm = self._model()
        if llm is None:
            return None
        try:
            result = llm.create_embedding(text)
        except Exception:
            return None
        data = result.get("data") if isinstance(result, dict) else None
        if not data or not isinstance(data, list):
            return None
        vector = data[0].get("embedding") if isinstance(data[0], dict) else None
        if not isinstance(vector, list) or not vector or not all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in vector):
            return None
        self._dim = len(vector)
        return [float(value) for value in vector]

    def _model(self):
        if self._llm is not None or self._failed:
            return self._llm
        try:
            from llama_cpp import Llama
            self._llm = Llama(model_path=str(self.path), embedding=True, n_ctx=CONTEXT, n_batch=CONTEXT,
                              pooling_type=POOLING_LAST, verbose=False)
        except Exception:
            self._failed = True
            self._llm = None
        return self._llm


def model_path():
    if os.environ.get("PERO_APP_INFRA_EMBED") == "0":
        return None
    configured = os.environ.get("PERO_EMBED_MODEL", "").strip()
    home = Path(os.environ.get("PERO_HOME", str(Path.home() / ".pero"))).expanduser()
    candidates = []
    if configured:
        candidates.append(Path(configured).expanduser())
    candidates.extend((home / "models" / GGUF_NAME, Path.home() / ".kiro" / "crew" / "models" / GGUF_NAME))
    for path in candidates:
        try:
            if path.is_file() and path.stat().st_size >= MIN_BYTES:
                return path
        except OSError:
            continue
    return None


def open_embedder():
    path = model_path()
    return LlamaCppEmbedder(path) if path else NullEmbedder()
