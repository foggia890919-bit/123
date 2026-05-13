"""Document Intelligence Pipeline — CLI 진입점.

사용:
    python -m pipeline.main <이미지> [--template TID] [--debug]
                                     [--provider gemini|claude]
                                     [--max-retries N] [--boost-table]

--template를 명시하면 분류 단계를 건너뛴다 (이미 양식을 아는 일괄 처리용).
--max-retries는 self-correction 루프 한도. 검증이 실패하면 그만큼 재추출한다.
기본 1 — Gemini 분당 요청/토큰 한도 보호용. 호출량을 더 늘리려면 키 티어 먼저 올릴 것.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, is_dataclass
from pathlib import Path

# pipeline/.env 를 자동 로딩 — 키를 매번 export 하지 않아도 되도록.
try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass

from .src.llm import get_adapter
from .src.orchestrator import run_pipeline
from .src.preprocessor import PreprocessOptions
from .src.preprocessor.pipeline import load_image
from .src.templates import load_registry


def _to_jsonable(obj):
    if is_dataclass(obj):
        return {k: _to_jsonable(v) for k, v in asdict(obj).items()}
    if isinstance(obj, dict):
        return {k: _to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_jsonable(v) for v in obj]
    if hasattr(obj, "value"):
        return obj.value
    if hasattr(obj, "__dict__") and not isinstance(obj, type):
        return {k: _to_jsonable(v) for k, v in obj.__dict__.items() if not k.startswith("_")}
    return obj


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Document Intelligence Pipeline")
    parser.add_argument("image", type=Path)
    parser.add_argument("--template", default=None, help="분류 단계 건너뛰고 강제 지정")
    parser.add_argument(
        "--config", type=Path, default=Path(__file__).parent / "configs/templates.json"
    )
    parser.add_argument("--provider", default=None, help="gemini | claude")
    parser.add_argument("--debug", action="store_true", help="전처리 중간 산출물 저장")
    parser.add_argument("--boost-table", action="store_true", help="복잡한 표 양식 격자 강화")
    parser.add_argument(
        "--max-retries", type=int, default=1,
        help="self-correction 재추출 한도 (기본 1, 0이면 비활성)",
    )
    parser.add_argument(
        "--no-roi-recrop", action="store_true",
        help="Stage 5 ROI 재추출 비활성 (비용 절감용)",
    )
    args = parser.parse_args(argv)

    registry = load_registry(args.config)
    image = load_image(args.image)

    debug_dir = Path(__file__).parent / "debug" / args.image.stem if args.debug else None
    pre_opts = PreprocessOptions(debug_dir=debug_dir, boost_table=args.boost_table)

    adapter = get_adapter(args.provider)
    result = run_pipeline(
        image,
        registry,
        adapter,
        forced_template_id=args.template,
        preprocess_options=pre_opts,
        max_retries=args.max_retries,
        enable_roi_recrop=not args.no_roi_recrop,
    )

    output = {
        "preprocess": {
            "perspective_method": result.preprocess.perspective_method,
            "inverted": result.preprocess.inverted,
            "notes": result.preprocess.notes,
            "debug_dir": str(result.preprocess.debug_dir) if result.preprocess.debug_dir else None,
        },
        "classify": _to_jsonable(result.classify) if result.classify else None,
        "template_id": result.template_id,
        "fell_back_to_generic": result.fell_back_to_generic,
        "attempts": result.attempts,
        "retried": result.retried,
        "extract": {
            "parse_ok": result.extract.parse_ok,
            "parse_errors": result.extract.parse_errors,
            "fields": result.extract.fields,
        },
        "validate": _to_jsonable(result.validate),
        "notes": result.notes,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0 if not result.validate.needs_manual_review else 3


if __name__ == "__main__":
    sys.exit(main())
