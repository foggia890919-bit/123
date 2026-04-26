# 게임 아이템 거래 플랫폼 — 기획문서

벤치마크: **아이템매니아 / 아이템베이**.
이 폴더는 같은 레포 안의 다른 프로젝트들과 충돌하지 않도록 분리된 기획문서 모음이다.

## 문서 구성

| 파일 | 내용 |
|---|---|
| [00-overview.md](./00-overview.md) | 서비스 개요, 타깃, 카테고리, BM, NFR, MVP 범위 |
| [10-features-and-flows.md](./10-features-and-flows.md) | IA, 기능 목록, 사용자 플로우, 알림 매트릭스 |
| [20-data-model.md](./20-data-model.md) | Prisma 의사 스키마, Order 상태 머신, 주요 API |
| [30-safety-escrow-dispute.md](./30-safety-escrow-dispute.md) | 에스크로/거래한도/분쟁 SLA/제재 정책 |
| [40-roadmap-kpi.md](./40-roadmap-kpi.md) | 페이즈별 로드맵, KPI, 출시 게이트 |
| [50-legal-checklist.md](./50-legal-checklist.md) | 신고/약관/개인정보/게임사 RMT/보안 체크리스트 |

## 다음 액션 (제안)

1. `00-overview.md`의 타깃·BM·MVP 범위에 대한 의사결정.
2. 1차 출시 게임 1~2개 선정 → `Game.schemaJson` 동적 폼 정의.
3. PG/본인확인사 견적 → 법무 자문 1회.
4. Figma 와이어프레임 작업(상품 상세, 거래방, 분쟁 화면 우선).
5. 이후 별도 브랜치(예: `claude/item-trading-mvp-XXXX`)로 코드 구현 시작.
