"""Gemini VLM 어댑터.

google-genai 라이브러리는 import 시점에 API 키가 없어도 죽지 않는다.
실제 generate_json 호출 시점에만 키를 확인한다.
"""

from __future__ import annotations

import io
import json
import os
from typing import Any

import cv2
import numpy as np
from PIL import Image

from .base import VLMAdapter, VLMResponse


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

        response = client.models.generate_content(
            model=self.model,
            contents=[
                types.Part.from_bytes(data=buf.getvalue(), mime_type="image/png"),
                instruction,
            ],
            config=config,
        )
        text = response.text or "{}"
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            data = {"_raw": text, "_parse_error": True}
        return VLMResponse(data=data, raw_text=text, model=self.model)
