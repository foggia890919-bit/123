"""samples/*.jpg 를 일괄 실행해 reports/summary.md 를 만든다.

두 가지 모드:
  --provider mock     : ground_truth 를 그대로 돌려주는 가짜 VLM. 검증/리포트
                        포맷을 죽여보지 않고 점검할 때.
  --provider claude   : 실제 Anthropic Claude Vision 호출 (ANTHROPIC_API_KEY 필요)
  --provider gemini   : Google Gemini 호출 (GOOGLE_API_KEY 필요)

리포트 포맷은 동일하므로 mock 결과와 real 결과를 같은 형식으로 비교할 수 있다.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# pipeline/.env 자동 로딩
try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass

import cv2

from pipeline.src.llm import get_adapter
from pipeline.src.llm.mock import MockVLMAdapter
from pipeline.src.orchestrator import run_pipeline
from pipeline.src.preprocessor import PreprocessOptions
from pipeline.src.report import generate_summary_md
from pipeline.src.report.summary import load_ground_truth
from pipeline.src.templates import load_registry


def _build_mock_response(gt_entry: dict) -> dict:
    """GT 한 항목 → mock VLM 이 돌려줄 추출 응답."""
    summary = gt_entry.get("summary", {})
    drugs = gt_entry.get("drugs") or gt_entry.get("drugs_partial_high_confidence") or []
    return {
        "period_start": summary.get("period_start"),
        "period_end": summary.get("period_end"),
        "hospital_name": summary.get("hospital_name"),
        "hospital_biz_no": summary.get("hospital_biz_no"),
        "prescriber_name": summary.get("prescriber_name"),
        "pharma_company": summary.get("pharma_company"),
        "drugs": drugs,
        "summary_total_amount": (
            str(summary.get("summary_total_amount", ""))
            if summary.get("summary_total_amount") else None
        ),
        "_confidences": {
            "period_start": 1.0 if gt_entry.get("confidence") == "high" else 0.7,
            "hospital_name": 1.0,
            "hospital_biz_no": 1.0,
            "pharma_company": 1.0,
            "drugs": 0.95 if gt_entry.get("confidence") == "high" else 0.55,
        },
    }


def _make_adapter(provider: str, gt_entry: dict | None):
    if provider == "mock":
        responses = [
            {"template_id": "pharmacy_stats_kr"},
            _build_mock_response(gt_entry or {}),
            _build_mock_response(gt_entry or {}),
            _build_mock_response(gt_entry or {}),
            _build_mock_response(gt_entry or {}),
        ]
        return MockVLMAdapter(responses=responses)
    # 실제 VLM — provider 문자열 그대로 factory 에 넘김
    return get_adapter(provider)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="샘플 일괄 실행 → reports/summary.md")
    parser.add_argument(
        "--provider", default="mock",
        help="mock | claude | gemini (기본 mock — 키 없어도 동작)",
    )
    parser.add_argument(
        "--max-retries", type=int, default=3,
        help="self-correction 재추출 한도",
    )
    parser.add_argument(
        "--no-roi-recrop", action="store_true",
        help="Stage 5 ROI 재추출 비활성 (mock 일 땐 기본 비활성)",
    )
    parser.add_argument(
        "--out", type=Path, default=None,
        help="리포트 출력 경로 (기본 reports/summary.md / reports/summary_<provider>.md)",
    )
    args = parser.parse_args(argv)

    repo = Path(__file__).resolve().parent
    registry = load_registry(repo / "configs" / "templates.json")
    gt = load_ground_truth(repo / "samples" / "ground_truth.json")

    samples_dir = repo / "samples"
    sample_files = sorted(p for p in samples_dir.glob("*.jpg"))
    if not sample_files:
        print(f"[!] 샘플이 없습니다: {samples_dir}", file=sys.stderr)
        return 2

    # mock 일 땐 ROI 재추출은 의미가 없으므로 기본 비활성
    enable_roi = not args.no_roi_recrop and args.provider != "mock"

    results = {}
    for sample_path in sample_files:
        gt_entry = gt.get(sample_path.name, {})
        adapter = _make_adapter(args.provider, gt_entry)
        img = cv2.imread(str(sample_path))
        if img is None:
            print(f"[!] 이미지 로드 실패: {sample_path}", file=sys.stderr)
            continue
        print(f"[run] {sample_path.name} (provider={args.provider})", file=sys.stderr)
        result = run_pipeline(
            img,
            registry,
            adapter,
            preprocess_options=PreprocessOptions(
                debug_dir=repo / "debug" / sample_path.stem
            ),
            max_retries=args.max_retries,
            enable_roi_recrop=enable_roi,
        )
        results[sample_path.name] = result

    out_path = args.out or (
        repo / "reports" / (
            "summary.md" if args.provider == "mock"
            else f"summary_{args.provider}.md"
        )
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    generate_summary_md(results, out_path, ground_truth=gt)
    print(f"리포트 작성: {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
