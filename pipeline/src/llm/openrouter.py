"""OpenRouter VLM 어댑터 — OpenAI 호환 chat/completions 엔드포인트로 vision 호출.

OpenRouter 한 키로 Claude·Gemini·GPT 등 여러 vision 모델을 모두 부를 수 있다.
모델 선택은 OPENROUTER_MODEL 환경변수로 (예: 'anthropic/claude-opus-4-7',
'openai/gpt-5', 'google/gemini-2.5-pro'). 기본값은 'openai/gpt-4o' — Anthropic
계정 결제가 막힌 케이스를 가정한 안전한 디폴트.

JSON 응답은 response_format=json_object 로 강제하고, 파싱 실패 시
{_parse_error: True} 로 회수해 다른 어댑터들과 동일한 계약을 지킨다.
"""

from __future__ import annotations

import base64
import io
import json
import os
from typing import Any

import cv2
import httpx
import numpy as np
from PIL import Image

from .base import VLMAdapter, VLMResponse


_OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


class OpenRouterAdapter(VLMAdapter):
    def __init__(self, model: str | None = None) -> None:
        self.model = (
            model
            or os.environ.get("OPENROUTER_MODEL")
            or "openai/gpt-4o"
        )

    def generate_json(
        self,
        image: np.ndarray,
        instruction: str,
        json_schema: dict[str, Any] | None = None,
    ) -> VLMResponse:
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            raise RuntimeError("OPENROUTER_API_KEY 환경변수가 필요합니다")

        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB) if image.ndim == 3 else image
        pil = Image.fromarray(rgb)
        buf = io.BytesIO()
        pil.save(buf, format="PNG")
        b64 = base64.standard_b64encode(buf.getvalue()).decode("ascii")
        data_url = f"data:image/png;base64,{b64}"

        schema_hint = ""
        if json_schema is not None:
            schema_hint = (
                "\n\n출력 JSON은 다음 스키마를 따라야 한다:\n"
                + json.dumps(json_schema, ensure_ascii=False, indent=2)
            )

        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": data_url}},
                        {
                            "type": "text",
                            "text": (
                                instruction
                                + schema_hint
                                + "\n\n오직 JSON 객체만 출력하라. 코드펜스 금지."
                            ),
                        },
                    ],
                }
            ],
            "response_format": {"type": "json_object"},
        }

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            # OpenRouter 권장 식별 헤더 — 무료 등급 라우팅/통계용
            "HTTP-Referer": os.environ.get("OPENROUTER_REFERER", "https://localhost/document-pipeline"),
            "X-Title": os.environ.get("OPENROUTER_APP_NAME", "document-intelligence-pipeline"),
        }

        with httpx.Client(timeout=httpx.Timeout(120.0)) as client:
            resp = client.post(_OPENROUTER_URL, json=payload, headers=headers)
            resp.raise_for_status()
            body = resp.json()

        try:
            text = body["choices"][0]["message"]["content"] or "{}"
        except (KeyError, IndexError, TypeError) as e:
            return VLMResponse(
                data={"_parse_error": True, "_raw": json.dumps(body)[:500], "_reason": str(e)},
                raw_text=json.dumps(body)[:500],
                model=self.model,
            )

        # 일부 모델/라우트가 코드펜스를 섞어 보낼 수 있음 — 방어
        stripped = text.strip()
        if stripped.startswith("```"):
            stripped = stripped.strip("`")
            if stripped.lower().startswith("json"):
                stripped = stripped[4:].lstrip()

        try:
            data = json.loads(stripped)
        except json.JSONDecodeError:
            data = {"_raw": text, "_parse_error": True}
        return VLMResponse(data=data, raw_text=text, model=self.model)
