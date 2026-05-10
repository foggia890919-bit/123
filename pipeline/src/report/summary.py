"""5개 샘플 처리 결과를 한눈에 보는 summary.md 생성.

각 샘플별로 적힌다:
  - 전처리 단계 (회전/스크린샷/perspective 결과)
  - 추출 결과 (필드별 값/상태/자신감)
  - 산술/형식 검증 결과 — 어떤 필드가 왜 실패했는지
  - ground_truth.json과의 diff (있는 경우)

VLM이 실제 호출되지 않았더라도 (mock 사용) 어디까지 결정론적으로 검증되는지
확실히 보여주는 문서. 99% 신뢰도 추적의 통합 대시보드.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..orchestrator import PipelineResult
from ..validator import FieldStatus


@dataclass
class GroundTruthDiff:
    sample: str
    summary_diffs: list[tuple[str, Any, Any]]   # (field, expected, actual)
    drug_count_expected: int | None
    drug_count_actual: int
    arithmetic_check: dict[str, bool]            # 행별 산술 통과 여부


def diff_against_ground_truth(
    sample_name: str, result: PipelineResult, gt_data: dict[str, Any]
) -> GroundTruthDiff | None:
    """ground_truth.json의 한 샘플 항목 vs 파이프라인 결과를 비교."""
    gt_entry = gt_data.get(sample_name)
    if not gt_entry:
        return None

    gt_summary = gt_entry.get("summary", {})
    actual = result.extract.fields or {}

    summary_fields = (
        "period_start", "period_end", "hospital_name", "hospital_biz_no",
        "prescriber_name", "pharma_company", "summary_total_amount",
    )
    diffs: list[tuple[str, Any, Any]] = []
    for fname in summary_fields:
        expected = gt_summary.get(fname)
        actual_v = actual.get(fname)
        if expected is None and actual_v in (None, ""):
            continue
        if str(expected or "").strip() != str(actual_v or "").strip():
            diffs.append((fname, expected, actual_v))

    drugs_actual = actual.get("drugs") or []
    drug_count_actual = len(drugs_actual) if isinstance(drugs_actual, list) else 0
    drug_count_expected = gt_summary.get("drug_count_total")

    arithmetic: dict[str, bool] = {}
    if isinstance(drugs_actual, list):
        for i, row in enumerate(drugs_actual):
            if not isinstance(row, dict):
                continue
            up, qty, ta = row.get("unit_price"), row.get("total_qty"), row.get("total_amount")
            try:
                if up is not None and qty is not None and ta is not None:
                    arithmetic[f"drug[{i}]"] = int(up) * int(qty) == int(ta)
            except (TypeError, ValueError):
                arithmetic[f"drug[{i}]"] = False

    return GroundTruthDiff(
        sample=sample_name,
        summary_diffs=diffs,
        drug_count_expected=drug_count_expected,
        drug_count_actual=drug_count_actual,
        arithmetic_check=arithmetic,
    )


def _fmt_field_row(name: str, fr, conf: float | None) -> str:
    status = fr.status.value if hasattr(fr.status, "value") else str(fr.status)
    icon = {"ok": "OK", "missing": "MISS", "format_invalid": "FAIL", "needs_review": "REV"}.get(status, status)
    val = fr.normalized if fr.normalized is not None else fr.raw
    val_str = str(val) if val is not None else "—"
    if len(val_str) > 60:
        val_str = val_str[:57] + "..."
    conf_str = f"{conf:.2f}" if conf is not None else "—"
    return f"| {name} | {icon} | `{val_str}` | {conf_str} | {fr.note or ''} |"


def generate_summary_md(
    results: dict[str, PipelineResult],
    output_path: Path,
    *,
    ground_truth: dict[str, Any] | None = None,
) -> None:
    """샘플 이름→PipelineResult 맵을 받아 summary.md 한 파일로 떨군다."""
    lines: list[str] = []
    lines.append("# Document Intelligence Pipeline — 샘플 처리 리포트")
    lines.append("")
    lines.append("각 샘플별 전처리/추출/검증/ground-truth 대조 결과 통합 대시보드.")
    lines.append("")

    # 헤더 요약 테이블
    lines.append("## 요약")
    lines.append("")
    lines.append("| 샘플 | 회전 | Source | Perspective | Template | 시도 | 신뢰도 | 검수필요 |")
    lines.append("|---|---|---|---|---|---|---|---|")
    for name, r in results.items():
        src = "screenshot" if (r.preprocess.source_kind and r.preprocess.source_kind.is_screenshot) else "photo"
        review = "예" if r.validate.needs_manual_review else "아니오"
        lines.append(
            f"| {name} | {r.preprocess.rotation_applied}° | {src} | "
            f"{r.preprocess.perspective_method} | {r.template_id} | {r.attempts} | "
            f"{r.validate.confidence:.2f} | {review} |"
        )
    lines.append("")

    # 샘플별 상세
    for name, r in results.items():
        lines.append("---")
        lines.append("")
        lines.append(f"## {name}")
        lines.append("")
        lines.append(f"**전처리 노트**:")
        for n in r.preprocess.notes or ["(없음)"]:
            lines.append(f"  - {n}")
        lines.append("")

        # 필드별 표
        lines.append("### 필드별 추출/검증")
        lines.append("")
        lines.append("| 필드 | 상태 | 값 | conf | 비고 |")
        lines.append("|---|---|---|---|---|")
        confs = r.extract.confidences or {}
        for fr in r.validate.fields:
            lines.append(_fmt_field_row(fr.name, fr, confs.get(fr.name)))
        lines.append("")

        # 산술 검증
        if r.validate.logical_checks:
            lines.append("### 논리/산술 검증")
            lines.append("")
            for lc in r.validate.logical_checks:
                icon = "PASS" if lc.passed else "FAIL"
                lines.append(f"- [{icon}] `{lc.rule}` — {lc.detail}")
            lines.append("")

        # ground truth diff
        if ground_truth:
            diff = diff_against_ground_truth(name, r, ground_truth)
            if diff:
                lines.append("### Ground-truth 대조")
                lines.append("")
                if diff.summary_diffs:
                    lines.append("**Summary 필드 차이**:")
                    lines.append("")
                    lines.append("| 필드 | 기대값 | 추출값 |")
                    lines.append("|---|---|---|")
                    for fname, exp, act in diff.summary_diffs:
                        lines.append(f"| {fname} | `{exp}` | `{act}` |")
                else:
                    lines.append("- Summary 필드: 모두 일치 ✓")
                lines.append("")
                lines.append(
                    f"- 약품 행 수: 기대 `{diff.drug_count_expected}`, "
                    f"추출 `{diff.drug_count_actual}`"
                )
                if diff.arithmetic_check:
                    fail_rows = [k for k, v in diff.arithmetic_check.items() if not v]
                    if fail_rows:
                        lines.append(f"- 산술 실패 행: {', '.join(fail_rows)}")
                    else:
                        lines.append("- 모든 행 산술 통과 ✓")
                lines.append("")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines), encoding="utf-8")


def load_ground_truth(path: Path | str) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))
