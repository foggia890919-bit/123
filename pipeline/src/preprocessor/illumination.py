"""조도/색온도/그림자/대비 보정.

CamScanner 가 하는 일을 OpenCV 만으로 구현:
  1. white_balance        — gray-world 가정으로 색조 정규화. 형광등 노란기·
                            모니터 푸른기를 한 입력 패턴으로 통일.
  2. adaptive_gamma       — 전체 평균 밝기에 따라 감마를 자동 조정. 어두운 사진은
                            밝히고, 밝은 사진은 그대로 두어 흰 종이를 흰색으로.
  3. dual_shadow_remove   — 모폴로지 광맵 추정을 큰 커널/작은 커널 두 단계로
                            걸어, 종이가 한쪽으로 구부러져 그림자 그라데이션이
                            큰 케이스에서도 글자가 묻히지 않게 한다.
  4. apply_clahe          — 국소 명암 대비 (기존)
  5. invert_if_dark       — 어두운 배경 자동 색반전 (기존)
  6. denoise_monitor      — 모니터 사진 전용: NL-means 로 모아레/스캔라인 줄이고,
                            너무 밝은 반사 spot 은 인페인트로 메움.
"""

from __future__ import annotations

import cv2
import numpy as np


def white_balance(image: np.ndarray) -> np.ndarray:
    """Gray-world 가정 — 각 채널 평균을 전체 평균에 맞춰 색조를 중성으로.

    형광등 아래 종이는 노란기, 모니터 사진은 푸른기/녹색기. OCR/VLM 둘 다 색조에
    민감하진 않지만, 흰 배경 임계값(>220 등)을 쓰는 후단 보정 단계들이 색조가
    들어간 이미지에서 흔들린다. 여기서 한 번에 정리.
    """
    if image.ndim != 3:
        return image
    result = image.astype(np.float32)
    avg_b, avg_g, avg_r = (result[..., i].mean() for i in range(3))
    avg = (avg_b + avg_g + avg_r) / 3.0
    if avg < 1.0:
        return image
    for i, ch_avg in enumerate((avg_b, avg_g, avg_r)):
        if ch_avg < 1.0:
            continue
        result[..., i] *= avg / ch_avg
    return np.clip(result, 0, 255).astype(np.uint8)


def adaptive_gamma(image: np.ndarray) -> np.ndarray:
    """평균 밝기 기준 자동 감마 — 너무 어두운 사진에만 약하게 발동.

    target_mean = 170 (종이 흰색이 절반 이상 차지하는 자연스러운 평균).
    현재 mean 이 그보다 어두우면 감마 < 1 로 밝게. 변동 폭은 ±15% 안으로 제한.
    이미 target 보다 밝으면(=종이 흰 배경이 많은 사진) 손대지 않음 — 대비 손상 방지.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    mean = float(gray.mean())
    if mean < 1.0:
        return image
    target = 170.0
    if mean >= target:
        return image  # 이미 충분히 밝음 — 손대면 흰 배경이 끓어 대비 손상
    gamma = np.log(target / 255.0) / np.log(max(mean, 1.0) / 255.0)
    gamma = float(np.clip(gamma, 0.7, 1.0))
    if abs(gamma - 1.0) < 0.05:
        return image
    inv = 1.0 / gamma
    table = np.array([((i / 255.0) ** inv) * 255 for i in range(256)]).astype(np.uint8)
    return cv2.LUT(image, table)


def shadow_remove(image: np.ndarray) -> np.ndarray:
    """이중 광맵 추정으로 그림자/얼룩 제거.

    1차: 큰 커널(31x31 dilate + 51 median) — 종이 전체 그라데이션 잡음.
    2차: 작은 커널(7x7 dilate + 21 median) — 국소 얼룩.
    두 광맵의 평균을 배경으로 보고 빼내면 단일 커널보다 그림자 그라데이션 큰
    케이스에서 글자가 덜 묻힌다.
    """
    if image.ndim == 2:
        channels = [image]
    else:
        channels = list(cv2.split(image))

    out = []
    for ch in channels:
        bg_large = cv2.medianBlur(
            cv2.dilate(ch, np.ones((31, 31), np.uint8)),
            51,
        )
        bg_small = cv2.medianBlur(
            cv2.dilate(ch, np.ones((7, 7), np.uint8)),
            21,
        )
        bg = cv2.addWeighted(bg_large, 0.5, bg_small, 0.5, 0)
        diff = 255 - cv2.absdiff(ch, bg)
        norm = cv2.normalize(diff, None, 0, 255, cv2.NORM_MINMAX, dtype=cv2.CV_8U)
        out.append(norm)
    return out[0] if len(out) == 1 else cv2.merge(out)


def apply_clahe(image: np.ndarray, clip_limit: float = 3.0, tile: int = 8) -> np.ndarray:
    """LAB 공간의 L 채널에 CLAHE — 색조 보존, 명암만 끌어올림."""
    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(tile, tile))
    if image.ndim == 2:
        return clahe.apply(image)
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    l = clahe.apply(l)
    return cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)


def is_dark_background(image: np.ndarray, threshold: int = 110) -> bool:
    """이미지 평균 밝기로 어두운 배경 양식인지 추정."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    return float(gray.mean()) < threshold


def invert_if_dark(image: np.ndarray) -> tuple[np.ndarray, bool]:
    """어두운 배경 + 밝은 글자면 색을 반전시켜 OCR 친화 형태로."""
    if is_dark_background(image):
        return cv2.bitwise_not(image), True
    return image, False


def binarize(image: np.ndarray) -> np.ndarray:
    """Adaptive Threshold 이진화."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    return cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 15
    )


def boost_table_grid(image: np.ndarray) -> np.ndarray:
    """표 격자 강화 (옵션)."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    inv = cv2.bitwise_not(
        cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, 15, -2
        )
    )
    horizontal = inv.copy()
    vertical = inv.copy()
    h_size = max(10, horizontal.shape[1] // 30)
    v_size = max(10, vertical.shape[0] // 30)
    h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (h_size, 1))
    v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, v_size))
    horizontal = cv2.morphologyEx(horizontal, cv2.MORPH_OPEN, h_kernel)
    vertical = cv2.morphologyEx(vertical, cv2.MORPH_OPEN, v_kernel)
    grid = cv2.add(horizontal, vertical)
    boosted = gray.copy()
    boosted[grid > 0] = 0
    return boosted


def denoise_monitor(image: np.ndarray, strength: int = 5) -> np.ndarray:
    """카메라 사진(종이/모니터) 공통 — NL-means + 반사 spot 인페인트.

    핸드폰으로 화면이나 종이를 찍으면 (1) 모니터 픽셀 격자가 모아레 패턴을 만들고
    (2) 형광등·창문이 흰 반사 spot 으로 박힘. 둘 다 OCR/VLM 에서 글자로 오인되어
    환각 트리거가 된다. 종이 사진에도 약한 광택 반사가 생기는 케이스가 흔해,
    monitor vs paper 결정적 구분 신호가 부족한 5장 샘플 기준으론 사진 전체에
    약하게(h=5) 일괄 적용하는 게 가장 안정적이다.

    1. fastNlMeansDenoisingColored — 고주파 노이즈/모아레 제거. h=5 는 약한 편이라
       종이 사진에서도 글자 윤곽 보존. 모니터 사진은 NL-means 후 추가 CLAHE 가
       글자 대비를 다시 살린다.
    2. 너무 밝은(>=245) 작은 spot 을 마스킹하고 인페인트 — 반사 spot 만 메움.
       큰 흰 영역(종이 흰 배경)은 건들지 않도록 면적 0.5% 미만만 처리.
    """
    if image.ndim != 3:
        return image
    denoised = cv2.fastNlMeansDenoisingColored(image, None, h=strength, hColor=strength,
                                               templateWindowSize=7, searchWindowSize=21)
    gray = cv2.cvtColor(denoised, cv2.COLOR_BGR2GRAY)
    # 반사 spot — 매우 밝은(>=245) + 작은 영역(<0.5%)만. 큰 흰 배경(종이 흰색)
    # 은 건들지 않음.
    _, hot = cv2.threshold(gray, 245, 255, cv2.THRESH_BINARY)
    if hot.sum() == 0:
        return denoised
    # 작은 영역만 남기기 — 컨투어로 면적 0.5% 미만만 마스킹
    contours, _ = cv2.findContours(hot, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    img_area = gray.shape[0] * gray.shape[1]
    mask = np.zeros_like(hot)
    for c in contours:
        if cv2.contourArea(c) < img_area * 0.005:
            cv2.drawContours(mask, [c], -1, 255, -1)
    if mask.sum() == 0:
        return denoised
    # 반사 spot 주변 좀 더 넓게 — 가장자리도 메우기
    mask = cv2.dilate(mask, np.ones((5, 5), np.uint8))
    return cv2.inpaint(denoised, mask, 3, cv2.INPAINT_TELEA)
