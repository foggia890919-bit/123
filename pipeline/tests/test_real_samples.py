"""실제 샘플 이미지 기반 회귀 테스트.

샘플은 .gitignore되어 git에는 올라가지 않으므로 로컬에 없으면 스킵한다.
새 코드가 합성 이미지에서는 통과하지만 실제 사진에서 깨지는 회귀를 잡기 위함.
"""

from pathlib import Path

import pytest

cv2 = pytest.importorskip("cv2")

from pipeline.src.preprocessor import (
    PreprocessOptions,
    auto_orient,
    detect_source_kind,
    estimate_rotation_degrees,
    parse_footer_text,
    preprocess,
)

SAMPLES = Path(__file__).parent.parent / "samples"

PAPER_ROTATED = SAMPLES / "01_paper_rotated.jpg"
SCREENSHOT_CLEAN = SAMPLES / "02_screenshot_clean.jpg"
MONITOR_PHOTO = SAMPLES / "03_monitor_photo.jpg"
PAPER_WATERMARK = SAMPLES / "04_paper_watermark.jpg"
MONITOR_SKEWED = SAMPLES / "05_monitor_skewed.jpg"

ALL_SAMPLES = [
    PAPER_ROTATED, SCREENSHOT_CLEAN, MONITOR_PHOTO,
    PAPER_WATERMARK, MONITOR_SKEWED,
]


def _need(path: Path):
    if not path.exists():
        pytest.skip(f"샘플 없음 (.gitignore): {path.name}")


@pytest.mark.parametrize("path", ALL_SAMPLES, ids=lambda p: p.name)
def test_preprocess_runs_without_crash(path):
    """5장 모두 preprocess 파이프라인이 끝까지 도는지 (회귀 가드)."""
    _need(path)
    img = cv2.imread(str(path))
    assert img is not None
    result = preprocess(img, PreprocessOptions())
    assert result.image is not None
    assert result.image.size > 0


def test_paper_rotated_is_detected_as_rotated():
    """01번은 90도 누운 종이라서 회전 보정이 들어가야 한다."""
    _need(PAPER_ROTATED)
    img = cv2.imread(str(PAPER_ROTATED))
    deg = estimate_rotation_degrees(img)
    assert deg == 90, f"01번은 90도여야 하는데 {deg}로 감지됨"
    rotated, applied = auto_orient(img)
    assert applied == 90
    assert rotated.shape[:2] == (img.shape[1], img.shape[0])  # 폭/높이 swap


def test_screenshot_is_detected_and_skips_perspective():
    """02번은 순수 스크린샷이므로 perspective가 OFF로 토글되어야 한다."""
    _need(SCREENSHOT_CLEAN)
    img = cv2.imread(str(SCREENSHOT_CLEAN))
    kind = detect_source_kind(img)
    assert kind.is_screenshot, f"02번은 스크린샷으로 감지되어야 함: {kind}"

    result = preprocess(img, PreprocessOptions())
    assert result.source_kind is not None
    assert result.source_kind.is_screenshot
    assert result.perspective_method == "skipped"


def test_paper_photos_are_not_classified_as_screenshot():
    """01/04번은 종이 사진이므로 스크린샷으로 잘못 분류되면 안 된다."""
    for path in (PAPER_ROTATED, PAPER_WATERMARK):
        _need(path)
        img = cv2.imread(str(path))
        # 회전된 사진은 회전부터 보정해야 비율이 정상
        oriented, _ = auto_orient(img)
        kind = detect_source_kind(oriented)
        assert not kind.is_screenshot, (
            f"{path.name}는 종이 사진인데 스크린샷으로 분류됨: {kind}"
        )


def test_footer_parser_recognizes_all_known_formats():
    """5가지 푸터 텍스트가 모두 정규식으로 파싱되는지."""
    cases = [
        (
            "2026-04/신목제일의원(113-96-03529)//정우신약",
            {"period": "2026-04", "hospital": "신목제일의원",
             "biz_no": "113-96-03529", "doctor": None, "pharma": "정우신약"},
        ),
        (
            "2026-04/일산365의원(687-90-02484)/이재영/위더스제약",
            {"period": "2026-04", "hospital": "일산365의원",
             "biz_no": "687-90-02484", "doctor": "이재영", "pharma": "위더스제약"},
        ),
        (
            "2026-04/배재천신경과의원(221-90-46977)//경보제약",
            {"period": "2026-04", "hospital": "배재천신경과의원",
             "biz_no": "221-90-46977", "doctor": None, "pharma": "경보제약"},
        ),
        (
            "2026-04/강동천호정형외과(384-98-00322)/원종원/영진약품",
            {"period": "2026-04", "hospital": "강동천호정형외과",
             "biz_no": "384-98-00322", "doctor": "원종원", "pharma": "영진약품"},
        ),
    ]
    for text, expected in cases:
        meta = parse_footer_text(text)
        assert meta is not None, f"파싱 실패: {text!r}"
        assert meta.period == expected["period"]
        assert meta.hospital == expected["hospital"]
        assert meta.biz_no == expected["biz_no"]
        assert meta.doctor == expected["doctor"]
        assert meta.pharma == expected["pharma"]


def test_footer_parser_handles_noise_around():
    """본문 텍스트가 위에 잔뜩 있어도 마지막 푸터만 골라야 한다."""
    text = (
        "위더스세프라디딘캡슐500mg 2 205 30 6,150\n"
        "총금액: 578,686\n"
        "2026-04/일산365의원(687-90-02484)/이재영/위더스제약"
    )
    meta = parse_footer_text(text)
    assert meta is not None
    assert meta.hospital == "일산365의원"


def test_footer_parser_returns_none_for_no_footer():
    assert parse_footer_text("이 텍스트에는 푸터가 없습니다") is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
