# 토스페이먼츠 연동 — PG 협약/개발 요청 사항

> 1차 출시 결제 항목: **상단노출**, **자동 끌올**, **벌크 셀러 멤버십**.
> 결제 수단: **카드 + 간편결제(토스페이/카카오페이/네이버페이) + 가상계좌**.
> 안전거래(에스크로)는 2차 옵션.

---

## 1. 협약/계약 단계에서 토스에 요청해야 할 것

### 1.1 가맹점 심사 자료
- 사업자등록증
- 통신판매업 신고증
- 대표자 신분증/통장사본
- **서비스 URL/스테이징 URL** + 정책 페이지 4종(이용약관/개인정보/환불/광고결제 정책)
- 메뉴 흐름 캡처 — 결제 진입 페이지 스샷 필수

### 1.2 결제 수단/상품 활성화
- [ ] **카드** 결제
- [ ] **간편결제**: 토스페이 / 카카오페이 / 네이버페이 / 페이코
- [ ] **가상계좌** (입금기한 설정 가능, 입금 콜백)
- [ ] (옵션) **계좌이체** — 즉시이체
- [ ] (옵션) **휴대폰 결제** — 미성년자 결제 비중이 크면 차라리 비활성 권장

### 1.3 수수료/정산 협상 포인트
- 카드 수수료율(업종별 차등 가능)
- 간편결제 수수료
- **가상계좌 건당 수수료**(이건 정액인 경우가 많음 — 광고비가 소액일 때 마진 잠식 주의)
- 정산 주기(D+1 / D+2 / D+5) — 광고 매출이라 빨라야 운영자금 회전
- **부분 환불 / 전액 환불 정책**

### 1.4 보안/계정 발급
- **테스트 가맹점 계정** + 운영용 가맹점 계정 분리
- 클라이언트 키 / 시크릿 키 (테스트/운영 각각)
- **웹훅(Webhook) 수신 URL** 등록 — `/api/webhooks/toss` 엔드포인트 미리 정해 알리기
- IP 화이트리스트 등록(웹훅 발신 IP)
- 시크릿 키는 **KMS/시크릿 매니저** 보관, 코드/.env 평문 저장 금지

### 1.5 운영/CS
- 환불/취소 한도와 주기(언제까지 가능한지)
- 결제 분쟁(차지백) 대응 절차
- 운영자 콘솔 접근 권한(2~3명만)

---

## 2. 개발 시 핵심 요청/구현 사항

### 2.1 결제 흐름 (카드/간편결제 — 표준)

```
[사용자] 광고 옵션 선택
  └─ POST /api/ads/orders  → orderId, amount 생성 (서버에서 amount 계산)
[프론트] Toss SDK loadTossPayments(clientKey)
  └─ tossPayments.requestPayment("카드", { orderId, amount, orderName, successUrl, failUrl, customerKey })
[Toss 결제창] → successUrl 리다이렉트
[서버] GET /api/ads/orders/confirm?paymentKey&orderId&amount
  └─ Toss API: POST /v1/payments/confirm  (서버 시크릿키)
  └─ 응답 정상 + amount 일치 검증
  └─ 주문 상태 PAID, 광고 효과 즉시 시작
[웹훅] POST /api/webhooks/toss (status 변경 통지)
  └─ 서명 검증 → 멱등 처리
```

> 핵심: **금액은 클라가 보낸 값을 믿지 말고 서버에서 다시 계산해 비교**. Toss confirm 응답의 amount와 DB amount가 다르면 즉시 거절.

### 2.2 가상계좌 흐름 (입금형 결제)

```
[사용자] "가상계좌" 선택
  └─ tossPayments.requestPayment("가상계좌", { orderId, amount, validHours: 24, ... })
[Toss] 가상계좌 발급 → successUrl 호출 (이 시점은 "발급 완료", 아직 미입금)
[서버] confirm 호출 → 응답에 virtualAccount 정보(bank, accountNumber, dueDate)
  └─ 주문 상태 WAITING_FOR_DEPOSIT
  └─ 사용자에게 입금 안내(SMS/이메일/화면)
[입금 발생] Toss 웹훅 발송: paymentKey + status=DONE
[서버 웹훅 핸들러]
  └─ 서명 검증
  └─ 주문 상태 PAID → 광고 효과 시작 + 알림
[입금 미완료] dueDate 경과 시 웹훅 status=EXPIRED
  └─ 주문 상태 EXPIRED
```

가상계좌 구현에서 자주 빼먹는 것:
- **입금자명 검증 옵션** 사용 여부(쓰면 동명이인 사기 방지에 도움).
- **부분입금 처리** — 부족하게 입금되면 자동 환불 또는 보완입금 안내.
- **초과입금 처리** — 차액 환불 정책.
- **만료 후 입금** — 만료 후 입금되면 자동 환불 큐로.
- **세금계산서 발행** — 사업자 회원 광고 결제 시.

### 2.3 환불/취소

- 결제일 당일: **즉시 취소** API 사용(카드 승인 취소).
- 결제일 이후: **부분/전액 환불** API.
- 가상계좌 환불은 **사용자 환불계좌 정보** 필요(이름/은행/계좌번호) → 환불 폼.

광고 환불 정책(권장 초안):
- 상단노출/끌올 시작 전: **100% 환불**.
- 시작 후 24시간 내 + 미사용분 비례: **부분 환불**(미사용 시간 기준).
- 24시간 경과: **환불 불가**(약관 사전 동의 필수).

### 2.4 멱등성·중복 결제 방지

- `orderId`는 회사가 생성(UUID), Toss에 전달. 같은 orderId 재confirm 거부.
- 웹훅 핸들러는 **(paymentKey, status, requestId) 단위 멱등** 처리.
- 사용자 더블클릭 방어: 프론트 결제 버튼 락 + 서버 주문 생성 5초 쿨다운.

### 2.5 보안

- 서버 시크릿 키는 **KMS** + 환경변수 주입, 코드 저장 금지.
- 웹훅 **서명(또는 IP 화이트리스트)** 검증.
- 결제 로그 append-only 테이블에 raw 응답 저장(감사용).
- PII 분리 저장(결제자명/이메일은 토큰화).

### 2.6 테스트 시나리오 (출시 전 체크)

- [ ] 카드 정상 결제 → 광고 즉시 시작
- [ ] 카드 결제 실패 처리(잔액부족, 한도초과)
- [ ] 간편결제 각 사 1건 이상 정상 결제
- [ ] 가상계좌 발급 → 정상 입금 → 광고 시작
- [ ] 가상계좌 발급 → 미입금 만료
- [ ] 가상계좌 부분/초과 입금
- [ ] 결제 후 즉시 취소
- [ ] 결제 후 부분 환불(가상계좌는 환불계좌 입력)
- [ ] 동일 orderId 재시도 차단
- [ ] 웹훅 서명 위조 시도 차단
- [ ] 미성년자 본인인증 차단

---

## 3. 데이터 모델(결제 부분만 발췌)

```prisma
model AdOrder {
  id            String   @id @default(uuid())  // = Toss orderId
  buyerId       String
  productKind   String   // TOP_SLOT | BUMP | MEMBERSHIP | BANNER
  productMeta   Json     // 슬롯/시간/대상 게시글 ID 등
  amount        Int
  vat           Int
  status        AdOrderStatus
  pgProvider    String   // toss
  pgPaymentKey  String?
  pgMethod      String?  // CARD / VBANK / EASY_PAY
  vbank         Json?    // {bank, accountNumber, dueDate, holder}
  paidAt        DateTime?
  expiredAt     DateTime?
  refunds       AdRefund[]
  createdAt     DateTime @default(now())
  @@index([buyerId, status])
}

model AdRefund {
  id          String   @id @default(uuid())
  orderId     String
  amount      Int
  reason      String
  pgRefundKey String?
  status      String
  createdAt   DateTime @default(now())
}

enum AdOrderStatus {
  PENDING WAITING_FOR_DEPOSIT PAID PARTIAL_REFUNDED REFUNDED EXPIRED FAILED CANCELED
}
```

---

## 4. 광고 상품(SKU) 정의 — 가격은 가설

| productKind | 상세 | 단위 | 가격(가설) |
|---|---|---|---|
| TOP_SLOT | 카테고리 상단 N슬롯 노출 | 12h / 24h / 7d | 5,000 / 10,000 / 50,000 |
| BUMP | 자동 끌올 | 30분 간격 24h / 1h 간격 24h / 1주일 패키지 | 5,000 / 3,000 / 25,000 |
| BANNER | 메인 띠 배너 | 일 / 주 | 30,000 / 150,000 |
| MEMBERSHIP | 벌크 셀러 멤버십 | 월 | 19,900 / 49,000 / 99,000 |

- 모든 가격에 부가세 포함.
- 가격은 어드민에서 변경 가능(상수 박지 말 것 — 가격표 테이블화).

---

## 5. 끌올 스케줄러 (광고 핵심 로직)

```
AdOrder(BUMP) 결제 → BumpJob 생성
  · listingId
  · intervalMinutes
  · startAt / endAt
  · nextFireAt
워커(매분 실행)
  └─ now >= nextFireAt 인 잡 조회
       · Listing.bumpedAt = now
       · 정렬 키 갱신
       · nextFireAt = now + intervalMinutes
       · endAt 도달 시 잡 종료
```

어뷰징 방지:
- 동일 게시글 끌올 최소 간격 강제(예: 30분 미만 불가).
- 카테고리당 동시에 끌올 활성 게시글 수 상한.
- 끌올 결제 결제자 ≠ 게시글 작성자 차단.

---

## 6. 한 페이지 요약 (협약 미팅용 슬라이드 캡션)

> "통신판매중개 + 광고 BM의 한국형 게시판 서비스. 결제는 광고 4종(상단노출/끌올/배너/멤버십)에 대해 카드·간편결제·가상계좌 사용. 월 광고결제 건수 X건, 평균 객단가 Y원, 환불율 Z% 목표. 2차에 안전거래(에스크로) 도입 가능성 있어 그 시점에 PG 위탁 에스크로 구조 협의 희망."
