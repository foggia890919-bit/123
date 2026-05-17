"""AI-Assisted Cropping — VLM에게 문서 네 모서리를 직접 묻는다.

OpenCV의 Canny/Hough/Adaptive로 잡히지 않는 케이스 (모니터 베젤이 검정,
종이가 프레임 밖으로 잘림, 워터마크/얼룩으로 외곽 엣지가 깨진 경우)에서
폴백으로 쓴다. VLM 호출비용이 들지만 99% 정확도 목표에서는 합리적 트레이드오프.

좌표는 **이미지 정규화 좌표(0~1)**로 받는다 — 이미지 해상도가 달라도
일관된 출력 형태를 강제하기 위함. 실제 픽셀 변환은 호출자가 한다.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import numpy as np

from ..llm import VLMAdapter


_CORNER_PROMPT = (
    "이 이미지에서 **추출 대상 문서**(종이/모니터 화면 안의 표)의 외곽 네 모서리\n"
    "좌표 + 문서의 정방향을 찾아라. 배경(책상·의자·벽·반사·그림자)은 무시하고,\n"
    "**데이터가 있는 직사각형 영역**의 모서리만 짚는다.\n\n"
    "좌표는 이미지 정규화 좌표 (0~1, 좌상단 기준).\n\n"
    "출력 JSON 형식 (다른 텍스트 절대 금지):\n"
    "{\n"
    '  \"top_left\":     [x, y],\n'
    '  \"top_right\":    [x, y],\n'
    '  \"bottom_right\": [x, y],\n'
    '  \"bottom_left\":  [x, y],\n'
    '  \"rotation_to_upright\": 0|90|180|270,\n'
    '  \"confidence\":   0~1 사이의 자신감 점수,\n'
    '  \"note\":         \"왜 그 4점을 골랐는지 한 줄\"\n'
    "}\n\n"
    "rotation_to_upright 의미: 현재 이미지를 **시계방향**으로 그만큼 돌리면\n"
    "글자가 정상 방향으로 읽힌다. 즉:\n"
    "  - 이미 정방향이면 0\n"
    "  - 글자가 시계방향으로 누워있으면(가로쓰기가 세로처럼) 270\n"
    "  - 글자가 거꾸로면 180\n"
    "  - 글자가 반시계방향으로 누워있으면 90\n"
    "워터마크/도장 같은 큰 글자에 헷갈리지 말고, 표의 헤더(`청구코드 명칭 단위 처방횟수` 등)\n"
    "가 어디에 있는지로 판단.\n\n"
    "주의:\n"
    "  - 모서리가 이미지 프레임 밖으로 나가면 0 또는 1로 클램프하라.\n"
    "  - top_left/right/bottom_left/right 는 **현재 이미지 기준**의 4 모서리.\n"
    "    회전 후의 좌표가 아님.\n"
    "  - 종이 가장자리가 보이지 않거나 자신없으면 confidence=0으로 두고,\n"
    "    네 점을 [0,0],[1,0],[1,1],[0,1] (이미지 전체)로 채워라.\n"
    "  - 좌표 순서: 시계방향. top_left부터 bottom_left까지."
)


@dataclass
class VLMCornerResult:
    corners: np.ndarray | None  # shape (4,2), 픽셀 좌표
    rotation_to_upright: int     # 0/90/180/270 — 시계방향 회전 각도
    confidence: float
    note: str
    raw: dict[str, Any]


def _normalized_to_pixel(corners_norm: list[list[float]], h: int, w: int) -> np.ndarray:
    pts = np.array(corners_norm, dtype=np.float32)
    pts[:, 0] = np.clip(pts[:, 0], 0.0, 1.0) * (w - 1)
    pts[:, 1] = np.clip(pts[:, 1], 0.0, 1.0) * (h - 1)
    return pts


def locate_corners_with_vlm(
    image: np.ndarray,
    adapter: VLMAdapter,
    *,
    min_confidence: float = 0.5,
) -> VLMCornerResult:
    """VLM이 네 모서리를 짚어낼 때까지 한 번 호출. 실패하면 corners=None."""
    schema = {
        "type": "object",
        "properties": {
            "top_left": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
            "top_right": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
            "bottom_right": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
            "bottom_left": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
            "rotation_to_upright": {"type": "integer"},
            "confidence": {"type": "number"},
            "note": {"type": "string"},
        },
        "required": ["top_left", "top_right", "bottom_right", "bottom_left", "confidence"],
    }
    response = adapter.generate_json(image, _CORNER_PROMPT, schema)
    data = response.data or {}

    if data.get("_parse_error"):
        return VLMCornerResult(corners=None, rotation_to_upright=0, confidence=0.0,
                               note="VLM JSON 파싱 실패", raw=data)

    try:
        corners_norm = [
            data["top_left"],
            data["top_right"],
            data["bottom_right"],
            data["bottom_left"],
        ]
        confidence = float(data.get("confidence", 0.0))
    except (KeyError, TypeError, ValueError) as e:
        return VLMCornerResult(corners=None, rotation_to_upright=0, confidence=0.0,
                               note=f"필드 누락: {e}", raw=data)

    # rotation_to_upright 추출 — VLM 이 0/90/180/270 중 하나로 답해야. 다른 값은 0 으로 클램프.
    rot_raw = data.get("rotation_to_upright", 0)
    try:
        rot = int(rot_raw) % 360
    except (TypeError, ValueError):
        rot = 0
    rotation_to_upright = rot if rot in (0, 90, 180, 270) else 0

    if confidence < min_confidence:
        return VLMCornerResult(
            corners=None,
            rotation_to_upright=rotation_to_upright,
            confidence=confidence,
            note=f"VLM 자신감 부족 ({confidence:.2f} < {min_confidence})",
            raw=data,
        )

    h, w = image.shape[:2]
    pixel_corners = _normalized_to_pixel(corners_norm, h, w)

    if _is_full_frame(corners_norm):
        return VLMCornerResult(
            corners=None,
            rotation_to_upright=rotation_to_upright,
            confidence=confidence,
            note="VLM이 이미지 전체를 반환 — 모서리 검출 포기로 해석",
            raw=data,
        )

    return VLMCornerResult(
        corners=pixel_corners,
        rotation_to_upright=rotation_to_upright,
        confidence=confidence,
        note=str(data.get("note", "")),
        raw=data,
    )


def _is_full_frame(norm: list[list[float]], tol: float = 0.05) -> bool:
    """네 점이 거의 [0,0]·[1,0]·[1,1]·[0,1] 이면 VLM이 검출 포기한 것."""
    expected = [(0, 0), (1, 0), (1, 1), (0, 1)]
    for (x, y), (ex, ey) in zip(norm, expected):
        if abs(x - ex) > tol or abs(y - ey) > tol:
            return False
    return True
