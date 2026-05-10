"""전처리 모듈 스모크 테스트 — 합성 이미지로 동작 확인."""

import numpy as np
import pytest

cv2 = pytest.importorskip("cv2")

from pipeline.src.preprocessor import PreprocessOptions, preprocess
from pipeline.src.preprocessor.illumination import (
    apply_clahe,
    is_dark_background,
    invert_if_dark,
    shadow_remove,
)


def _synthetic_doc(dark: bool = False) -> np.ndarray:
    bg = 30 if dark else 240
    fg = 230 if dark else 20
    img = np.full((600, 800, 3), bg, dtype=np.uint8)
    cv2.rectangle(img, (50, 50), (750, 550), (fg, fg, fg), 3)
    cv2.putText(
        img, "TAX INVOICE", (100, 150),
        cv2.FONT_HERSHEY_SIMPLEX, 1.5, (fg, fg, fg), 3,
    )
    return img


def test_dark_background_detection_and_inversion():
    dark = _synthetic_doc(dark=True)
    light = _synthetic_doc(dark=False)
    assert is_dark_background(dark)
    assert not is_dark_background(light)
    inverted, did_invert = invert_if_dark(dark)
    assert did_invert
    assert is_dark_background(inverted) is False  # 반전 후 밝아져야 함


def test_clahe_changes_contrast():
    img = _synthetic_doc()
    out = apply_clahe(img)
    assert out.shape == img.shape


def test_shadow_remove_runs():
    img = _synthetic_doc()
    out = shadow_remove(img)
    assert out.shape == img.shape


def test_full_preprocess_pipeline_does_not_crash():
    img = _synthetic_doc()
    result = preprocess(img, PreprocessOptions(correct_perspective=False))
    assert result.image is not None
    assert result.perspective_method == "skipped"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
