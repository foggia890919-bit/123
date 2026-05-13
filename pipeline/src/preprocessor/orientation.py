"""이미지 회전 자동 보정 (0/90/180/270).

OCR/VLM은 글자가 가로로 누워 있거나 거꾸로 들어오면 인식률이 급락한다.
이전 구현은 가로/세로 직선 카운트 휴리스틱으로 0/90 만 잡았는데, 표 양식이
가로·세로 선이 비슷할 때 오판했고 180도 거꾸로 들어오는 케이스를 못 잡았다.

여기선 4 각도(0/90/180/270) 모두 시도해서 "글자가 가로로 늘어선 모습"에
가장 가까운 회전을 점수로 고른다. 점수는 두 신호의 합:

  S_lines  : 글자 픽셀의 가로줄 합 시퀀스의 분산. 가로 쓰기는 글자가 행에
             모이고 행 사이 공백이 있어서 줄 합이 들쭉날쭉(분산↑). 90/270은
             열 방향에 같은 패턴이 생겨 가로줄 분산이 평탄(분산↓).
  S_top    : 다크 픽셀의 수직 무게중심. 한국어 문서는 보통 헤더가 위쪽에
             모이고 표 본문은 아래로 길게 — 무게중심이 중앙보다 약간 아래.
             0 과 180을 가르는 유일한 신호.

휴리스틱은 100% 가 아니다 — 점수 차이가 작으면 위쪽-아래쪽 비대칭 신호를
가중치로 더 본다. 그래도 애매하면 0 을 반환(원본 유지)해서 후단 VLM 에 맡긴다.
"""

from __future__ import annotations

import cv2
import numpy as np


def _text_mask(gray: np.ndarray) -> np.ndarray:
    """글자 픽셀을 대략적으로 마스크 — Otsu 이진화 후 어두운 쪽."""
    # 큰 이미지는 다운샘플 — 점수 안정·속도. 1000px 정도면 충분.
    h, w = gray.shape
    scale = 1000.0 / max(h, w)
    if scale < 1.0:
        gray = cv2.resize(gray, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    _, binary = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return binary


def _line_score(mask: np.ndarray) -> float:
    """행 합 시퀀스의 분산 — 가로쓰기일수록 크다.

    빈 행과 글자 행이 번갈아 나타나면 행 합이 0↔높음 으로 진동, 분산이 커진다.
    가로 직선이 일정한 90도 회전 상태에선 행 합이 평탄해 분산이 작다.
    """
    row_sums = mask.sum(axis=1).astype(np.float32)
    # 평균으로 나눠 스케일 독립 — 이미지 크기·글자 굵기에 둔감.
    mean = row_sums.mean()
    if mean < 1.0:
        return 0.0
    return float(row_sums.std() / mean)


def _top_heavy_score(mask: np.ndarray) -> float:
    """위쪽 1/3 의 다크 픽셀 비율 vs 아래쪽 1/3. 양수면 위쪽이 더 무거움.

    한국어 표 양식은 헤더가 위쪽 → 0 도(정상) 에서 양수, 180 도(뒤집힘)에서 음수.
    표가 화면 가득 차는 케이스에선 거의 0 에 가까워 약한 신호.
    """
    h = mask.shape[0]
    top = float(mask[: h // 3].sum())
    bot = float(mask[-h // 3 :].sum())
    total = top + bot
    if total < 1.0:
        return 0.0
    return (top - bot) / total


def _rotate(image: np.ndarray, degrees: int) -> np.ndarray:
    if degrees == 0:
        return image
    if degrees == 90:
        return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    if degrees == 180:
        return cv2.rotate(image, cv2.ROTATE_180)
    if degrees == 270:
        return cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
    raise ValueError(f"무손실 회전은 0/90/180/270만 지원: {degrees}")


def estimate_rotation_degrees(image: np.ndarray) -> int:
    """0/90/180/270 중 하나를 반환. 시계방향으로 그만큼 돌리면 가로쓰기 정상.

    네 각도 모두 시도해 점수가 가장 높은 걸 선택. 1·2위 점수 차가 너무 작으면
    (애매) 0 을 반환해 원본 유지.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    mask = _text_mask(gray)

    candidates: list[tuple[int, float, float]] = []  # (deg, line_score, top_score)
    for deg in (0, 90, 180, 270):
        rotated = _rotate(mask, deg)
        candidates.append((deg, _line_score(rotated), _top_heavy_score(rotated)))

    # 1단계: line_score 로 0/180 후보군 vs 90/270 후보군 분리.
    # 가로쓰기 후보(0 또는 180)는 line_score 가 높음.
    by_line = sorted(candidates, key=lambda c: c[1], reverse=True)
    best, second = by_line[0], by_line[1]
    # line_score 1·2위가 비슷(<5% 차이)하면 회전 신호가 약하다는 뜻 — 안 돌림.
    if best[1] < 0.05 or (best[1] - second[1]) / max(best[1], 1e-6) < 0.05:
        return 0

    # 2단계: 가로쓰기 후보 페어({0,180} 또는 {90,270}) 중에서 top_heavy 양수 쪽 선택.
    # best 의 페어 = best 와 180 도 차이 나는 후보.
    pair_deg = (best[0] + 180) % 360
    pair = next(c for c in candidates if c[0] == pair_deg)
    # 둘의 top_heavy 비교. 더 큰(=헤더가 위에 있는) 쪽이 정답.
    chosen = best if best[2] >= pair[2] else pair
    return chosen[0]


def rotate_clockwise(image: np.ndarray, degrees: int) -> np.ndarray:
    """OpenCV의 무손실 90도 회전만 사용 (warpAffine 보간 없음)."""
    return _rotate(image, degrees)


def auto_orient(image: np.ndarray) -> tuple[np.ndarray, int]:
    """추정된 각도로 자동 회전. (회전된 이미지, 적용한 각도) 반환."""
    deg = estimate_rotation_degrees(image)
    return rotate_clockwise(image, deg), deg
