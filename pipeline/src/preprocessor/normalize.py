"""최종 규격화 — 후단(OCR/VLM)에 항상 같은 형식의 입력이 가도록 한다.

CamScanner 의 마지막 단계: 가장자리 흰 여백 정리 + 고정 폭 리사이즈.

  - trim_white_margins  : 4 가장자리에서 거의 흰색인 행/열을 잘라낸다. perspective
                          단계에서 사각형이 약간 커서 종이 바깥 흰 배경이 남는
                          케이스를 깎음. 글자가 있는 영역은 절대 자르지 않도록
                          작은 빈도 임계로만.
  - resize_to_width     : 폭을 고정값(기본 1600)으로 통일. VLM 은 입력 해상도에
                          따라 응답이 변하는데 (큰 이미지 = 환각 위험), 매번 같은
                          크기를 보내면 응답 패턴이 일관된다. OCR 도 마찬가지.
"""

from __future__ import annotations

import cv2
import numpy as np


def trim_white_margins(image: np.ndarray, threshold: int = 235, min_keep: float = 0.5) -> np.ndarray:
    """4 가장자리에서 흰 행/열을 trim. 자르고 남는 영역이 원본의 min_keep 비율
    미만이면 자르지 않음 (과도한 trim 안전판)."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    h, w = gray.shape

    # 각 행/열에서 흰 픽셀 비율
    row_white = (gray > threshold).mean(axis=1)
    col_white = (gray > threshold).mean(axis=0)

    # 흰 비율 0.95 이상인 행/열만 trim 대상
    top = 0
    while top < h and row_white[top] > 0.95:
        top += 1
    bot = h - 1
    while bot > top and row_white[bot] > 0.95:
        bot -= 1
    left = 0
    while left < w and col_white[left] > 0.95:
        left += 1
    right = w - 1
    while right > left and col_white[right] > 0.95:
        right -= 1

    new_h = bot - top + 1
    new_w = right - left + 1
    if new_h < h * min_keep or new_w < w * min_keep:
        return image  # 너무 많이 잘리면 (글자 영역까지 흰색) trim 포기
    return image[top : bot + 1, left : right + 1]


def resize_to_width(image: np.ndarray, target_width: int = 1600) -> np.ndarray:
    """폭을 target_width 로 맞춤. 종횡비는 보존. 이미 그 폭이면 그대로.

    OCR/VLM 모두 입력 해상도가 응답 패턴에 영향을 주므로, 모든 샘플을 같은 폭으로
    통일해서 후단을 stationary 하게 만든다. 너무 작아지면 글자 가독성 떨어지므로
    최소 800 까진 유지.
    """
    h, w = image.shape[:2]
    target_width = max(target_width, 800)
    if abs(w - target_width) < 50:
        return image
    scale = target_width / w
    new_h = max(1, int(h * scale))
    interp = cv2.INTER_AREA if scale < 1.0 else cv2.INTER_CUBIC
    return cv2.resize(image, (target_width, new_h), interpolation=interp)


def normalize(image: np.ndarray, target_width: int = 1600) -> np.ndarray:
    """trim → resize 를 한 번에."""
    trimmed = trim_white_margins(image)
    return resize_to_width(trimmed, target_width)
