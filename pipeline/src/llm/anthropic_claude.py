"""Anthropic Claude (Vision) VLM 어댑터."""

from __future__ import annotations

import base64
import io
import json
import os
from typing import Any

import cv2
import numpy as np
from PIL import Image

from .base import VLMAdapter, VLMResponse


class ClaudeAdapter(VLMAdapter):
    def __init__(self, model: str = "claude-opus-4-7") -> None:
        self.model = model

    def generate_json(
        self,
        image: np.ndarray,
        instruction: str,
        json_schema: dict[str, Any] | None = None,
    ) -> VLMResponse:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY 환경변수가 필요합니다")

        import anthropic

        client = anthropic.Anthropic(api_key=api_key)

        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB) if image.ndim == 3 else image
        pil = Image.fromarray(rgb)
        buf = io.BytesIO()
        pil.save(buf, format="PNG")
        b64 = base64.standard_b64encode(buf.getvalue()).decode("ascii")

        schema_hint = ""
        if json_schema is not None:
            schema_hint = (
                "\n\n출력 JSON은 다음 스키마를 따라야 한다:\n"
                + json.dumps(json_schema, ensure_ascii=False, indent=2)
            )

        message = client.messages.create(
            model=self.model,
            max_tokens=4096,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/png",
                                "data": b64,
                            },
                        },
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
        )
        text = "".join(
            block.text for block in message.content if getattr(block, "type", "") == "text"
        ).strip()
        # 코드펜스 방어
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json"):
                text = text[4:].lstrip()
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            data = {"_raw": text, "_parse_error": True}
        return VLMResponse(data=data, raw_text=text, model=self.model)
