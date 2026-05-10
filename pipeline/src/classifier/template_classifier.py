"""양식 분류 — Two-Pass 전략의 1차.

VLM에게 "후보 라벨 + 매칭 키워드" 카탈로그를 보여주고 가장 잘 맞는 id를
하나만 선택하게 한다. 분류가 애매하면 unknown을 돌려준다.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..llm import VLMAdapter
from ..templates import TemplateRegistry


@dataclass
class ClassifyResult:
    template_id: str
    label: str
    confidence: float  # 0.0 - 1.0
    raw: dict


_CLASSIFY_SCHEMA = {
    "type": "object",
    "properties": {
        "template_id": {"type": "string"},
        "confidence": {"type": "number"},
        "reason": {"type": "string"},
    },
    "required": ["template_id", "confidence"],
}


def _build_prompt(registry: TemplateRegistry) -> str:
    catalog_lines = []
    for t in registry.all():
        kws = ", ".join(t.match_keywords)
        catalog_lines.append(f"- id={t.id} | 라벨={t.label} | 키워드=[{kws}]")
    catalog = "\n".join(catalog_lines)
    return (
        "너는 한국 문서 양식 분류기다. 첨부된 이미지가 아래 후보 중 어떤 양식에 "
        "해당하는지 정확히 한 개의 id로 답해라. 어디에도 명확히 속하지 않으면 "
        '"unknown"을 반환하라.\n\n'
        "[후보 양식 카탈로그]\n"
        f"{catalog}\n\n"
        "출력 JSON 키:\n"
        "  template_id: 위 id 중 하나 또는 'unknown'\n"
        "  confidence: 0.0 ~ 1.0 (얼마나 확신하는가)\n"
        "  reason: 짧은 한국어 근거 한 줄"
    )


def classify(
    image: np.ndarray,
    registry: TemplateRegistry,
    adapter: VLMAdapter,
) -> ClassifyResult:
    response = adapter.generate_json(image, _build_prompt(registry), _CLASSIFY_SCHEMA)
    data = response.data or {}
    template_id = str(data.get("template_id", "unknown"))
    confidence = float(data.get("confidence", 0.0))
    if template_id != "unknown" and template_id not in registry.templates:
        # 모델이 카탈로그에 없는 id를 만들어낸 경우
        template_id = "unknown"
        confidence = 0.0
    label = registry.get(template_id).label if template_id in registry.templates else "미분류"
    return ClassifyResult(
        template_id=template_id, label=label, confidence=confidence, raw=data
    )
