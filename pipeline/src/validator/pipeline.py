"""필드별 정규화 + 형식 검증 + 양식별 산술 검증을 묶어 신뢰도 점수까지 산출."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from ..templates import TemplateSpec
from .logical import LogicalCheckResult, run_checks
from .regex_rules import normalize_field


class FieldStatus(str, Enum):
    OK = "ok"
    MISSING = "missing"           # 필수인데 비어 있음
    FORMAT_INVALID = "format_invalid"
    NEEDS_REVIEW = "needs_review"  # 형식은 맞지만 신뢰가 낮음


@dataclass
class FieldReport:
    name: str
    type: str
    raw: Any
    normalized: Any
    status: FieldStatus
    note: str = ""


@dataclass
class ValidationReport:
    template_id: str
    fields: list[FieldReport]
    logical_checks: list[LogicalCheckResult]
    confidence: float
    needs_manual_review: bool
    notes: list[str] = field(default_factory=list)


def _check_format(value: Any, field_type: str, regex: str | None) -> bool:
    if value is None:
        return False
    if regex is None:
        return True
    return bool(re.match(regex, str(value)))


def validate(
    template: TemplateSpec,
    extracted: dict[str, Any],
    field_types: dict[str, dict[str, Any]],
) -> ValidationReport:
    field_reports: list[FieldReport] = []
    normalized_map: dict[str, Any] = {}

    for spec in template.fields:
        raw = extracted.get(spec.name)
        type_meta = field_types.get(spec.type, {})
        regex = type_meta.get("regex")

        if raw is None or raw == "":
            status = FieldStatus.MISSING if spec.required else FieldStatus.OK
            field_reports.append(
                FieldReport(
                    name=spec.name,
                    type=spec.type,
                    raw=raw,
                    normalized=None,
                    status=status,
                    note="" if status == FieldStatus.OK else "필수 필드 누락",
                )
            )
            continue

        normalized = normalize_field(spec.type, raw)
        if normalized is None and regex:
            field_reports.append(
                FieldReport(
                    name=spec.name,
                    type=spec.type,
                    raw=raw,
                    normalized=None,
                    status=FieldStatus.FORMAT_INVALID,
                    note=f"{spec.type} 형식 불일치",
                )
            )
            continue

        target_for_regex = normalized if normalized is not None else raw
        if not _check_format(target_for_regex, spec.type, regex):
            field_reports.append(
                FieldReport(
                    name=spec.name,
                    type=spec.type,
                    raw=raw,
                    normalized=normalized,
                    status=FieldStatus.FORMAT_INVALID,
                    note=f"{spec.type} 정규식 위반",
                )
            )
            continue

        normalized_map[spec.name] = normalized
        field_reports.append(
            FieldReport(
                name=spec.name,
                type=spec.type,
                raw=raw,
                normalized=normalized,
                status=FieldStatus.OK,
            )
        )

    logical = run_checks(normalized_map, template.logical_checks)
    confidence = _confidence_score(field_reports, logical)
    needs_review = (
        any(fr.status in (FieldStatus.MISSING, FieldStatus.FORMAT_INVALID) for fr in field_reports)
        or any(not lc.passed for lc in logical)
    )

    return ValidationReport(
        template_id=template.id,
        fields=field_reports,
        logical_checks=logical,
        confidence=confidence,
        needs_manual_review=needs_review,
    )


def _confidence_score(
    fields: list[FieldReport], logical: list[LogicalCheckResult]
) -> float:
    if not fields:
        return 0.0
    field_score = sum(1 for f in fields if f.status == FieldStatus.OK) / len(fields)
    if not logical:
        return round(field_score, 3)
    logic_score = sum(1 for c in logical if c.passed) / len(logical)
    return round(0.7 * field_score + 0.3 * logic_score, 3)
