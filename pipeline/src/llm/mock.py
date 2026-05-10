"""테스트용 결정론적 VLM 어댑터.

실제 API 호출 없이 미리 정해둔 응답을 큐에서 차례로 돌려준다. orchestrator의
self-correction 루프와 분류 폴백 로직을 검증하기 위함이다.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from .base import VLMAdapter, VLMResponse


@dataclass
class MockCall:
    instruction: str
    schema: dict[str, Any] | None


class MockVLMAdapter(VLMAdapter):
    def __init__(self, responses: list[dict[str, Any]]) -> None:
        self._queue: list[dict[str, Any]] = list(responses)
        self.calls: list[MockCall] = []

    def generate_json(
        self,
        image: np.ndarray,
        instruction: str,
        json_schema: dict[str, Any] | None = None,
    ) -> VLMResponse:
        self.calls.append(MockCall(instruction=instruction, schema=json_schema))
        if not self._queue:
            data: dict[str, Any] = {}
        else:
            data = self._queue.pop(0)
        return VLMResponse(data=data, raw_text=json.dumps(data, ensure_ascii=False), model="mock")

    @property
    def remaining(self) -> int:
        return len(self._queue)
