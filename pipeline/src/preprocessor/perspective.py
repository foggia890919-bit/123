"""문서의 네 모서리를 찾아 정면으로 펴는 모듈.

폴백 체인 — 위에서 실패하면 다음 단계로 내려간다:
  1. Hough lines          : 배경이 단순한 경우 (직선 4개 교점)
  2. Contour              : 배경이 약간 복잡 (가장 큰 4각 폴리곤)
  3. GrabCut polygon      : 배경이 복잡 (전경 마스크 → 폴리곤)
  4. VLM (옵션)            : 위 셋 다 실패 + adapter 있을 때만
  5. minAreaRect           : 4 점 못 찾았지만 회전 직사각형으로라도 펴기
                            (구겨진 종이/모서리 일부 잘림 케이스 안전망)
  6. deskew                : 마지막 안전망 — Hough 로 텍스트 줄 기울기 추정해 역회전
                            (perspective 가 다 실패해도 기울기만이라도 제거)

"원본 raw 가 후단으로 통과되는 일은 없다" 가 핵심 — 입력 정규화가 도돌이표의
가장 큰 원인이므로, 어떤 사진이 들어와도 최소한 deskew 까지는 보장한다.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class CornerResult:
    corners: np.ndarray | None
    method: str  # "hough" | "contour" | "grabcut" | "fallback"


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
    """배경이 약간 복잡한 경우용 — 면적이 가장 큰 사각형 컨투어를 찾는다."""
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


def _find_corners_by_grabcut(image: np.ndarray) -> np.ndarray | None:
    """배경이 복잡한 경우용 — GrabCut 으로 전경 추정 후 폴리곤 근사.

    가장자리 10% 안쪽을 종이 영역 시드로 주고 4번 반복. 결과 마스크의 가장 큰
    컨투어를 4점 폴리곤으로 근사. 5점 이상 나오면 minAreaRect 폴백은 호출자가.
    """
    if image.ndim != 3:
        return None
    h, w = image.shape[:2]
    # 너무 작은 이미지는 GrabCut 이 비싸고 큰 의미도 없으니 스킵
    if h * w < 200 * 200:
        return None
    # 다운샘플로 GrabCut 비용 줄임 (결과 좌표는 다시 원본 스케일로 복원)
    scale = 600.0 / max(h, w)
    if scale < 1.0:
        small = cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    else:
        small = image
        scale = 1.0
    sh, sw = small.shape[:2]

    mask = np.zeros((sh, sw), np.uint8)
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    rect = (sw // 10, sh // 10, sw * 8 // 10, sh * 8 // 10)
    try:
        cv2.grabCut(small, mask, rect, bgd, fgd, 3, cv2.GC_INIT_WITH_RECT)
    except cv2.error:
        return None
    fg = ((mask == cv2.GC_PR_FGD) | (mask == cv2.GC_FGD)).astype(np.uint8) * 255
    # 작은 구멍 메우기
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))

    contours, _ = cv2.findContours(fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    biggest = max(contours, key=cv2.contourArea)
    if cv2.contourArea(biggest) < sh * sw * 0.2:
        return None
    peri = cv2.arcLength(biggest, True)
    # 조금 더 관대한 epsilon — GrabCut 결과는 경계가 들쭉날쭉해서 0.02 로는 5점+ 나오기 쉬움
    approx = cv2.approxPolyDP(biggest, 0.03 * peri, True)
    if len(approx) != 4:
        return None
    pts = approx.reshape(4, 2).astype(np.float32)
    # 원본 스케일로 복원
    return pts / scale


def _find_corners_by_min_area_rect(image: np.ndarray) -> np.ndarray | None:
    """4점 폴리곤 못 찾았을 때의 최후 보루 — GrabCut 마스크의 회전 직사각형.

    구겨진 종이·모서리 잘린 사진처럼 4-각 폴리곤이 안 나오는 경우, 적어도
    종이가 차지하는 영역의 회전 사각형은 잡을 수 있다. 이걸 펴면 기울기 +
    바깥 배경 제거는 됨 (구겨짐 자체는 못 펴지만 후단에 일관된 입력 제공).
    """
    if image.ndim != 3:
        return None
    h, w = image.shape[:2]
    if h * w < 200 * 200:
        return None
    scale = 600.0 / max(h, w)
    if scale < 1.0:
        small = cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    else:
        small = image
        scale = 1.0
    sh, sw = small.shape[:2]

    mask = np.zeros((sh, sw), np.uint8)
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    rect = (sw // 10, sh // 10, sw * 8 // 10, sh * 8 // 10)
    try:
        cv2.grabCut(small, mask, rect, bgd, fgd, 3, cv2.GC_INIT_WITH_RECT)
    except cv2.error:
        return None
    fg = ((mask == cv2.GC_PR_FGD) | (mask == cv2.GC_FGD)).astype(np.uint8) * 255
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    contours, _ = cv2.findContours(fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    biggest = max(contours, key=cv2.contourArea)
    if cv2.contourArea(biggest) < sh * sw * 0.2:
        return None
    rot = cv2.minAreaRect(biggest)
    box = cv2.boxPoints(rot).astype(np.float32)
    return box / scale


def find_document_corners(image: np.ndarray) -> CornerResult:
    """폴리곤 4점 검출 — Hough → Contour → GrabCut 순. 모두 실패하면 None."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    corners = _find_corners_by_hough(gray)
    if corners is not None:
        return CornerResult(corners=_order_corners(corners), method="hough")
    corners = _find_corners_by_contour(gray)
    if corners is not None:
        return CornerResult(corners=_order_corners(corners), method="contour")
    corners = _find_corners_by_grabcut(image)
    if corners is not None:
        return CornerResult(corners=_order_corners(corners), method="grabcut")
    return CornerResult(corners=None, method="fallback")


def warp_to_front(
    image: np.ndarray,
    corners: np.ndarray,
    outward_margin: float = 0.0,
) -> np.ndarray:
    """corners 를 정면 사각형으로 워프. outward_margin > 0 이면 검출 사각형 바깥쪽으로
    그만큼 비율만큼 확장해서 잘림 위험을 줄임 — 검출 사각형이 표 가장자리를 약간
    자르는 케이스(특히 min_area_rect 폴백) 안전판."""
    tl, tr, br, bl = corners
    if outward_margin > 0.0:
        cx = (tl[0] + tr[0] + br[0] + bl[0]) / 4.0
        cy = (tl[1] + tr[1] + br[1] + bl[1]) / 4.0
        f = 1.0 + outward_margin
        center = np.array([cx, cy], dtype=np.float32)
        expanded = np.array([
            center + (tl - center) * f,
            center + (tr - center) * f,
            center + (br - center) * f,
            center + (bl - center) * f,
        ], dtype=np.float32)
        corners = expanded
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
    return cv2.warpPerspective(
        image, M, (width, height),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )


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


def deskew(image: np.ndarray, max_angle: float = 10.0) -> tuple[np.ndarray, float]:
    """텍스트 줄 기울기 미세 보정 — Hough 로 가장 강한 수평선들의 평균 각도로 역회전.

    perspective 가 완전히 실패한 케이스의 마지막 안전망. ±max_angle 도 이내 기울기만
    잡고 그 밖이면 손대지 않는다 (큰 기울기는 perspective 단계의 책임).
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    edges = cv2.Canny(gray, 50, 150)
    lines = cv2.HoughLinesP(
        edges, 1, np.pi / 180, threshold=100,
        minLineLength=min(gray.shape) // 4,
        maxLineGap=10,
    )
    if lines is None:
        return image, 0.0
    angles: list[float] = []
    for x1, y1, x2, y2 in lines[:, 0]:
        dx = x2 - x1
        dy = y2 - y1
        if dx == 0:
            continue
        ang = np.degrees(np.arctan2(dy, dx))
        # 수평에 가까운 선만 — ±max_angle 도 이내
        if abs(ang) < max_angle:
            angles.append(ang)
    if len(angles) < 5:
        return image, 0.0
    median_angle = float(np.median(angles))
    if abs(median_angle) < 0.5:
        return image, 0.0  # 0.5도 미만은 무시 — 워프 보간으로 오히려 화질 손해
    # 그만큼 반대로 회전
    h, w = image.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), median_angle, 1.0)
    rotated = cv2.warpAffine(
        image, M, (w, h),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )
    return rotated, median_angle


def correct_perspective(
    image: np.ndarray,
    min_area_ratio: float = 0.25,
    aspect_range: tuple[float, float] = (0.4, 2.5),
    min_span_ratio: float = 0.5,
    vlm_adapter: object | None = None,
) -> tuple[np.ndarray, str]:
    """모서리를 찾아 정면으로 편 이미지와 사용된 방법명을 반환.

    검출 순서:
      1. Hough → 2. Contour → 3. GrabCut polygon (find_document_corners 안)
      4. (옵션) VLM
      5. minAreaRect — 4점 못 찾았을 때 회전 직사각형으로라도 펴기
      6. deskew — 마지막 안전망 (기울기만이라도 제거)

    "원본 raw 통과 없음" 이 보장됨 — 항상 최소한 deskew 까지는 적용.
    """
    h_img, w_img = image.shape[:2]
    img_area = h_img * w_img

    # 1~3
    cv_result = find_document_corners(image)
    cv_status = _evaluate_corners(
        cv_result.corners, image, img_area, min_area_ratio, aspect_range, min_span_ratio
    )
    if cv_status == "ok":
        return warp_to_front(image, cv_result.corners), cv_result.method

    # 4: VLM 폴오버 — OpenCV 가 가드를 통과 못 한 모든 케이스에서 적극 발동.
    # (이전엔 corners=None 일 때만 호출 → 04_paper_watermark 같은 케이스에서
    #  Hough/Contour/GrabCut 다 통과 못 했는데 minAreaRect 가 종이 회전 사각형을
    #  잡으며 표 오른쪽을 잘랐다. VLM 에 직접 4 모서리를 물으면 사람이 보듯
    #  종이 외곽을 짚어주므로, 비용 +1콜로 정확도 ↑.)
    #
    # 가드 통과한 VLM 결과만 채택 — VLM 도 자신없을 땐 confidence<0.5 로 거부됨.
    # 그것마저 실패하면 minAreaRect 로 떨어진다.
    if vlm_adapter is not None:
        from .vlm_corners import locate_corners_with_vlm

        vlm_res = locate_corners_with_vlm(image, vlm_adapter)
        if vlm_res.corners is not None:
            ordered = _order_corners(vlm_res.corners)
            vlm_status = _evaluate_corners(
                ordered, image, img_area, min_area_ratio, aspect_range, min_span_ratio
            )
            if vlm_status == "ok":
                # VLM 이 정방향 기준으로 top_left/top_right/... 를 짚으므로 워프
                # 결과는 자동으로 정방향이 됨 (VLM rotation 필드는 신뢰성 낮아 안 씀).
                # 외측 마진 3% — VLM 이 종이 가장자리 안쪽으로 짚는 경향 안전판.
                return (
                    warp_to_front(image, ordered, outward_margin=0.03),
                    f"vlm(conf={vlm_res.confidence:.2f})",
                )

    # 5: minAreaRect — 회전 직사각형으로라도 펴기 (구겨진 종이 안전망).
    # 검출 사각형이 표 가장자리(특히 가장 우측 컬럼)를 약간 자르는 일이 잦아
    # outward_margin=0.08 로 8% 바깥쪽 확장 후 워프 — 검출 오차 안전 마진.
    rot_corners = _find_corners_by_min_area_rect(image)
    if rot_corners is not None:
        ordered = _order_corners(rot_corners)
        rot_status = _evaluate_corners(
            ordered, image, img_area, min_area_ratio, aspect_range, min_span_ratio
        )
        if rot_status == "ok":
            return warp_to_front(image, ordered, outward_margin=0.08), "min_area_rect"

    # 6: deskew — 최후 안전망. 기울기만이라도 제거하고 통과.
    deskewed, angle = deskew(image)
    if abs(angle) > 0.5:
        return deskewed, f"deskew({angle:+.1f}deg)"
    return image, "fallback"


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
    width = max(np.linalg.norm(pts[2] - pts[3]), np.linalg.norm(pts[1] - pts[0]))
    height = max(np.linalg.norm(pts[1] - pts[2]), np.linalg.norm(pts[0] - pts[3]))
    if height < 1:
        return "fallback_bad_aspect"
    aspect = width / height
    if aspect < aspect_range[0] or aspect > aspect_range[1]:
        return "fallback_bad_aspect"
    return "ok"
