"""조도/그림자/어두운 배경 보정.

세 단계로 나뉜다.
1. shadow_remove — 모폴로지로 배경 광맵을 추정해 빼낸다 (그림자/얼룩 제거).
2. apply_clahe   — 명암 대비를 국소적으로 끌어올려 어두운 영역의 글자 가독성 회복.
3. binarize      — Sauvola/Adaptive 두 단계 폴백으로 문자 픽셀만 추출.
"""

from __future__ import annotations

import cv2
import numpy as np


def shadow_remove(image: np.ndarray) -> np.ndarray:
    """배경 광맵을 dilate-blur로 추정하고 normalize해 그림자를 제거한다.

    어두운 배경 양식과 형광등 그림자가 겹쳐 글자가 묻히는 케이스에서 가장 큰 효과.
    """
    if image.ndim == 2:
        channels = [image]
    else:
        channels = list(cv2.split(image))

    out = []
    for ch in channels:
        dilated = cv2.dilate(ch, np.ones((7, 7), np.uint8))
        bg = cv2.medianBlur(dilated, 21)
        diff = 255 - cv2.absdiff(ch, bg)
        norm = cv2.normalize(diff, None, 0, 255, cv2.NORM_MINMAX, dtype=cv2.CV_8U)
        out.append(norm)
    return out[0] if len(out) == 1 else cv2.merge(out)


def apply_clahe(image: np.ndarray, clip_limit: float = 3.0, tile: int = 8) -> np.ndarray:
    """LAB 공간의 L 채널에 CLAHE를 걸어 색조는 보존하고 명암만 끌어올린다."""
    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(tile, tile))
    if image.ndim == 2:
        return clahe.apply(image)
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    l = clahe.apply(l)
    return cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)


def is_dark_background(image: np.ndarray, threshold: int = 110) -> bool:
    """이미지 평균 밝기로 어두운 배경 양식인지 추정."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    return float(gray.mean()) < threshold


def invert_if_dark(image: np.ndarray) -> tuple[np.ndarray, bool]:
    """어두운 배경 + 밝은 글자 양식이면 색을 반전시켜 OCR 친화 형태로 만든다."""
    if is_dark_background(image):
        return cv2.bitwise_not(image), True
    return image, False


def binarize(image: np.ndarray) -> np.ndarray:
    """Adaptive Threshold 기반 이진화. Sauvola가 필요할 만큼 까다로운 경우는
    호출자가 직접 보정 단계 위에 binarize를 끄거나 더 강한 파라미터로 다시 부른다.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    return cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 15
    )


def boost_table_grid(image: np.ndarray) -> np.ndarray:
    """복잡한 표 양식에서 셀 경계가 흐릿할 때 가로/세로 선을 강화해 셀 분할을 안정화."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    inv = cv2.bitwise_not(
        cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, 15, -2
        )
    )
    horizontal = inv.copy()
    vertical = inv.copy()
    h_size = max(10, horizontal.shape[1] // 30)
    v_size = max(10, vertical.shape[0] // 30)
    h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (h_size, 1))
    v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, v_size))
    horizontal = cv2.morphologyEx(horizontal, cv2.MORPH_OPEN, h_kernel)
    vertical = cv2.morphologyEx(vertical, cv2.MORPH_OPEN, v_kernel)
    grid = cv2.add(horizontal, vertical)
    # 원본에 격자 선만 진하게 덮어 OCR 엔진의 셀 인식을 도와준다.
    boosted = gray.copy()
    boosted[grid > 0] = 0
    return boosted
