"""Provider-reported usage lanes; no pricing or missing-usage estimates."""
from __future__ import annotations
from dataclasses import asdict, dataclass

TOKEN_KEYS = {"input_tokens": "inputTokens", "output_tokens": "outputTokens",
              "cache_read_tokens": "cacheReadTokens", "cache_write_tokens": "cacheWriteTokens",
              "reasoning_tokens": "reasoningTokens", "total_tokens": "totalTokens"}


@dataclass
class Usage:
    input_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    output_tokens: int = 0
    reasoning_tokens: int = 0
    total_tokens: int | None = 0
    known_total_tokens: int = 0
    reported_completions: int = 0
    unreported_completions: int = 0
    totals_unreported: int = 0

    def add(self, usage: dict | None) -> None:
        if usage is None:
            self.unreported_completions += 1
            self.total_tokens = None
            return
        for field_name, key in TOKEN_KEYS.items():
            value = usage.get(key, None if key == "totalTokens" else 0)
            if value is not None and (type(value) is not int or value < 0):
                raise ValueError(f"invalid nonnegative integer usage field: {key}")
            if value is None and key != "totalTokens":
                raise ValueError(f"invalid null usage field: {key}")
            if key == "totalTokens":
                if value is None:
                    self.totals_unreported += 1
                    self.total_tokens = None
                else:
                    self.known_total_tokens += value
                    if self.total_tokens is not None:
                        self.total_tokens += value
            else:
                setattr(self, field_name, getattr(self, field_name) + value)
        self.reported_completions += 1

    def summary(self) -> dict:
        result = asdict(self)
        # Pero's normalized input excludes cache reads. Cache writes and reasoning
        # are descriptive subfields, not additional token lanes.
        result["prompt_tokens"] = self.input_tokens + self.cache_read_tokens
        result["derived_total_tokens"] = result["prompt_tokens"] + self.output_tokens
        result["committed_response_usage_complete"] = self.unreported_completions == 0 and self.totals_unreported == 0
        result["usage_complete"] = result["committed_response_usage_complete"]
        result["cost_usd"] = None
        return result

