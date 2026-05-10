"""Two-Pass 전략의 2차 — 분류된 양식의 필드만 뽑는다."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from pydantic import ValidationError

from ..llm import VLMAdapter
from ..templates import TemplateSpec
from .schemas import build_pydantic_model, template_to_json_schema


@dataclass
class ExtractResult:
    template_id: str
    fields: dict
    parse_ok: bool
    parse_errors: list[str]
    raw: dict


def _build_prompt(template: TemplateSpec) -> str:
    field_lines = "\n".join(
        f"  - {f.name} ({f.type}{', 필수' if f.required else ''})"
        for f in template.fields
    )
    return (
        f"너는 '{template.label}' 양식 전문 추출기다. 이미지에서 아래 필드만 정확히 "
        "뽑아라.\n\n"
        f"[추출 대상]\n{field_lines}\n\n"
        "[원칙]\n"
        "  1. 글자가 일부 깨지거나 가려져 있어도 문맥상 가장 타당한 값으로 추론하라.\n"
        "  2. 추측이 불가능한 값은 null로 두어라. 거짓 값을 만들지 말라.\n"
        "  3. 사업자번호/주민번호/날짜/전화번호는 양식에 적힌 그대로 옮기되, "
        "공백은 제거해도 된다.\n"
        "  4. 금액은 숫자와 콤마만 남기고 원화 기호는 제거하라.\n"
        "  5. line_items 필드는 행 단위 배열로 반환하되, 각 행을 객체로 만들어라."
    )


def extract(
    image: np.ndarray,
    template: TemplateSpec,
    adapter: VLMAdapter,
) -> ExtractResult:
    schema = template_to_json_schema(template)
    response = adapter.generate_json(image, _build_prompt(template), schema)
    data = response.data or {}

    parse_errors: list[str] = []
    parse_ok = True
    if data.get("_parse_error"):
        parse_errors.append("VLM 응답이 JSON 파싱 실패")
        parse_ok = False
        return ExtractResult(
            template_id=template.id,
            fields={},
            parse_ok=False,
            parse_errors=parse_errors,
            raw=data,
        )

    Model = build_pydantic_model(template)
    try:
        validated = Model.model_validate(data)
        fields = validated.model_dump()
    except ValidationError as e:
        # 필수 필드 누락이라도 추출 결과 자체는 그대로 보존해 validator가 후속 판단.
        parse_ok = False
        parse_errors.extend([str(err) for err in e.errors()])
        fields = data

    return ExtractResult(
        template_id=template.id,
        fields=fields,
        parse_ok=parse_ok,
        parse_errors=parse_errors,
        raw=data,
    )
