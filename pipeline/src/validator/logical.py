"""양식별 산술 검증 — 예: 공급가액 + 부가세 = 합계금액."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class LogicalCheckResult:
    rule: str
    passed: bool
    detail: str


def _to_int(v: Any) -> int | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return int(v)
    try:
        return int(str(v).replace(",", "").strip())
    except ValueError:
        return None


def run_checks(fields: dict[str, Any], rules: list[dict]) -> list[LogicalCheckResult]:
    results: list[LogicalCheckResult] = []
    for rule in rules:
        kind = rule.get("rule")
        if kind == "sum_eq":
            operands = rule["operands"]
            target = rule["equals"]
            optional = rule.get("optional", False)
            values = [_to_int(fields.get(name)) for name in operands]
            target_v = _to_int(fields.get(target))
            if any(v is None for v in values) or target_v is None:
                if optional:
                    continue
                results.append(
                    LogicalCheckResult(
                        rule=f"sum_eq({operands})={target}",
                        passed=False,
                        detail="피연산자 또는 합계 누락",
                    )
                )
                continue
            total = sum(values)  # type: ignore[arg-type]
            passed = total == target_v
            results.append(
                LogicalCheckResult(
                    rule=f"sum_eq({operands})={target}",
                    passed=passed,
                    detail=f"sum={total} vs {target}={target_v}",
                )
            )
    return results
