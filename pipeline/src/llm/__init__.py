from .base import VLMAdapter, VLMResponse
from .factory import get_adapter
from .mock import MockVLMAdapter

__all__ = ["VLMAdapter", "VLMResponse", "get_adapter", "MockVLMAdapter"]


def __getattr__(name: str):
    # OpenRouterAdapter / ClaudeAdapter / GeminiAdapter 등은 lazy import.
    if name == "OpenRouterAdapter":
        from .openrouter import OpenRouterAdapter

        return OpenRouterAdapter
    if name == "ClaudeAdapter":
        from .anthropic_claude import ClaudeAdapter

        return ClaudeAdapter
    if name == "GeminiAdapter":
        from .gemini import GeminiAdapter

        return GeminiAdapter
    raise AttributeError(name)
