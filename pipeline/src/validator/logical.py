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
            # 두 가지 형태 지원:
            #   (a) operands=[A, B], equals=C  →  A + B == C
            #   (b) list_field=L, operand=k, equals=C  →  sum(L[*].k) == C
            list_field = rule.get("list_field")
            target = rule["equals"]
            optional = rule.get("optional", False)
            tolerance = int(rule.get("tolerance", 0))

            if list_field is not None:
                operand_name = rule["operand"]
                rows = fields.get(list_field) or []
                target_v = _to_int(fields.get(target))
                if not isinstance(rows, list) or target_v is None:
                    if optional:
                        continue
                    results.append(LogicalCheckResult(
                        rule=f"sum_eq(Σ{list_field}.{operand_name})={target}",
                        passed=False,
                        detail=f"리스트 또는 합계 누락 (target={target_v}, rows={len(rows) if isinstance(rows, list) else 'n/a'})",
                    ))
                    continue
                row_vals = [_to_int(r.get(operand_name)) for r in rows if isinstance(r, dict)]
                if any(v is None for v in row_vals):
                    if optional:
                        continue
                    results.append(LogicalCheckResult(
                        rule=f"sum_eq(Σ{list_field}.{operand_name})={target}",
                        passed=False,
                        detail=f"행 단위 {operand_name} 누락 다수 — 행 수가 부족할 가능성",
                    ))
                    continue
                total = sum(row_vals)  # type: ignore[arg-type]
                passed = abs(total - target_v) <= tolerance
                results.append(LogicalCheckResult(
                    rule=f"sum_eq(Σ{list_field}.{operand_name})={target}",
                    passed=passed,
                    detail=f"행수={len(rows)} Σ={total} vs {target}={target_v} (오차 허용 {tolerance})",
                ))
                continue

            # (a) 단순 필드 합산
            operands = rule["operands"]
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
