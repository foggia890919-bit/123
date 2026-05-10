"""문서의 네 모서리를 찾아 정면으로 펴는 모듈.

배경이 단순한 경우 Canny + HoughLines, 복잡한 경우 Contour 면적 최댓값으로
폴백한다. 두 방법이 모두 실패하면 원본을 그대로 반환하고 호출자가 판단한다.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class CornerResult:
    corners: np.ndarray | None
    method: str  # "hough" | "contour" | "fallback"


def _order_corners(pts: np.ndarray) -> np.ndarray:
    """네 점을 [좌상, 우상, 우하, 좌하] 순으로 정렬."""
    pts = pts.reshape(4, 2)
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1).ravel()
    return np.array(
        [
            pts[np.argmin(s)],
            pts[np.argmin(diff)],
            pts[np.argmax(s)],
            pts[np.argmax(diff)],
        ],
        dtype=np.float32,
    )


def _find_corners_by_contour(gray: np.ndarray) -> np.ndarray | None:
    """배경이 복잡한 경우용 — 면적이 가장 큰 사각형 컨투어를 찾는다."""
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edged = cv2.Canny(blurred, 50, 180)
    edged = cv2.dilate(edged, np.ones((3, 3), np.uint8), iterations=1)

    contours, _ = cv2.findContours(edged, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:5]

    img_area = gray.shape[0] * gray.shape[1]
    for c in contours:
        area = cv2.contourArea(c)
        if area < img_area * 0.2:  # 화면의 20% 미만이면 문서로 보지 않음
            continue
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        if len(approx) == 4:
            return approx.reshape(4, 2).astype(np.float32)
    return None


def _find_corners_by_hough(gray: np.ndarray) -> np.ndarray | None:
    """배경이 단순한 경우용 — 직선 4개의 교점."""
    edges = cv2.Canny(gray, 75, 200)
    lines = cv2.HoughLines(edges, 1, np.pi / 180, 150)
    if lines is None or len(lines) < 4:
        return None
    # 단순 구현: 각도로 클러스터링해 수평/수직 각 2개씩 골라 교점을 만든다.
    # 실패 시 None을 반환해 contour 폴백으로 넘긴다.
    horizontals: list[tuple[float, float]] = []
    verticals: list[tuple[float, float]] = []
    for rho, theta in lines[:, 0]:
        if abs(np.sin(theta)) > 0.9:
            horizontals.append((rho, theta))
        elif abs(np.cos(theta)) > 0.9:
            verticals.append((rho, theta))
    if len(horizontals) < 2 or len(verticals) < 2:
        return None
    horizontals.sort(key=lambda x: x[0])
    verticals.sort(key=lambda x: x[0])
    h_top, h_bot = horizontals[0], horizontals[-1]
    v_left, v_right = verticals[0], verticals[-1]

    def intersect(a: tuple[float, float], b: tuple[float, float]) -> tuple[float, float] | None:
        rho1, t1 = a
        rho2, t2 = b
        a1, b1 = np.cos(t1), np.sin(t1)
        a2, b2 = np.cos(t2), np.sin(t2)
        det = a1 * b2 - a2 * b1
        if abs(det) < 1e-6:
            return None
        x = (b2 * rho1 - b1 * rho2) / det
        y = (a1 * rho2 - a2 * rho1) / det
        return (x, y)

    pts = []
    for h in (h_top, h_bot):
        for v in (v_left, v_right):
            p = intersect(h, v)
            if p is None:
                return None
            pts.append(p)
    return np.array(pts, dtype=np.float32)


def find_document_corners(image: np.ndarray) -> CornerResult:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    corners = _find_corners_by_hough(gray)
    if corners is not None:
        return CornerResult(corners=_order_corners(corners), method="hough")
    corners = _find_corners_by_contour(gray)
    if corners is not None:
        return CornerResult(corners=_order_corners(corners), method="contour")
    return CornerResult(corners=None, method="fallback")


def warp_to_front(image: np.ndarray, corners: np.ndarray) -> np.ndarray:
    tl, tr, br, bl = corners
    width = int(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl)))
    height = int(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl)))
    width = max(width, 100)
    height = max(height, 100)
    dst = np.array(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
        dtype=np.float32,
    )
    M = cv2.getPerspectiveTransform(corners, dst)
    return cv2.warpPerspective(image, M, (width, height))


def correct_perspective(image: np.ndarray) -> tuple[np.ndarray, str]:
    """모서리를 찾아 정면으로 편 이미지와 사용된 방법명을 반환."""
    result = find_document_corners(image)
    if result.corners is None:
        return image, "fallback"
    return warp_to_front(image, result.corners), result.method
