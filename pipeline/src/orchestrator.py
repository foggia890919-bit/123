"""5단계 파이프라인 오케스트레이터.

  Stage 1  preprocess     OpenCV + (옵션) AI-Assisted Cropping
  Stage 2  classify       VLM 1-pass 분류 → unknown 시 generic_document 폴백
  Stage 3  extract        VLM 2-pass 추출 (앵커 기반 + 필드별 confidence)
  Stage 4  self-correct   validate 결과를 피드백으로 재추출 (max_retries=1, 분당
                            요청 한도 보호용으로 호출량을 베이스라인 가까이로 회귀)
  Stage 5  ROI re-crop    행 단위 산술이 실패한 행만 잘라 VLM 재호출

99% 신뢰도 추구: 결정적 검증(산술/형식) → 자가수정 → 잘라서 재추출의 3겹.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from .classifier import ClassifyResult, classify
from .extractor import ExtractResult, RetryContext, extract
from .llm import VLMAdapter
from .preprocessor import PreprocessOptions, PreprocessResult, preprocess
from .templates import TemplateRegistry, TemplateSpec
from .validator import FieldStatus, ValidationReport, validate

GENERIC_TEMPLATE_ID = "generic_document"


@dataclass
class PipelineResult:
    preprocess: PreprocessResult
    classify: ClassifyResult | None
    extract: ExtractResult
    validate: ValidationReport
    template_id: str
    attempts: int
    retried: bool
    fell_back_to_generic: bool
    roi_recrop_attempts: int = 0
    roi_recrop_notes: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def _resolve_template(
    image: np.ndarray,
    registry: TemplateRegistry,
    adapter: VLMAdapter,
    forced_template_id: str | None,
) -> tuple[TemplateSpec, ClassifyResult | None, bool]:
    if forced_template_id:
        return registry.get(forced_template_id), None, False
    cls = classify(image, registry, adapter)
    if cls.template_id == "unknown" or cls.template_id not in registry.templates:
        if GENERIC_TEMPLATE_ID in registry.templates:
            return registry.get(GENERIC_TEMPLATE_ID), cls, True
        # generic도 없으면 unknown 그대로 — 호출자가 처리
        raise ValueError("분류 실패 + generic_document 템플릿이 등록되지 않았습니다")
    return registry.get(cls.template_id), cls, False


def _issues_from_report(report: ValidationReport) -> list[str]:
    """ValidationReport를 자연어 피드백 목록으로 변환 (재추출 프롬프트용)."""
    msgs: list[str] = []
    for fr in report.fields:
        if fr.status == FieldStatus.MISSING:
            msgs.append(f"{fr.name}: 필수 필드인데 비어있음. 라벨을 다시 찾아라.")
        elif fr.status == FieldStatus.FORMAT_INVALID:
            msgs.append(
                f"{fr.name}: '{fr.raw}' 는 {fr.type} 형식이 아니다. "
                "다른 곳을 잘못 본 게 아닌지 라벨 위치를 재확인하라."
            )
        elif fr.status == FieldStatus.NEEDS_REVIEW:
            msgs.append(f"{fr.name}: 신뢰도 낮음. 인접 라벨 기준으로 재확인.")
    for lc in report.logical_checks:
        if not lc.passed:
            msgs.append(f"산술 검증 실패: {lc.rule} ({lc.detail}). 숫자 자릿수를 다시 보라.")
    return msgs


def _failed_row_indices(report: ValidationReport) -> list[int]:
    """row_arith[N] 형태의 실패 룰에서 N 추출."""
    indices: list[int] = []
    for lc in report.logical_checks:
        if lc.passed:
            continue
        m = _ROW_IDX_RE.search(lc.rule)
        if m:
            indices.append(int(m.group(1)))
    return sorted(set(indices))


import re as _re
_ROW_IDX_RE = _re.compile(r"row_arith\[(\d+)\]")


def run_pipeline(
    image: np.ndarray,
    registry: TemplateRegistry,
    adapter: VLMAdapter,
    *,
    forced_template_id: str | None = None,
    preprocess_options: PreprocessOptions | None = None,
    max_retries: int = 1,
    enable_roi_recrop: bool = True,
) -> PipelineResult:
    notes: list[str] = []

    # Stage 1
    pre = preprocess(image, preprocess_options)
    notes.extend(pre.notes)

    # Stage 2
    template, cls, fell_back = _resolve_template(
        pre.image, registry, adapter, forced_template_id
    )
    if fell_back:
        notes.append(
            f"classify: 분류 실패 → generic_document 폴백 (raw={cls.raw if cls else None})"
        )

    # Stage 3
    extraction = extract(pre.image, template, adapter, attempt=1)
    report = validate(template, extraction.fields, registry.field_types)
    attempts = 1
    retried = False

    # Stage 4 — self-correction (max_retries회까지 전체 재추출)
    while report.needs_manual_review and attempts <= max_retries:
        retry_ctx = RetryContext(
            prior_fields=extraction.fields,
            issues=_issues_from_report(report),
        )
        attempts += 1
        retried = True
        notes.append(f"self-correct: 시도 {attempts}회차 — {len(retry_ctx.issues)}건 사유")
        extraction = extract(
            pre.image, template, adapter, retry=retry_ctx, attempt=attempts
        )
        report = validate(template, extraction.fields, registry.field_types)

    # Stage 5 — ROI re-crop: 산술이 여전히 깨진 행만 잘라 재추출
    roi_attempts = 0
    roi_notes: list[str] = []
    if enable_roi_recrop and report.needs_manual_review:
        from .extractor.roi_recrop import re_extract_failed_rows
        failed_idx = _failed_row_indices(report)
        drugs = extraction.fields.get("drugs") if isinstance(extraction.fields, dict) else None
        if failed_idx and isinstance(drugs, list):
            new_drugs, roi_reports = re_extract_failed_rows(
                pre.image, drugs, failed_idx, adapter
            )
            roi_attempts = len(roi_reports)
            for rep in roi_reports:
                roi_notes.append(f"ROI[{rep.row_index}]: {rep.note}")
            extraction.fields["drugs"] = new_drugs
            report = validate(template, extraction.fields, registry.field_types)

    return PipelineResult(
        preprocess=pre,
        classify=cls,
        extract=extraction,
        validate=report,
        template_id=template.id,
        attempts=attempts,
        retried=retried,
        fell_back_to_generic=fell_back,
        roi_recrop_attempts=roi_attempts,
        roi_recrop_notes=roi_notes,
        notes=notes,
    )


__all__ = ["run_pipeline", "PipelineResult", "GENERIC_TEMPLATE_ID"]
