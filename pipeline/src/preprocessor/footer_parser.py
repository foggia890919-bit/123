"""이미지 하단 메타 푸터를 정규식으로 결정론적 파싱.

5장의 샘플 모두 다음 포맷의 한 줄이 박혀있다:

    YYYY-MM/병원명(123-45-67890)/의사이름/제약사명

의사 이름은 빈 슬롯(슬래시 두 번 연속)일 수 있다. 이 한 줄만 정확히 잡으면
4가지 메타(기간·병원·사업자번호·제약사)가 VLM 호출 없이 확정되므로 비용/오류
양쪽 다 줄어든다. 푸터가 없는 양식이면 None을 돌려주고, 호출자는 VLM 폴백.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_FOOTER_RE = re.compile(
    r"(?P<period>\d{4}-\d{2})"
    r"\s*/\s*"
    r"(?P<hospital>[^()/\n]+?)"
    r"\s*\(\s*(?P<biz_no>\d{3}-\d{2}-\d{5})\s*\)"
    r"\s*/\s*"
    r"(?P<doctor>[^/\n]*)"
    r"\s*/\s*"
    r"(?P<pharma>[^\n/]+?)\s*$",
    re.MULTILINE,
)


@dataclass
class FooterMetadata:
    period: str          # "2026-04"
    hospital: str        # "신목제일의원"
    biz_no: str          # "113-96-03529"
    doctor: str | None   # "이재영" 또는 None
    pharma: str          # "정우신약"
    raw: str             # 원본 매칭 문자열


def parse_footer_text(text: str) -> FooterMetadata | None:
    """OCR/VLM이 뽑은 텍스트 전체를 받아 마지막에 등장하는 푸터 라인을 찾는다.

    여러 행 중 마지막 매칭을 사용 — 푸터는 항상 이미지 가장 아래 한 줄.
    """
    matches = list(_FOOTER_RE.finditer(text))
    if not matches:
        return None
    m = matches[-1]
    doctor = (m.group("doctor") or "").strip()
    return FooterMetadata(
        period=m.group("period"),
        hospital=m.group("hospital").strip(),
        biz_no=m.group("biz_no"),
        doctor=doctor or None,
        pharma=m.group("pharma").strip(),
        raw=m.group(0),
    )


def merge_into_fields(meta: FooterMetadata, fields: dict) -> dict:
    """푸터에서 결정한 메타로 추출 결과를 보강.

    원칙: 푸터는 결정론적이므로 VLM 추출값보다 우선한다 (단, 푸터에 없는 값은
    VLM 결과를 그대로 둠).
    """
    enriched = dict(fields)
    enriched["hospital_name"] = meta.hospital
    enriched["hospital_biz_no"] = meta.biz_no
    enriched["pharma_company"] = meta.pharma
    if meta.doctor:
        enriched["prescriber_name"] = meta.doctor
    # 기간(YYYY-MM)은 시작/종료가 같은 달 1일~말일이라고 추정
    year, month = meta.period.split("-")
    enriched.setdefault("period_start", f"{year}-{month}-01")
    return enriched
