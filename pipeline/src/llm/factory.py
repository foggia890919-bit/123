"""환경에 따라 사용할 VLM 어댑터를 골라 반환."""

from __future__ import annotations

import os

from .base import VLMAdapter


def get_adapter(provider: str | None = None) -> VLMAdapter:
    chosen = (provider or os.environ.get("VLM_PROVIDER") or "gemini").lower()
    if chosen == "gemini":
        from .gemini import GeminiAdapter

        return GeminiAdapter()
    if chosen in ("claude", "anthropic"):
        from .anthropic_claude import ClaudeAdapter

        return ClaudeAdapter()
    raise ValueError(f"알 수 없는 VLM provider: {provider}")
