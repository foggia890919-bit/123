"""VLM 어댑터 인터페이스.

classifier / extractor 둘 다 generate_json(이미지+프롬프트→JSON) 한 가지만
필요하므로 인터페이스를 그 한 메서드 중심으로 좁게 잡는다.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

import numpy as np


@dataclass
class VLMResponse:
    data: dict[str, Any]
    raw_text: str
    model: str


class VLMAdapter(ABC):
    @abstractmethod
    def generate_json(
        self,
        image: np.ndarray,
        instruction: str,
        json_schema: dict[str, Any] | None = None,
    ) -> VLMResponse:
        """이미지 1장 + 지시문 → JSON. JSON 파싱은 어댑터가 책임진다."""
