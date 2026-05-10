"""스크린샷인지 카메라 사진인지 추정.

실제 5장 샘플을 측정한 결과, 두 신호의 AND가 결정적이다:

  | sample            | bright% | bright_std |
  |-------------------|---------|------------|
  | 02 screenshot     | 90.3%   |  7.19   ← 둘 다 극단
  | 01 paper photo    |  5.6%   | 11.86
  | 03 monitor photo  |  7.6%   | 13.13
  | 04 paper photo    |  6.7%   | 12.60
  | 05 monitor photo  |  5.8%   | 11.57

스크린샷은 (1) UI 흰 배경이 이미지 대부분을 차지하고 (2) 그 흰 영역이 진짜로
평탄하다. 사진은 어떤 모드든 (종이/모니터, 어떤 각도든) 이미지에서 종이·모니터
영역이 절반 이하를 차지하고, 흰 영역도 빛 변화로 변동이 크다.

판정: bright_pct >= 50% AND bright_std < 9 → 스크린샷. 둘 중 하나라도 미충족이면
사진으로 본다 (보수적 — perspective 잘못 켜는 것보다 잘못 끄는 게 더 큰 사고).
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class SourceKindResult:
    is_screenshot: bool
    score: float          # 0.0(완전 사진) ~ 1.0(완전 스크린샷)
    reasons: list[str]


def _bright_stats(gray: np.ndarray) -> tuple[float, float]:
    """밝은(>=220) 픽셀의 비율과 그 영역의 표준편차."""
    mask = gray > 220
    bright_pct = float(mask.sum() / gray.size)
    if mask.sum() < 100:
        return bright_pct, 999.0
    return bright_pct, float(gray[mask].std())


def detect_source_kind(image: np.ndarray) -> SourceKindResult:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    bright_pct, bright_std = _bright_stats(gray)
    reasons: list[str] = [
        f"bright_pct={bright_pct * 100:.1f}%",
        f"bright_std={bright_std:.2f}",
    ]
    is_screenshot = bright_pct >= 0.50 and bright_std < 9.0
    score = 0.0
    if bright_pct >= 0.50:
        score += 0.5
    if bright_std < 9.0:
        score += 0.5
    return SourceKindResult(
        is_screenshot=is_screenshot,
        score=round(score, 3),
        reasons=reasons,
    )
