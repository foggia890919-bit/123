"""전처리 단계를 묶는 오케스트레이터 — CamScanner-style normalization.

처리 순서:
  1. auto_orient          — 0/90/180/270 자동 회전
  2. detect_source_kind   — paper_photo / monitor_photo / screenshot 분기
  3. white_balance        — gray-world 색조 정규화
  4. correct_perspective  — Hough → Contour → GrabCut → (VLM) → minAreaRect → deskew
                            (스크린샷에선 끔)
  5. denoise_monitor      — 모니터 사진일 때만: NL-means + 반사 spot 인페인트
  6. shadow_remove        — 이중 광맵 그림자 제거 (스크린샷에선 끔)
  7. adaptive_gamma       — 평균 밝기 기준 자동 감마
  8. invert_if_dark       — 어두운 배경 자동 색반전
  9. apply_clahe          — 국소 명암 대비
 10. boost_table_grid     — (옵션) 표 격자 강화
 11. trim_white_margins + resize_to_width — 최종 규격화 (가장자리 trim + 고정 폭)

"원본 raw 가 후단으로 그대로 통과되는 일은 없다" 가 핵심 — 어떤 입력이 들어와도
최소한 회전·deskew·광맵 정규화·고정 폭으로 통일된다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from .debug import DebugRecorder
from .illumination import (
    adaptive_gamma,
    apply_clahe,
    boost_table_grid,
    denoise_monitor,
    invert_if_dark,
    shadow_remove,
    white_balance,
)
from .normalize import resize_to_width, trim_white_margins
from .orientation import auto_orient
from .perspective import correct_perspective
from .source_kind import SourceKindResult, detect_source_kind


@dataclass
class PreprocessOptions:
    auto_orient: bool = True
    detect_source: bool = True       # 스크린샷이면 perspective/shadow_remove 자동 OFF
    white_balance: bool = True
    correct_perspective: bool = True
    denoise_monitor: bool = True     # 모니터 사진일 때만 자동 발동
    remove_shadow: bool = True
    adaptive_gamma: bool = True
    apply_clahe: bool = True
    invert_dark_background: bool = True
    boost_table: bool = False        # 표 양식에서만 켠다
    normalize_output: bool = True    # 가장자리 trim + 고정 폭
    target_width: int = 1600         # 최종 출력 폭
    vlm_adapter: object | None = None  # 주어지면 OpenCV 실패 시 AI-Assisted Cropping 폴백
    debug_dir: Path | str | None = None


@dataclass
class PreprocessResult:
    image: np.ndarray
    perspective_method: str
    inverted: bool
    rotation_applied: int            # 0/90/180/270
    source_kind: SourceKindResult | None
    debug_dir: Path | None
    notes: list[str] = field(default_factory=list)


def preprocess(image: np.ndarray, options: PreprocessOptions | None = None) -> PreprocessResult:
    opts = options or PreprocessOptions()
    debug = DebugRecorder(opts.debug_dir)
    debug.save("00_input", image)

    notes: list[str] = []
    perspective_method = "skipped"
    rotation_applied = 0
    source_kind: SourceKindResult | None = None

    work = image

    # 1. 회전 자동 보정 (0/90/180/270)
    if opts.auto_orient:
        work, rotation_applied = auto_orient(work)
        if rotation_applied != 0:
            notes.append(f"orientation: {rotation_applied}도 자동 회전")
            debug.save(f"01_oriented_{rotation_applied}deg", work)

    # 2. 캡쳐 종류 판별 → 보정 토글
    do_perspective = opts.correct_perspective
    do_shadow = opts.remove_shadow
    # NL-means denoise + 반사 spot 인페인트: 스크린샷이 아닌 모든 카메라 사진에
    # 일괄 약하게(h=5) 적용. monitor 사진과 paper 사진을 결정적으로 구분할 신호
    # 가 부족(샘플 5장에서 edge_darkness 가 둘 다 100+) → 분기 대신 일관성 우선.
    do_denoise_monitor = False
    if opts.detect_source:
        source_kind = detect_source_kind(work)
        if source_kind.is_screenshot:
            do_perspective = False
            do_shadow = False
            notes.append(
                f"source: 스크린샷 감지 (score={source_kind.score}) "
                "→ perspective/shadow/denoise 비활성"
            )
        else:
            do_denoise_monitor = opts.denoise_monitor
            label = "모니터 사진" if source_kind.is_monitor_photo else "종이 사진"
            notes.append(
                f"source: {label} ({', '.join(source_kind.reasons)}) "
                "→ 약한 NL-means denoise + 반사 spot 인페인트"
            )

    # 3. white balance — 색조 통일. 스크린샷이면 의미 없으니 끔.
    if opts.white_balance and (source_kind is None or not source_kind.is_screenshot):
        work = white_balance(work)
        debug.save("02_white_balance", work)

    # 4. 원근 보정 (Hough → Contour → GrabCut → VLM → minAreaRect → deskew)
    if do_perspective:
        work, perspective_method = correct_perspective(work, vlm_adapter=opts.vlm_adapter)
        debug.save(f"03_perspective_{perspective_method}", work)
        notes.append(f"perspective: {perspective_method}")

    # 5. 모니터 사진 denoise + 반사 spot 인페인트 (perspective 이후에 — 워프된 결과에 적용)
    if do_denoise_monitor:
        work = denoise_monitor(work)
        debug.save("04_denoise_monitor", work)

    # 6. 그림자 제거 (이중 광맵)
    if do_shadow:
        work = shadow_remove(work)
        debug.save("05_shadow_removed", work)

    # 7. 적응형 감마 — 너무 어두운 사진을 자동으로 밝히기
    if opts.adaptive_gamma:
        work = adaptive_gamma(work)
        debug.save("06_gamma", work)

    # 8. 어두운 배경 색반전
    inverted = False
    if opts.invert_dark_background:
        work, inverted = invert_if_dark(work)
        if inverted:
            notes.append("invert: 어두운 배경 감지 → 색 반전")
            debug.save("07_inverted", work)

    # 9. CLAHE
    if opts.apply_clahe:
        work = apply_clahe(work)
        debug.save("08_clahe", work)

    # 10. 표 격자 강화 (옵션)
    if opts.boost_table:
        work = boost_table_grid(work)
        debug.save("09_table_grid", work)

    # 11. 최종 규격화 — 가장자리 trim + 고정 폭
    if opts.normalize_output:
        before_h, before_w = work.shape[:2]
        work = trim_white_margins(work)
        work = resize_to_width(work, opts.target_width)
        after_h, after_w = work.shape[:2]
        notes.append(
            f"normalize: {before_w}x{before_h} → {after_w}x{after_h}"
        )
        debug.save("10_normalized", work)

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
