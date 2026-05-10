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
        templates[t["id"]] = TemplateSpec(
            id=t["id"],
            label=t["label"],
            match_keywords=t.get("match_keywords", []),
            fields=[
                FieldSpec(name=f["name"], type=f["type"], required=f.get("required", False))
                for f in t["fields"]
            ],
            logical_checks=t.get("logical_checks", []),
        )
    return TemplateRegistry(templates=templates, field_types=raw.get("field_types", {}))
