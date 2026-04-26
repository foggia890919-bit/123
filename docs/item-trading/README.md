# 게임 아이템 거래 플랫폼 — 기획문서

벤치마크: **아이템매니아 / 아이템베이**.
이 폴더는 같은 레포 안의 다른 프로젝트들과 충돌하지 않도록 분리된 기획문서 모음이다.

## 문서 구성

| 파일 | 내용 |
|---|---|
| [00-overview.md](./00-overview.md) | 서비스 개요·타깃·카테고리·BM·범위 |
| [10-features-and-flows.md](./10-features-and-flows.md) | IA / 기능 / 사용자 플로우 / 알림 |
| [11-listing-form-schema.md](./11-listing-form-schema.md) | 동적 등록 폼 개념 + 카테고리(아이템/머니/계정/상품권) 필드 |
| [20-data-model.md](./20-data-model.md) | Prisma 의사 스키마 / Order 상태 머신 / API |
| [30-safety-escrow-dispute.md](./30-safety-escrow-dispute.md) | 안전거래·분쟁 SLA·제재 정책 (2차 옵션) |
| [40-roadmap-kpi.md](./40-roadmap-kpi.md) | 로드맵 / KPI / 출시 게이트 |
| [50-legal-checklist.md](./50-legal-checklist.md) | 법무·보안 운영 체크리스트 |
| [51-legal-risks.md](./51-legal-risks.md) | 1차(게시판) 모델의 법무 리스크 자체 검토 |
| [60-toss-integration.md](./60-toss-integration.md) | 토스페이먼츠 + 가상계좌 연동 협약/개발 요청사항 |
| [70-wireframes.md](./70-wireframes.md) | 텍스트 와이어(상품 상세/거래방/분쟁) |

## 결정된 방향 (v0.2)

- **타깃**: 전 연령 (미성년자는 결제 시 본인인증·동의 모듈).
- **1차 BM**: 게시판형 + 유료 상단노출 + 유료 자동 끌올 + 벌크셀러 멤버십.
- **카테고리**: 아이템 / 게임머니 / 계정 / 상품권.
- **결제 PG**: 토스페이먼츠 (카드/간편결제/가상계좌).
- **안전거래(에스크로)**: 2차 옵션으로 보존(`30-...md`).

## 진행 중인 결정 항목

- 1차 오픈 게임 2종 (제안: 로스트아크, 메이플스토리) — 약관 검토 필요.
- 광고 환불 정책 문구 확정.
- 미성년자 결제: 차단 vs 동의모듈 선택.
- 변호사 1차 자문 일정.
