"""configs/templates.json 로딩 + 조회 헬퍼."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class FieldSpec:
    name: str
    type: str
    required: bool = False


@dataclass
class TemplateSpec:
    id: str
    label: str
    match_keywords: list[str]
    fields: list[FieldSpec]
    logical_checks: list[dict[str, Any]]
    line_item_schemas: dict[str, dict[str, str]] = None  # type: ignore[assignment]
    """필드명(line_items 타입) → {row_key: row_type} 매핑. JSON 스키마로 VLM에 강제."""


@dataclass
class TemplateRegistry:
    templates: dict[str, TemplateSpec]
    field_types: dict[str, dict[str, Any]]

    def get(self, template_id: str) -> TemplateSpec:
        if template_id not in self.templates:
            raise KeyError(f"알 수 없는 template_id: {template_id}")
        return self.templates[template_id]

    def all(self) -> list[TemplateSpec]:
        return list(self.templates.values())


def load_registry(path: Path | str) -> TemplateRegistry:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    templates: dict[str, TemplateSpec] = {}
    for t in raw["templates"]:
        # 현재 스키마는 'drugs' 같은 line_items 타입 필드가 한 양식에 보통 하나
        # 뿐이므로, JSON 의 line_item_schema 한 덩어리를 그 필드명에 묶어준다.
        # 한 양식에 line_items 가 여러 개라면 확장 필요.
        per_field_row_schemas: dict[str, dict[str, str]] = {}
        row_schema = t.get("line_item_schema")
        if row_schema:
            li_fields = [f["name"] for f in t["fields"] if f.get("type") == "line_items"]
            for fname in li_fields:
                per_field_row_schemas[fname] = row_schema
        templates[t["id"]] = TemplateSpec(
            id=t["id"],
            label=t["label"],
            match_keywords=t.get("match_keywords", []),
            fields=[
                FieldSpec(name=f["name"], type=f["type"], required=f.get("required", False))
                for f in t["fields"]
            ],
            logical_checks=t.get("logical_checks", []),
            line_item_schemas=per_field_row_schemas,
        )
    return TemplateRegistry(templates=templates, field_types=raw.get("field_types", {}))
