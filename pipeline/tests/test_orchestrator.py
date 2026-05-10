"""오케스트레이터의 4단계 흐름과 self-correction을 검증한다.

VLM 호출은 MockVLMAdapter로 결정론적으로 대체. preprocess는 합성 이미지를 통과시킨다.
"""

from pathlib import Path

import numpy as np
import pytest

cv2 = pytest.importorskip("cv2")

from pipeline.src.llm import MockVLMAdapter
from pipeline.src.orchestrator import run_pipeline
from pipeline.src.preprocessor import PreprocessOptions
from pipeline.src.templates import load_registry

CONFIG = Path(__file__).parent.parent / "configs/templates.json"


def _blank_doc() -> np.ndarray:
    img = np.full((400, 600, 3), 240, dtype=np.uint8)
    cv2.rectangle(img, (40, 40), (560, 360), (20, 20, 20), 2)
    return img


def _opts() -> PreprocessOptions:
    return PreprocessOptions(correct_perspective=False)


def _good_invoice_response() -> dict:
    return {
        "supplier_biz_no": "123-45-67890",
        "supplier_name": "ACME",
        "supplier_ceo": "홍길동",
        "buyer_biz_no": "987-65-43210",
        "buyer_name": "BUYER",
        "issue_date": "2025-05-09",
        "supply_amount": "100,000",
        "tax_amount": "10,000",
        "total_amount": "110,000",
    }


def test_happy_path_no_retry():
    """첫 추출이 검증을 통과하면 재시도 없이 종료해야 한다."""
    registry = load_registry(CONFIG)
    adapter = MockVLMAdapter(
        [
            {"template_id": "tax_invoice_kr", "confidence": 0.95},  # 분류
            _good_invoice_response(),                                # 추출
        ]
    )
    result = run_pipeline(
        _blank_doc(), registry, adapter,
        preprocess_options=_opts(), max_retries=2,
    )
    assert result.template_id == "tax_invoice_kr"
    assert result.attempts == 1
    assert result.retried is False
    assert result.fell_back_to_generic is False
    assert result.validate.needs_manual_review is False
    # VLM은 정확히 2번만 호출되어야 한다 (분류 1 + 추출 1)
    assert len(adapter.calls) == 2


def test_self_correction_recovers_from_sum_mismatch():
    """1차 추출의 합계가 틀려도 2차에서 보정되면 최종은 통과여야 한다."""
    registry = load_registry(CONFIG)
    bad = _good_invoice_response() | {"total_amount": "999,999"}  # 합계 틀림
    adapter = MockVLMAdapter(
        [
            {"template_id": "tax_invoice_kr", "confidence": 0.9},  # 분류
            bad,                                                    # 1차 추출 (실패)
            _good_invoice_response(),                               # 2차 추출 (성공)
        ]
    )
    result = run_pipeline(
        _blank_doc(), registry, adapter,
        preprocess_options=_opts(), max_retries=2,
    )
    assert result.attempts == 2
    assert result.retried is True
    assert result.validate.needs_manual_review is False
    # 재추출 프롬프트는 앞 시도의 실패 사유를 포함해야 한다
    retry_call = adapter.calls[2]
    assert "산술 검증 실패" in retry_call.instruction
    assert "999,999" in retry_call.instruction


def test_self_correction_gives_up_after_max_retries():
    """max_retries 내에서도 못 고치면 최종 결과는 needs_review로 남는다."""
    registry = load_registry(CONFIG)
    bad = _good_invoice_response() | {"total_amount": "999,999"}
    adapter = MockVLMAdapter(
        [
            {"template_id": "tax_invoice_kr", "confidence": 0.9},
            bad,  # 1차
            bad,  # 2차
        ]
    )
    result = run_pipeline(
        _blank_doc(), registry, adapter,
        preprocess_options=_opts(), max_retries=1,
    )
    assert result.attempts == 2
    assert result.validate.needs_manual_review is True


def test_unknown_template_falls_back_to_generic():
    """분류 결과가 unknown이면 generic_document로 폴백해 추출을 계속해야 한다."""
    registry = load_registry(CONFIG)
    adapter = MockVLMAdapter(
        [
            {"template_id": "unknown", "confidence": 0.1},  # 분류 실패
            {                                                # generic 추출
                "document_title": "원무 계산서",
                "issue_date": "2025-05-09",
                "issuer_name": "행복병원",
                "recipient_name": None,
                "total_amount": "55,000",
                "key_value_pairs": [{"label": "환자번호", "value": "P-1234"}],
                "line_items": [],
            },
        ]
    )
    result = run_pipeline(
        _blank_doc(), registry, adapter,
        preprocess_options=_opts(), max_retries=0,
    )
    assert result.fell_back_to_generic is True
    assert result.template_id == "generic_document"
    assert result.extract.fields["total_amount"] == "55,000"


def test_forced_template_skips_classification():
    """--template로 강제 지정하면 분류 호출이 일어나지 않는다."""
    registry = load_registry(CONFIG)
    adapter = MockVLMAdapter([_good_invoice_response()])  # 추출 1번만
    result = run_pipeline(
        _blank_doc(), registry, adapter,
        forced_template_id="tax_invoice_kr",
        preprocess_options=_opts(), max_retries=0,
    )
    assert result.classify is None
    assert len(adapter.calls) == 1


def test_extractor_prompt_contains_anchor_rules():
    """앵커 기반 추출 규칙이 프롬프트에 실제로 박혀있어야 한다 (회귀 방지)."""
    registry = load_registry(CONFIG)
    adapter = MockVLMAdapter([_good_invoice_response()])
    run_pipeline(
        _blank_doc(), registry, adapter,
        forced_template_id="tax_invoice_kr",
        preprocess_options=_opts(), max_retries=0,
    )
    prompt = adapter.calls[0].instruction
    assert "앵커" in prompt
    assert "좌표를 보지 말고" in prompt


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
