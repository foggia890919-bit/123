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


def _quad_area(corners: np.ndarray) -> float:
    """4점 사각형의 면적 (Shoelace)."""
    pts = corners.reshape(4, 2)
    x = pts[:, 0]
    y = pts[:, 1]
    return 0.5 * abs(
        x[0] * y[1] - x[1] * y[0]
        + x[1] * y[2] - x[2] * y[1]
        + x[2] * y[3] - x[3] * y[2]
        + x[3] * y[0] - x[0] * y[3]
    )


def correct_perspective(
    image: np.ndarray,
    min_area_ratio: float = 0.25,
    aspect_range: tuple[float, float] = (0.4, 2.5),
    min_span_ratio: float = 0.5,
    vlm_adapter: object | None = None,
) -> tuple[np.ndarray, str]:
    """모서리를 찾아 정면으로 편 이미지와 사용된 방법명을 반환.

    검출 순서:
      1. OpenCV (Hough → Contour) 시도
      2. OpenCV가 실패하거나 가드를 못 통과하면 vlm_adapter가 주어진 경우
         AI-Assisted Cropping (VLM에게 4 모서리 좌표 직접 물음) 시도
      3. 그것도 실패하면 fallback (원본 그대로)

    세 단계 신뢰성 가드 — 하나라도 실패하면 다음 방법으로 폴오버:
      - 사각형 면적 / 원본 면적 >= min_area_ratio
      - 결과 종횡비가 aspect_range 안
      - corners의 x 범위와 y 범위가 각각 이미지 W·H의 min_span_ratio 이상
    """
    h_img, w_img = image.shape[:2]
    img_area = h_img * w_img

    cv_result = find_document_corners(image)
    cv_status = _evaluate_corners(
        cv_result.corners, image, img_area, min_area_ratio, aspect_range, min_span_ratio
    )
    if cv_status == "ok":
        return warp_to_front(image, cv_result.corners), cv_result.method

    # VLM 폴오버 정책: OpenCV가 "완전 실패"(corners=None) 한 케이스에만 발동.
    # OpenCV 가 4점은 찾았는데 면적·종횡비 가드만 못 통과(fallback_too_small/partial
    # /bad_aspect)한 경우엔 표 외곽 일부만 인식했다는 신호 — 이때 VLM 에 다시
    # 묻으면 페이지 헤더(타이틀바) 같은 엉뚱한 영역을 새 사각형으로 짚을 위험이
    # 더 크다 (실측: 04_paper_watermark 케이스에서 hospital_name 이 페이지
    # 타이틀로 환각). 그 경우엔 그냥 원본을 쓴다.
    if vlm_adapter is None or cv_result.corners is not None:
        return image, cv_status if cv_result.corners is not None else "fallback"

    from .vlm_corners import locate_corners_with_vlm

    vlm_res = locate_corners_with_vlm(image, vlm_adapter)
    if vlm_res.corners is None:
        return image, f"fallback_vlm({vlm_res.note})"

    ordered = _order_corners(vlm_res.corners)
    vlm_status = _evaluate_corners(
        ordered, image, img_area, min_area_ratio, aspect_range, min_span_ratio
    )
    if vlm_status == "ok":
        return warp_to_front(image, ordered), f"vlm(conf={vlm_res.confidence:.2f})"
    return image, f"fallback_vlm_{vlm_status}"


def _evaluate_corners(
    corners: np.ndarray | None,
    image: np.ndarray,
    img_area: float,
    min_area_ratio: float,
    aspect_range: tuple[float, float],
    min_span_ratio: float,
) -> str:
    """corners가 신뢰할 만한지 검사 — 'ok' 또는 실패 사유 코드 반환."""
    if corners is None:
        return "fallback"
    quad_area = _quad_area(corners)
    if quad_area < img_area * min_area_ratio:
        return "fallback_too_small"
    h_img, w_img = image.shape[:2]
    pts = corners.reshape(4, 2)
    x_span = (pts[:, 0].max() - pts[:, 0].min()) / w_img
    y_span = (pts[:, 1].max() - pts[:, 1].min()) / h_img
    if x_span < min_span_ratio or y_span < min_span_ratio:
        return "fallback_partial"
    # 종횡비는 워프 후 해상도로 판단 — pre-warp 모의 측정
    width = max(np.linalg.norm(pts[2] - pts[3]), np.linalg.norm(pts[1] - pts[0]))
    height = max(np.linalg.norm(pts[1] - pts[2]), np.linalg.norm(pts[0] - pts[3]))
    if height < 1:
        return "fallback_bad_aspect"
    aspect = width / height
    if aspect < aspect_range[0] or aspect > aspect_range[1]:
        return "fallback_bad_aspect"
    return "ok"
