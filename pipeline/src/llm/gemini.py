"""Gemini VLM 어댑터.

google-genai 라이브러리는 import 시점에 API 키가 없어도 죽지 않는다.
실제 generate_json 호출 시점에만 키를 확인한다.
"""

from __future__ import annotations

import io
import json
import os
import sys
import time
from typing import Any

import cv2
import numpy as np
from PIL import Image

from .base import VLMAdapter, VLMResponse


# 모듈 전역으로 마지막 호출 시각을 유지 — 같은 프로세스 안의 모든 GeminiAdapter
# 인스턴스가 공유한다. 샘플마다 어댑터를 새로 만들어도 분당 호출 한도가 깨지지 않게.
_LAST_CALL_T: float = 0.0


def _retryable(exc: Exception) -> bool:
    """Gemini 503(UNAVAILABLE) / 429(RESOURCE_EXHAUSTED) 만 재시도 대상."""
    s = str(exc)
    return ("503" in s and "UNAVAILABLE" in s) or ("429" in s and "RESOURCE_EXHAUSTED" in s)


class GeminiAdapter(VLMAdapter):
    def __init__(self, model: str | None = None) -> None:
        # 환경변수 GEMINI_MODEL 로 오버라이드 가능. 기본 Flash — 응답속도(<10s) 우선,
        # 35행짜리 표/긴 자가수정 루프에서 Pro 가 분당-수십초 단위로 응답해 전체
        # 파이프라인 타임아웃 나는 문제를 회피.
        self.model = (
            model
            or os.environ.get("GEMINI_MODEL")
            or "gemini-2.5-flash"
        )
        # 호출 간 최소 간격(초). Gemini Free Tier RPM 한도(분당 ~15콜) 보호용으로
        # 기본 2초 — 30콜/분 페이스. 키 티어 올렸으면 GEMINI_MIN_INTERVAL_S=0 으로 끄면 됨.
        self.min_interval_s: float = float(os.environ.get("GEMINI_MIN_INTERVAL_S", "2.0"))
        # 503/429 응답 시 백오프 재시도 횟수.
        self.max_retries: int = int(os.environ.get("GEMINI_MAX_RETRIES", "4"))

    def _throttle(self) -> None:
        global _LAST_CALL_T
        if self.min_interval_s <= 0:
            return
        wait = self.min_interval_s - (time.monotonic() - _LAST_CALL_T)
        if wait > 0:
            time.sleep(wait)
        _LAST_CALL_T = time.monotonic()

    def generate_json(
        self,
        image: np.ndarray,
        instruction: str,
        json_schema: dict[str, Any] | None = None,
    ) -> VLMResponse:
        api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GOOGLE_API_KEY 또는 GEMINI_API_KEY 환경변수가 필요합니다")

        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)

        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB) if image.ndim == 3 else image
        pil = Image.fromarray(rgb)
        buf = io.BytesIO()
        pil.save(buf, format="PNG")

        config: dict[str, Any] = {"response_mime_type": "application/json"}
        if json_schema is not None:
            config["response_schema"] = json_schema

        last_exc: Exception | None = None
        for attempt in range(self.max_retries + 1):
            self._throttle()
            try:
                response = client.models.generate_content(
                    model=self.model,
                    contents=[
                        types.Part.from_bytes(data=buf.getvalue(), mime_type="image/png"),
                        instruction,
                    ],
                    config=config,
                )
                break
            except Exception as e:  # google.genai.errors.ServerError 등
                last_exc = e
                if not _retryable(e) or attempt == self.max_retries:
                    raise
                # 지수 백오프: 2s, 4s, 8s, 16s. 분당 한도가 풀릴 시간을 벌어준다.
                delay = 2 ** (attempt + 1)
                print(
                    f"[gemini] {type(e).__name__} (attempt {attempt + 1}/"
                    f"{self.max_retries}) → {delay}s 후 재시도",
                    file=sys.stderr,
                )
                time.sleep(delay)
        else:  # pragma: no cover — for 루프가 break 없이 끝났다는 건 위에서 raise 됐어야 함
            raise last_exc or RuntimeError("Gemini 호출 실패")

        text = response.text or "{}"
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            data = {"_raw": text, "_parse_error": True}
        return VLMResponse(data=data, raw_text=text, model=self.model)
