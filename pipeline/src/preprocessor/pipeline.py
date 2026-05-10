"""전처리 단계를 묶는 오케스트레이터.

처리 순서:
  1. auto_orient        — 90/270도 누운 사진을 가로쓰기 상태로 회전
  2. detect_source_kind — 스크린샷이면 perspective 보정 끔
  3. correct_perspective — 사진이면 모서리 검출 후 정면 워프
  4. shadow_remove      — 그림자/얼룩 제거
  5. invert_if_dark     — 어두운 배경 자동 색반전
  6. apply_clahe        — 명암 정규화
  7. boost_table_grid   — (옵션) 표 격자 강화

옵션을 외부에서 토글할 수 있게 PreprocessOptions로 노출. 어떤 보정이 필요한지는
양식과 캡쳐 모드에 따라 다르므로 호출자가 켜고 끈다. auto_*는 source_kind 결과를
보고 런타임에 결정한다 (호출자가 명시적으로 끄지 않는 한).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from .debug import DebugRecorder
from .illumination import (
    apply_clahe,
    boost_table_grid,
    invert_if_dark,
    shadow_remove,
)
from .orientation import auto_orient
from .perspective import correct_perspective
from .source_kind import SourceKindResult, detect_source_kind


@dataclass
class PreprocessOptions:
    auto_orient: bool = True
    detect_source: bool = True       # 스크린샷이면 perspective/shadow_remove 자동 OFF
    correct_perspective: bool = True
    remove_shadow: bool = True
    apply_clahe: bool = True
    invert_dark_background: bool = True
    boost_table: bool = False        # 표 양식에서만 켠다
    vlm_adapter: object | None = None  # 주어지면 OpenCV 실패 시 AI-Assisted Cropping 폴백
    debug_dir: Path | str | None = None


@dataclass
class PreprocessResult:
    image: np.ndarray
    perspective_method: str
    inverted: bool
    rotation_applied: int            # 0 또는 90
    source_kind: SourceKindResult | None
    debug_dir: Path | None
    notes: list[str] = field(default_factory=list)


def preprocess(image: np.ndarray, options: PreprocessOptions | None = None) -> PreprocessResult:
    opts = options or PreprocessOptions()
    debug = DebugRecorder(opts.debug_dir)
    debug.save("input", image)

    notes: list[str] = []
    perspective_method = "skipped"
    rotation_applied = 0
    source_kind: SourceKindResult | None = None

    work = image

    # 1. 회전 자동 보정
    if opts.auto_orient:
        work, rotation_applied = auto_orient(work)
        if rotation_applied != 0:
            notes.append(f"orientation: {rotation_applied}도 자동 회전")
            debug.save(f"oriented_{rotation_applied}deg", work)

    # 2. 스크린샷 판별 → 보정 토글
    do_perspective = opts.correct_perspective
    do_shadow = opts.remove_shadow
    if opts.detect_source:
        source_kind = detect_source_kind(work)
        if source_kind.is_screenshot:
            do_perspective = False
            do_shadow = False
            notes.append(
                f"source: 스크린샷 감지 (score={source_kind.score}) "
                "→ perspective/shadow 비활성"
            )

    # 3. 원근 보정 (OpenCV 실패 시 vlm_adapter 있으면 AI-Assisted Cropping으로 폴오버)
    if do_perspective:
        work, perspective_method = correct_perspective(work, vlm_adapter=opts.vlm_adapter)
        debug.save(f"perspective_{perspective_method}", work)
        if perspective_method.startswith("fallback"):
            notes.append(f"perspective: {perspective_method} → 원본 사용")
        elif perspective_method.startswith("vlm"):
            notes.append(f"perspective: AI-Assisted Cropping 적용 ({perspective_method})")

    # 4. 그림자 제거
    if do_shadow:
        work = shadow_remove(work)
        debug.save("shadow_removed", work)

    inverted = False
    if opts.invert_dark_background:
        work, inverted = invert_if_dark(work)
        if inverted:
            notes.append("invert: 어두운 배경 감지 → 색 반전")
            debug.save("inverted", work)

    if opts.apply_clahe:
        work = apply_clahe(work)
        debug.save("clahe", work)

    if opts.boost_table:
        work = boost_table_grid(work)
        debug.save("table_grid", work)

    return PreprocessResult(
        image=work,
        perspective_method=perspective_method,
        inverted=inverted,
        rotation_applied=rotation_applied,
        source_kind=source_kind,
        debug_dir=Path(opts.debug_dir) if opts.debug_dir else None,
        notes=notes,
    )


def load_image(path: Path | str) -> np.ndarray:
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        raise FileNotFoundError(f"이미지를 읽을 수 없습니다: {path}")
    return img
