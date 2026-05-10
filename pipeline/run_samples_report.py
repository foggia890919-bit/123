"""5개 샘플을 mock VLM으로 돌려 reports/summary.md를 만든다.

mock에는 ground_truth.json의 값을 미리 넣어 'VLM이 GT를 그대로 돌려줬다고
가정'한 베이스라인 시나리오를 시뮬레이션한다. 실제 VLM 호출이 가능해지면
adapter만 교체해서 동일한 리포트를 만들 수 있다.

이 스크립트의 목표는 두 가지:
  1. 결정론적 검증 단계(전처리/footer/산술/형식)가 5개 샘플에서 어떻게 작동하는지
     문서화 — 코드가 안 죽고 도는 것뿐 아니라 데이터 의미 있는 결과를 내는지.
  2. 실제 VLM 호출로 갈아끼울 때의 baseline (GT 시나리오) 결과 형태를 확정.
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2

from pipeline.src.llm.mock import MockVLMAdapter
from pipeline.src.orchestrator import run_pipeline
from pipeline.src.preprocessor import PreprocessOptions
from pipeline.src.report import generate_summary_md
from pipeline.src.report.summary import load_ground_truth
from pipeline.src.templates import load_registry


def _build_extraction_response(gt_entry: dict) -> dict:
    """GT 한 항목 → mock VLM이 돌려줄 추출 응답으로 변환."""
    summary = gt_entry.get("summary", {})
    drugs = gt_entry.get("drugs") or gt_entry.get("drugs_partial_high_confidence") or []
    response = {
        "period_start": summary.get("period_start"),
        "period_end": summary.get("period_end"),
        "hospital_name": summary.get("hospital_name"),
        "hospital_biz_no": summary.get("hospital_biz_no"),
        "prescriber_name": summary.get("prescriber_name"),
        "pharma_company": summary.get("pharma_company"),
        "drugs": drugs,
        "summary_total_amount": str(summary.get("summary_total_amount", "")) if summary.get("summary_total_amount") else None,
        # VLM이 자신감 점수도 같이 반환했다고 가정
        "_confidences": {
            "period_start": 1.0 if gt_entry["confidence"] == "high" else 0.7,
            "hospital_name": 1.0,
            "hospital_biz_no": 1.0,
            "pharma_company": 1.0,
            "drugs": 0.95 if gt_entry["confidence"] == "high" else 0.55,
        },
    }
    return response


def main() -> None:
    repo = Path(__file__).resolve().parent
    registry = load_registry(repo / "configs" / "templates.json")
    gt = load_ground_truth(repo / "samples" / "ground_truth.json")

    samples_dir = repo / "samples"
    sample_files = sorted(p for p in samples_dir.glob("*.jpg"))
    results = {}
    for sample_path in sample_files:
        gt_entry = gt.get(sample_path.name, {})
        extraction_response = _build_extraction_response(gt_entry) if gt_entry else {}
        # mock에 응답 큐를 만든다: 분류(1회) + 추출(1회) + 가능한 재시도(여유)
        responses = [
            {"template_id": "pharmacy_stats_kr"},
            extraction_response,
            extraction_response,
            extraction_response,
            extraction_response,
        ]
        adapter = MockVLMAdapter(responses=responses)

        img = cv2.imread(str(sample_path))
        result = run_pipeline(
            img,
            registry,
            adapter,
            preprocess_options=PreprocessOptions(debug_dir=repo / "debug" / sample_path.stem),
            max_retries=3,
            enable_roi_recrop=False,  # mock는 ROI도 GT 그대로 — 실제 ROI 검증은 real VLM에서
        )
        results[sample_path.name] = result

    output = repo / "reports" / "summary.md"
    generate_summary_md(results, output, ground_truth=gt)
    print(f"리포트 작성: {output}")


if __name__ == "__main__":
    main()
