"""캡쳐 종류 추정 — paper_photo / monitor_photo / screenshot.

세 종류를 구분해 후단 보정을 차별화한다:
  - paper_photo  : 종이를 카메라로 찍음 → perspective + shadow + 일반 보정
  - monitor_photo: 모니터 화면을 카메라로 찍음 → perspective + denoise + 반사 제거
  - screenshot   : OS 캡처 → perspective/shadow 끔, 보정 최소

판정 신호 두 개:
  bright_pct   : 밝은(>220) 픽셀 비율
  bright_std   : 그 밝은 영역의 명도 표준편차 (스크린샷일수록 평탄)

실측 (5장 베이스라인):
  | sample            | bright% | bright_std |
  |-------------------|---------|------------|
  | 02 screenshot     | 90.3%   |  7.19   ← 둘 다 극단
  | 01 paper photo    |  5.6%   | 11.86
  | 03 monitor photo  |  7.6%   | 13.13
  | 04 paper photo    |  6.7%   | 12.60
  | 05 monitor photo  |  5.8%   | 11.57

스크린샷: bright_pct >= 50% AND bright_std < 9.
모니터 사진 vs 종이 사진은 단일 신호로는 잘 안 갈림 — bright_std 가 11~13 으로
다 비슷. 대신 채널별 분산을 본다: 모니터 사진은 RGB 채널이 거의 같은 값 (회색조
+ 푸른기), 종이 사진은 R 채널이 살짝 다름 (백색·노란기). 그리고 채도(saturation)
평균이 낮으면 monitor_photo 후보.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class SourceKindResult:
    is_screenshot: bool
    is_monitor_photo: bool
    score: float          # 0.0(완전 사진) ~ 1.0(완전 스크린샷)
    reasons: list[str]


def _bright_stats(gray: np.ndarray) -> tuple[float, float]:
    """밝은(>=220) 픽셀의 비율과 그 영역의 표준편차."""
    mask = gray > 220
    bright_pct = float(mask.sum() / gray.size)
    if mask.sum() < 100:
        return bright_pct, 999.0
    return bright_pct, float(gray[mask].std())


def _saturation_mean(image: np.ndarray) -> float:
    """HSV S 채널 평균. 모니터 사진은 화면 자체가 회색조라 채도가 낮음."""
    if image.ndim != 3:
        return 0.0
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    return float(hsv[..., 1].mean())


def _edge_darkness(gray: np.ndarray, border_pct: float = 0.05) -> float:
    """가장자리(상하좌우 border_pct 테두리)의 평균 밝기.

    모니터 사진은 검은 베젤이 둘레에 → 매우 어두움(<70).
    종이 사진은 책상/손/배경이 어떤 색이든 들어가 평균이 100+ 인 경우가 흔함.
    종이만 가득 찬 사진은 종이 흰색이라 200+. 베젤 신호가 가장 결정적.
    """
    h, w = gray.shape
    b = max(1, int(min(h, w) * border_pct))
    top = gray[:b].mean()
    bot = gray[-b:].mean()
    left = gray[:, :b].mean()
    right = gray[:, -b:].mean()
    return float((top + bot + left + right) / 4.0)


def detect_source_kind(image: np.ndarray) -> SourceKindResult:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    bright_pct, bright_std = _bright_stats(gray)
    sat = _saturation_mean(image)
    edge_dark = _edge_darkness(gray)
    reasons: list[str] = [
        f"bright_pct={bright_pct * 100:.1f}%",
        f"bright_std={bright_std:.2f}",
        f"saturation={sat:.1f}",
        f"edge_darkness={edge_dark:.1f}",
    ]

    is_screenshot = bright_pct >= 0.50 and bright_std < 9.0
    # 모니터 사진 결정 신호: (1) 스크린샷 아님 AND (2) 가장자리가 어둡다(<70)
    # → 검은 베젤이 둘레에 있다는 의미. 채도는 보조 신호로만 (낮으면 더 확신).
    is_monitor_photo = (not is_screenshot) and edge_dark < 70.0

    score = 0.0
    if bright_pct >= 0.50:
        score += 0.5
    if bright_std < 9.0:
        score += 0.5
    return SourceKindResult(
        is_screenshot=is_screenshot,
        is_monitor_photo=is_monitor_photo,
        score=round(score, 3),
        reasons=reasons,
    )
