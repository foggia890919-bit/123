"""Document Intelligence Pipeline — CLI 진입점.

사용:
    python -m pipeline.main <이미지> [--template TID] [--debug] [--provider gemini|claude]

--template를 명시하면 분류 단계를 건너뛴다 (이미 양식을 아는 일괄 처리용).
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, is_dataclass
from pathlib import Path

from .src.classifier import classify
from .src.extractor import extract
from .src.llm import get_adapter
from .src.preprocessor import PreprocessOptions, preprocess
from .src.preprocessor.pipeline import load_image
from .src.templates import load_registry
from .src.validator import validate


def _to_jsonable(obj):
    if is_dataclass(obj):
        return {k: _to_jsonable(v) for k, v in asdict(obj).items()}
    if isinstance(obj, dict):
        return {k: _to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_jsonable(v) for v in obj]
    if hasattr(obj, "value"):
        return obj.value
    return obj


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Document Intelligence Pipeline")
    parser.add_argument("image", type=Path)
    parser.add_argument("--template", default=None, help="분류 단계 건너뛰고 강제 지정")
    parser.add_argument("--config", type=Path, default=Path(__file__).parent / "configs/templates.json")
    parser.add_argument("--provider", default=None, help="gemini | claude")
    parser.add_argument("--debug", action="store_true", help="전처리 중간 산출물 저장")
    parser.add_argument("--boost-table", action="store_true", help="복잡한 표 양식 격자 강화")
    args = parser.parse_args(argv)

    registry = load_registry(args.config)
    image = load_image(args.image)

    debug_dir = Path(__file__).parent / "debug" / args.image.stem if args.debug else None
    pre = preprocess(
        image,
        PreprocessOptions(
            debug_dir=debug_dir,
            boost_table=args.boost_table,
        ),
    )

    adapter = get_adapter(args.provider)

    if args.template:
        template = registry.get(args.template)
        classification = {"template_id": template.id, "label": template.label, "confidence": 1.0, "forced": True}
    else:
        result = classify(pre.image, registry, adapter)
        if result.template_id == "unknown":
            print(json.dumps({
                "stage": "classify",
                "ok": False,
                "reason": "unknown template",
                "raw": result.raw,
                "preprocess": _to_jsonable(pre.notes),
            }, ensure_ascii=False, indent=2))
            return 2
        template = registry.get(result.template_id)
        classification = _to_jsonable(result)

    extraction = extract(pre.image, template, adapter)
    report = validate(template, extraction.fields, registry.field_types)

    print(json.dumps({
        "preprocess": {
            "perspective_method": pre.perspective_method,
            "inverted": pre.inverted,
            "notes": pre.notes,
            "debug_dir": str(pre.debug_dir) if pre.debug_dir else None,
        },
        "classify": classification,
        "extract": {
            "template_id": extraction.template_id,
            "parse_ok": extraction.parse_ok,
            "parse_errors": extraction.parse_errors,
            "fields": extraction.fields,
        },
        "validate": _to_jsonable(report),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
