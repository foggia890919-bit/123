"""정형 데이터(사업자번호, 주민번호, 전화, 날짜, 금액)의 형식 검증 + 정규화."""

from __future__ import annotations

import re

_DIGITS = re.compile(r"\D+")


def normalize_biz_no(raw: str) -> str | None:
    digits = _DIGITS.sub("", raw)
    if len(digits) != 10:
        return None
    return f"{digits[:3]}-{digits[3:5]}-{digits[5:]}"


def normalize_rrn(raw: str) -> str | None:
    digits = _DIGITS.sub("", raw)
    if len(digits) != 13:
        return None
    return f"{digits[:6]}-{digits[6:]}"


def normalize_phone(raw: str) -> str | None:
    digits = _DIGITS.sub("", raw)
    if len(digits) == 10:
        return f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"
    if len(digits) == 11:
        return f"{digits[:3]}-{digits[3:7]}-{digits[7:]}"
    return None


_DATE_PATTERNS = [
    re.compile(r"^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$"),
    re.compile(r"^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일?$"),
]


def normalize_date(raw: str) -> str | None:
    s = raw.strip()
    for pat in _DATE_PATTERNS:
        m = pat.match(s)
        if m:
            y, mo, d = m.groups()
            return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
    return None


def normalize_amount(raw: str) -> int | None:
    """원화 기호/콤마/공백을 떼고 정수로. 음수 부호 허용."""
    s = raw.strip().replace("원", "").replace("₩", "").replace(",", "").replace(" ", "")
    if not s:
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


_NORMALIZERS = {
    "biz_no": normalize_biz_no,
    "rrn": normalize_rrn,
    "phone": normalize_phone,
    "date": normalize_date,
    "amount": normalize_amount,
}


def normalize_field(field_type: str, raw):
    if raw is None:
        return None
    norm = _NORMALIZERS.get(field_type)
    if norm is None:
        return raw
    return norm(str(raw))
