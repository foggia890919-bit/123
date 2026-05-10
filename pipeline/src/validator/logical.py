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
        elif kind == "row_arith":
            results.extend(_run_row_arith(fields, rule))
    return results


def _run_row_arith(fields: dict[str, Any], rule: dict) -> list[LogicalCheckResult]:
    """list_field 안의 각 행에서 operand 끼리 연산한 결과가 equals와 같은지.

    예: drugs[*]에서 unit_price * total_qty == total_amount.
    한 행이라도 어긋나면 그 행을 콕 집어 fail로 보고한다 (어디가 이상한지 알아야
    self-correction 프롬프트에 정확히 되먹일 수 있다).
    """
    list_field = rule["list_field"]
    operands = rule["operands"]
    op = rule.get("operator", "mul")
    target = rule["equals"]
    tolerance = int(rule.get("tolerance", 0))

    rows = fields.get(list_field) or []
    if not isinstance(rows, list):
        return [LogicalCheckResult(
            rule=f"row_arith({list_field})",
            passed=False,
            detail=f"{list_field}가 리스트가 아님",
        )]

    out: list[LogicalCheckResult] = []
    for idx, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        operand_values = [_to_int(row.get(o)) for o in operands]
        target_v = _to_int(row.get(target))
        if any(v is None for v in operand_values) or target_v is None:
            continue  # 행 단위 누락은 row_arith로 잡지 않는다 (validator의 MISSING이 잡음)
        if op == "mul":
            calc = 1
            for v in operand_values:
                calc *= v  # type: ignore[operator]
        elif op == "add":
            calc = sum(operand_values)  # type: ignore[arg-type]
        else:
            return [LogicalCheckResult(
                rule=f"row_arith({op})",
                passed=False,
                detail=f"알 수 없는 operator: {op}",
            )]
        passed = abs(calc - target_v) <= tolerance
        if not passed:
            label = row.get("drug_name") or row.get("name") or f"row#{idx}"
            out.append(LogicalCheckResult(
                rule=f"row_arith[{idx}]({operands}{op}={target})",
                passed=False,
                detail=f"'{label}': calc={calc} vs {target}={target_v}",
            ))
    if not out:
        out.append(LogicalCheckResult(
            rule=f"row_arith({list_field}, {operands}{op}={target})",
            passed=True,
            detail=f"전 {len(rows)}행 통과 (허용오차 {tolerance})",
        ))
    return out
