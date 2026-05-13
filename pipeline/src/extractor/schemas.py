"""양식 메타데이터 → Pydantic 모델 동적 생성.

각 양식마다 추출 대상이 다르므로 클래스를 코드에 박지 않고 templates.json을
읽어 만들어 낸다. 이렇게 하면 새 양식 추가가 JSON 한 줄로 끝난다.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, create_model

from ..templates import FieldSpec, TemplateSpec


class ExtractedDocument(BaseModel):
    template_id: str
    fields: dict[str, Any]
    raw_response: dict[str, Any] = Field(default_factory=dict)


_TYPE_MAP: dict[str, type] = {
    "string": str,
    "biz_no": str,
    "rrn": str,
    "phone": str,
    "date": str,
    "amount": str,  # 정규화 전에는 문자열로 받는다 (콤마/원/₩ 포함 가능)
    "account_no": str,
    "line_items": list,
}


def build_pydantic_model(template: TemplateSpec) -> type[BaseModel]:
    """양식별 강제 스키마. required=True인 필드만 ...로 강제, 나머지는 None."""
    fields: dict[str, tuple[type, Any]] = {}
    for f in template.fields:
        py_type = _TYPE_MAP.get(f.type, str)
        if f.required:
            fields[f.name] = (py_type, ...)
        else:
            fields[f.name] = (py_type | None, None)  # type: ignore[operator]
    name = f"Doc_{template.id}"
    return create_model(name, **fields)  # type: ignore[arg-type]


_ROW_TYPE_MAP: dict[str, dict[str, Any]] = {
    "string": {"type": "string"},
    "int": {"type": "integer"},
    "number": {"type": "number"},
    "amount": {"type": "string"},  # amount 도 콤마/원기호 들어올 수 있어 string 으로 받음
}


def _row_schema_for(field_name: str, template: TemplateSpec) -> dict[str, Any]:
    """line_items 필드의 행 객체 스키마. 템플릿이 row 키 목록을 명시했으면 강제."""
    row_spec = (template.line_item_schemas or {}).get(field_name)
    if not row_spec:
        return {"type": "object"}
    properties = {
        k: _ROW_TYPE_MAP.get(v, {"type": "string"}) for k, v in row_spec.items()
    }
    return {
        "type": "object",
        "properties": properties,
        "required": list(row_spec.keys()),
    }


def field_to_json_schema(spec: FieldSpec, template: TemplateSpec) -> dict[str, Any]:
    if spec.type == "line_items":
        return {"type": "array", "items": _row_schema_for(spec.name, template)}
    return {"type": "string"}


def template_to_json_schema(template: TemplateSpec) -> dict[str, Any]:
    """VLM에게 줄 응답 스키마. 모델이 키 누락하지 않도록 모든 필드를 required로 둔다.
    null 허용 — 누락 시 모델은 null을 명시적으로 채워야 한다.
    """
    properties = {f.name: field_to_json_schema(f, template) for f in template.fields}
    return {
        "type": "object",
        "properties": properties,
        "required": [f.name for f in template.fields],
    }
