"""전처리 단계를 묶는 오케스트레이터.

옵션을 외부에서 토글할 수 있게 PreprocessOptions로 노출한다. 어떤 보정이
필요한지는 양식별로 다르므로 호출자가 켜고 끈다.
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
from .perspective import correct_perspective


@dataclass
class PreprocessOptions:
    correct_perspective: bool = True
    remove_shadow: bool = True
    apply_clahe: bool = True
    invert_dark_background: bool = True
    boost_table: bool = False  # 표 양식에서만 켠다
    debug_dir: Path | str | None = None


@dataclass
class PreprocessResult:
    image: np.ndarray  # VLM에 보낼 보정 완료 이미지
    perspective_method: str
    inverted: bool
    debug_dir: Path | None
    notes: list[str] = field(default_factory=list)


def preprocess(image: np.ndarray, options: PreprocessOptions | None = None) -> PreprocessResult:
    opts = options or PreprocessOptions()
    debug = DebugRecorder(opts.debug_dir)
    debug.save("input", image)

    notes: list[str] = []
    perspective_method = "skipped"

    work = image
    if opts.correct_perspective:
        work, perspective_method = correct_perspective(work)
        debug.save(f"perspective_{perspective_method}", work)
        if perspective_method == "fallback":
            notes.append("perspective: 모서리 검출 실패 → 원본 사용")

    if opts.remove_shadow:
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
        debug_dir=Path(opts.debug_dir) if opts.debug_dir else None,
        notes=notes,
    )


def load_image(path: Path | str) -> np.ndarray:
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        raise FileNotFoundError(f"이미지를 읽을 수 없습니다: {path}")
    return img
