"""validator 단위 테스트 — VLM 의존 없이 돌릴 수 있는 진실의 게이트."""

from pathlib import Path

import pytest

from pipeline.src.templates import load_registry
from pipeline.src.validator import FieldStatus, validate
from pipeline.src.validator.regex_rules import (
    normalize_amount,
    normalize_biz_no,
    normalize_date,
    normalize_phone,
    normalize_rrn,
)

CONFIG = Path(__file__).parent.parent / "configs/templates.json"


def test_normalizers():
    assert normalize_biz_no("123 45 67890") == "123-45-67890"
    assert normalize_biz_no("12345") is None
    assert normalize_rrn("9001011234567") == "900101-1234567"
    assert normalize_phone("01012345678") == "010-1234-5678"
    assert normalize_phone("027001234") == "027-001-234" or normalize_phone("027001234") is None
    assert normalize_date("2025년 5월 9일") == "2025-05-09"
    assert normalize_date("2025/05/09") == "2025-05-09"
    assert normalize_amount("₩1,234,567원") == 1234567
    assert normalize_amount("not a number") is None


def test_validate_tax_invoice_passes_sum_check():
    registry = load_registry(CONFIG)
    template = registry.get("tax_invoice_kr")
    extracted = {
        "supplier_biz_no": "123-45-67890",
        "supplier_name": "ACME",
        "supplier_ceo": "홍길동",
        "buyer_biz_no": "987-65-43210",
        "buyer_name": "BUYER",
        "issue_date": "2025-05-09",
        "supply_amount": "100,000",
        "tax_amount": "10,000",
        "total_amount": "110,000",
    }
    report = validate(template, extracted, registry.field_types)
    assert report.confidence >= 0.9
    assert not report.needs_manual_review
    assert all(f.status == FieldStatus.OK for f in report.fields)


def test_validate_flags_sum_mismatch():
    registry = load_registry(CONFIG)
    template = registry.get("tax_invoice_kr")
    extracted = {
        "supplier_biz_no": "123-45-67890",
        "supplier_name": "ACME",
        "supplier_ceo": "홍길동",
        "buyer_biz_no": "987-65-43210",
        "buyer_name": "BUYER",
        "issue_date": "2025-05-09",
        "supply_amount": "100,000",
        "tax_amount": "10,000",
        "total_amount": "999,999",  # 일부러 틀림
    }
    report = validate(template, extracted, registry.field_types)
    assert report.needs_manual_review is True
    assert any(not c.passed for c in report.logical_checks)


def test_validate_flags_missing_required():
    registry = load_registry(CONFIG)
    template = registry.get("biz_registration_kr")
    extracted = {
        "biz_no": "123-45-67890",
        "company_name": "",
        "ceo_name": "홍길동",
        "open_date": "2020-01-01",
        "address": "서울시 강남구",
    }
    report = validate(template, extracted, registry.field_types)
    statuses = {f.name: f.status for f in report.fields}
    assert statuses["company_name"] == FieldStatus.MISSING
    assert report.needs_manual_review is True


def test_validate_flags_format_invalid():
    registry = load_registry(CONFIG)
    template = registry.get("biz_registration_kr")
    extracted = {
        "biz_no": "ABC-DE-FGHIJ",  # 형식 깨짐
        "company_name": "ACME",
        "ceo_name": "홍길동",
        "open_date": "2020-01-01",
        "address": "서울시 강남구",
    }
    report = validate(template, extracted, registry.field_types)
    statuses = {f.name: f.status for f in report.fields}
    assert statuses["biz_no"] == FieldStatus.FORMAT_INVALID


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
