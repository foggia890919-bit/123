"""산술 검증이 실패한 행만 ROI로 잘라 고해상도로 VLM에 재요청.

문서 전체를 다시 통째로 뜯는 게 아니라 **문제가 된 행 한 줄**만 좁게 잘라서
VLM이 그 셀에만 집중하도록 한다. 99% 신뢰도 추구에서 cost-effective:
  - 통째 재추출 비용 ≫ 단일 행 ROI 비용
  - 작은 영역일수록 VLM이 더 정확히 읽는 경향

위치 추정 전략 (VLM 좌표 없이):
  1. 표 영역의 y범위를 균등하게 N등분 (N = 추출된 drugs 행 수)
  2. 실패한 인덱스 i의 행 → y_band[i] 잘라낸다
  3. 좌우 여유 5% 패딩

이건 휴리스틱이라 정확도 100%는 아니다. 더 정확히 하려면 VLM에게 행별 bbox를
같이 받아두는 방식이 좋지만, 우선 호출 비용/구현 단순성 트레이드오프로
이 단순 분할안을 1차로 제공.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..llm import VLMAdapter


@dataclass
class RowReExtractResult:
    row_index: int
    new_row: dict | None
    crop_shape: tuple[int, int] | None
    note: str


def _crop_row_band(image: np.ndarray, row_idx: int, n_rows: int) -> np.ndarray:
    """이미지를 행 수만큼 균등 분할해 row_idx 밴드를 잘라낸다 (좌우 5% 여유)."""
    h, w = image.shape[:2]
    # 표 영역이 이미지의 위 60%에 있다고 가정 (제목/요약/푸터 영역 고려)
    table_top = int(h * 0.15)
    table_bottom = int(h * 0.75)
    band_h = (table_bottom - table_top) / max(n_rows, 1)
    y0 = max(0, int(table_top + band_h * row_idx) - 5)
    y1 = min(h, int(table_top + band_h * (row_idx + 1)) + 5)
    x_pad = int(w * 0.02)
    return image[y0:y1, x_pad: w - x_pad]


_PROMPT = (
    "이 이미지는 처방통계표의 한 행만 클로즈업한 것이다. 이 한 행에서 다음을\n"
    "정확히 읽어라. 다른 행은 보지 말고 이 사진에 보이는 한 줄만 본다.\n\n"
    "출력 JSON (다른 텍스트 절대 금지):\n"
    "{\n"
    '  \"drug_code\":   \"...\",\n'
    '  \"drug_name\":   \"...\",\n'
    '  \"unit_price\":  숫자만,\n'
    '  \"total_qty\":   숫자만,\n'
    '  \"total_amount\": 숫자만,\n'
    '  \"confidence\":  0~1\n'
    "}\n\n"
    "주의:\n"
    "  - 단가 × 총사용량 = 총금액 이 성립해야 한다. 한 자리라도 안 맞으면\n"
    "    다시 더 자세히 봐라.\n"
    "  - 글자가 깨졌으면 추측하지 말고 confidence를 낮춰라."
)


def re_extract_row(
    full_image: np.ndarray,
    row_index: int,
    n_total_rows: int,
    adapter: VLMAdapter,
) -> RowReExtractResult:
    """row_index에 해당하는 행만 잘라 VLM 재호출. 산술 검증이 다시 실패하면 None."""
    crop = _crop_row_band(full_image, row_index, n_total_rows)
    if crop.size == 0:
        return RowReExtractResult(
            row_index=row_index, new_row=None, crop_shape=None, note="크롭 영역 없음"
        )

    response = adapter.generate_json(crop, _PROMPT, None)
    data = response.data or {}
    if data.get("_parse_error"):
        return RowReExtractResult(
            row_index=row_index,
            new_row=None,
            crop_shape=crop.shape[:2],
            note="ROI VLM JSON 파싱 실패",
        )

    # 산술 자체 검증
    try:
        up = int(str(data.get("unit_price", 0)).replace(",", ""))
        qty = int(str(data.get("total_qty", 0)).replace(",", ""))
        ta = int(str(data.get("total_amount", 0)).replace(",", ""))
    except (TypeError, ValueError):
        return RowReExtractResult(
            row_index=row_index,
            new_row=None,
            crop_shape=crop.shape[:2],
            note="ROI 응답에 숫자 파싱 실패",
        )

    if up * qty != ta:
        return RowReExtractResult(
            row_index=row_index,
            new_row=None,
            crop_shape=crop.shape[:2],
            note=f"ROI 재추출 산술도 실패: {up}*{qty}={up*qty} vs {ta}",
        )

    return RowReExtractResult(
        row_index=row_index,
        new_row={
            "drug_code": data.get("drug_code"),
            "drug_name": data.get("drug_name"),
            "unit_price": up,
            "total_qty": qty,
            "total_amount": ta,
        },
        crop_shape=crop.shape[:2],
        note=f"ROI 재추출 성공 (conf={data.get('confidence', 0):.2f})",
    )


def re_extract_failed_rows(
    full_image: np.ndarray,
    drugs: list[dict],
    failed_indices: list[int],
    adapter: VLMAdapter,
) -> tuple[list[dict], list[RowReExtractResult]]:
    """실패한 인덱스들을 재추출해 drugs 리스트의 해당 행을 교체."""
    n = len(drugs)
    new_drugs = list(drugs)
    reports: list[RowReExtractResult] = []
    for idx in failed_indices:
        if idx < 0 or idx >= n:
            continue
        rep = re_extract_row(full_image, idx, n, adapter)
        reports.append(rep)
        if rep.new_row is not None:
            merged = dict(new_drugs[idx])
            merged.update({k: v for k, v in rep.new_row.items() if v is not None})
            new_drugs[idx] = merged
    return new_drugs, reports
