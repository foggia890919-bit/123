"""이미지 회전 자동 보정 (0/90/180/270).

OCR/VLM은 글자가 가로로 누워 있을 때 인식률이 급락한다. 핸드폰으로 책상 위
종이를 찍으면 EXIF 회전이 빠지거나 90도 누운 채로 들어오는 경우가 흔하다.

휴리스틱: 이미지의 우세 직선 방향을 본다. 가로쓰기 한국어 양식은 표 격자가
가로선이 더 많고, 글자도 가로로 늘어선다. 90도 회전된 이미지는 세로선이 더
많이 검출된다. v_count > h_count*1.3이면 회전이 필요하다고 판단해 -90도 돌린다.

180/270 구분은 이 단계에서 못 한다 — 그건 글자의 의미를 봐야 알 수 있는 일이고,
VLM이 책임진다. 이 모듈은 "글자가 가로로 늘어선 상태"를 만드는 데까지만 책임.
"""

from __future__ import annotations

import cv2
import numpy as np


def _line_direction_counts(gray: np.ndarray) -> tuple[int, int]:
    """가로 우세 직선 수 / 세로 우세 직선 수."""
    edges = cv2.Canny(gray, 50, 150)
    lines = cv2.HoughLinesP(
        edges, 1, np.pi / 180, threshold=120,
        minLineLength=min(gray.shape) // 8,
        maxLineGap=10,
    )
    if lines is None:
        return 0, 0
    h_count = 0
    v_count = 0
    for x1, y1, x2, y2 in lines[:, 0]:
        dx = abs(x2 - x1)
        dy = abs(y2 - y1)
        if dx > dy * 2:
            h_count += 1
        elif dy > dx * 2:
            v_count += 1
    return h_count, v_count


def estimate_rotation_degrees(image: np.ndarray) -> int:
    """0 또는 90을 반환. 글자가 가로로 보이게 만들기 위해 시계방향으로 돌릴 각도."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    h_count, v_count = _line_direction_counts(gray)
    if v_count > max(h_count, 1) * 1.3:
        return 90  # 90도 시계방향으로 돌리면 가로쓰기가 된다
    return 0


def rotate_clockwise(image: np.ndarray, degrees: int) -> np.ndarray:
    """OpenCV의 무손실 90도 회전만 사용 (warpAffine 보간 없음)."""
    if degrees == 0:
        return image
    if degrees == 90:
        return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    if degrees == 180:
        return cv2.rotate(image, cv2.ROTATE_180)
    if degrees == 270:
        return cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
    raise ValueError(f"무손실 회전은 0/90/180/270만 지원: {degrees}")


def auto_orient(image: np.ndarray) -> tuple[np.ndarray, int]:
    """추정된 각도로 자동 회전. (회전된 이미지, 적용한 각도) 반환."""
    deg = estimate_rotation_degrees(image)
    return rotate_clockwise(image, deg), deg
