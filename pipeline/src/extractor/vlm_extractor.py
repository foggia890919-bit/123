"""Two-Pass 전략의 2차 — 분류된 양식의 필드만 뽑는다.

설계 원칙: **앵커 기반 추출**. 좌표를 못박지 않는다.
양식이 병원·기관마다 조금씩 달라도, 같은 의미의 라벨(앵커 키워드) 옆/아래에
값이 있다는 보편 규칙은 변하지 않는다. 좌표가 아니라 라벨을 기준으로 찾도록
프롬프트로 강제한다. retry 시에는 앞 시도의 실패 사유를 피드백해 재추출.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
from pydantic import ValidationError

from ..llm import VLMAdapter
from ..templates import TemplateSpec
from .schemas import build_pydantic_model, template_to_json_schema


@dataclass
class RetryContext:
    prior_fields: dict[str, Any]
    issues: list[str]  # 자연어로 풀어쓴 실패 사유 목록


@dataclass
class ExtractResult:
    template_id: str
    fields: dict
    parse_ok: bool
    parse_errors: list[str]
    raw: dict
    attempt: int = 1
    confidences: dict[str, float] = field(default_factory=dict)
    """필드별 VLM 자신감 점수 (0~1). VLM이 _confidences 키로 반환한 값. 없으면 빈 딕트."""


_ANCHOR_RULES = (
    "[앵커 기반 추출 규칙 — 절대 어기지 말 것]\n"
    "  A. 좌표를 보지 말고 **인접 라벨(앵커 키워드)**을 보고 값을 찾는다.\n"
    "     예) '공급가액' 라벨의 오른쪽/아래 숫자 → supply_amount.\n"
    "         '대표자' 라벨의 오른쪽 한국어 이름 → ceo_name.\n"
    "  B. 같은 의미의 라벨은 표현이 달라질 수 있다. 동의어를 함께 받아들여라.\n"
    "     예) '합계금액' = '총액' = '총합계' = 'TOTAL' = '결제금액'.\n"
    "         '공급자' = '사업자' = '발행자'.\n"
    "         '받는자' = '공급받는자' = '구매자' = 'BUYER'.\n"
    "  C. 양식이 가로/세로 두 형태로 나올 수 있다. 라벨이 위에 있고 값이 아래일\n"
    "     수도 있고, 라벨이 왼쪽이고 값이 오른쪽일 수도 있다. 둘 다 허용.\n"
    "  D. 표 안의 값은 같은 행에서 라벨 셀과 값 셀이 짝을 이룬다. 행 경계를 넘지\n"
    "     말라.\n"
)

_BASE_RULES = (
    "[추출 원칙]\n"
    "  1. 글자가 일부 깨지거나 가려져 있어도 문맥상 가장 타당한 값으로 추론하라.\n"
    "  2. 추측이 불가능한 값은 null로 두어라. 거짓 값을 만들지 말라.\n"
    "  3. 사업자번호/주민번호/날짜/전화번호는 양식에 적힌 그대로 옮기되, 공백은\n"
    "     제거해도 된다.\n"
    "  4. 금액은 숫자와 콤마만 남기고 원화 기호는 제거하라.\n"
    "  5. line_items 필드는 행 단위 배열로 반환하되, 각 행을 객체로 만들어라.\n"
)

_CONFIDENCE_RULES = (
    "[자신감 점수]\n"
    "  추출한 각 필드에 대해 0~1 사이의 자신감 점수를 별도 키 '_confidences'에\n"
    "  같이 반환하라. 1.0 = 글자가 또렷이 보이고 100% 확신, 0.5 = 추론·보정 들어감,\n"
    "  0.0 = 거의 못 읽음. line_items의 경우 행 자체에 대해 한 점수를 매겨\n"
    "  '_confidences': {'drugs[0]': 0.9, 'drugs[1]': 0.4, ...} 식으로 표기.\n"
    "  점수가 0.6 미만인 필드는 후속 검증 단계에서 자동 재추출 대상이 되니\n"
    "  보수적으로 평가하라.\n"
)


def _build_prompt(template: TemplateSpec, retry: RetryContext | None = None) -> str:
    field_lines = "\n".join(
        f"  - {f.name} ({f.type}{', 필수' if f.required else ''})"
        for f in template.fields
    )
    head = (
        f"너는 '{template.label}' 양식 전문 추출기다. 이미지에서 아래 필드만 정확히\n"
        "뽑아라.\n\n"
        f"[추출 대상]\n{field_lines}\n\n"
        f"{_ANCHOR_RULES}\n"
        f"{_BASE_RULES}\n"
        f"{_CONFIDENCE_RULES}"
    )
    if retry is None:
        return head

    issues = "\n".join(f"  - {msg}" for msg in retry.issues) or "  - (사유 미기재)"
    prior = (
        "{\n"
        + "\n".join(f"  {k!r}: {v!r}," for k, v in (retry.prior_fields or {}).items())
        + "\n}"
    )
    return (
        head
        + "\n\n[이전 추출 결과 — 검증 실패]\n"
        + prior
        + "\n\n[검증 실패 사유 — 이번에는 반드시 해결하라]\n"
        + issues
        + "\n\n위 실패 필드에 특히 집중해 다시 한번 이미지에서 앵커 키워드를 찾아"
        " 값을 재추출하라. 다른 필드도 함께 다시 채워서 완전한 JSON을 반환하라."
    )


def extract(
    image: np.ndarray,
    template: TemplateSpec,
    adapter: VLMAdapter,
    *,
    retry: RetryContext | None = None,
    attempt: int = 1,
) -> ExtractResult:
    schema = template_to_json_schema(template)
    response = adapter.generate_json(image, _build_prompt(template, retry), schema)
    data = response.data or {}

    parse_errors: list[str] = []
    parse_ok = True
    if data.get("_parse_error"):
        parse_errors.append("VLM 응답이 JSON 파싱 실패")
        return ExtractResult(
            template_id=template.id,
            fields={},
            parse_ok=False,
            parse_errors=parse_errors,
            raw=data,
            attempt=attempt,
        )

    confidences_raw = data.pop("_confidences", {}) if isinstance(data, dict) else {}
    confidences: dict[str, float] = {}
    if isinstance(confidences_raw, dict):
        for k, v in confidences_raw.items():
            try:
                confidences[str(k)] = max(0.0, min(1.0, float(v)))
            except (TypeError, ValueError):
                continue

    Model = build_pydantic_model(template)
    try:
        validated = Model.model_validate(data)
        fields = validated.model_dump()
    except ValidationError as e:
        parse_ok = False
        parse_errors.extend([str(err) for err in e.errors()])
        fields = data

    return ExtractResult(
        template_id=template.id,
        fields=fields,
        parse_ok=parse_ok,
        parse_errors=parse_errors,
        raw=data,
        attempt=attempt,
        confidences=confidences,
    )
