# 데이터 모델 & 주요 API 설계 (초안)

> Prisma/PostgreSQL 기준의 의사 스키마. 실제 마이그레이션 시점에 보정.
> 모든 테이블은 `id (uuid, pk)`, `createdAt`, `updatedAt` 기본 보유.

---

## 1. ER 개요

```
User ─┬─< KycVerification
      ├─< Listing >─ Game / Category
      ├─< Order (buyer)
      ├─< Order (seller)
      ├─< ChatRoom > Message
      ├─< Review
      ├─< PayoutAccount
      ├─< Wallet > LedgerEntry
      └─< Report / DisputeCase
Order ─< Payment / Escrow / Settlement / Dispute
```

---

## 2. 핵심 엔티티 (의사 Prisma)

```prisma
model User {
  id            String   @id @default(uuid())
  email         String   @unique
  phoneHash     String?  // 본인인증 후 해시 저장
  passwordHash  String
  nickname      String   @unique
  role          Role     @default(MEMBER) // MEMBER / SELLER_PRO / ADMIN / CS
  status        UserStatus @default(ACTIVE) // ACTIVE / SUSPENDED / BANNED
  trustScore    Int      @default(50) // 0~100
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  kyc           KycVerification?
  listings      Listing[]
  ordersBuy     Order[]    @relation("buyer")
  ordersSell    Order[]    @relation("seller")
  payoutAccts   PayoutAccount[]
  wallet        Wallet?
}

model KycVerification {
  id           String   @id @default(uuid())
  userId       String   @unique
  provider     String   // PASS, NICE
  ciHash       String   // 연계정보 해시
  diHash       String
  verifiedAt   DateTime
  user         User     @relation(fields: [userId], references: [id])
}

model Game {
  id        String     @id @default(uuid())
  slug      String     @unique  // wow, lostark, maplestory
  name      String
  active    Boolean    @default(true)
  schemaJson Json      // 카테고리별 동적 폼 스키마
  servers   GameServer[]
  listings  Listing[]
}

model GameServer {
  id     String @id @default(uuid())
  gameId String
  name   String
  region String?
  game   Game   @relation(fields: [gameId], references: [id])
}

model Category {
  id     String @id @default(uuid())
  slug   String @unique // money, item, account, character, gift
  name   String
}

model Listing {
  id            String   @id @default(uuid())
  sellerId      String
  gameId        String
  serverId      String?
  categoryId    String
  title         String
  attributes    Json     // 동적 옵션값(강화/옵션/수량 등)
  unitPrice     Int      // 원 단위 (KRW)
  unitLabel     String?  // "1만 골드", "1개"
  minQty        Int      @default(1)
  maxQty        Int?
  status        ListingStatus @default(ACTIVE) // ACTIVE / PAUSED / SOLD / BLOCKED
  imageKeys     String[]
  views         Int      @default(0)
  createdAt     DateTime @default(now())

  seller   User      @relation(fields: [sellerId], references: [id])
  game     Game      @relation(fields: [gameId], references: [id])
  category Category  @relation(fields: [categoryId], references: [id])

  @@index([gameId, categoryId, status])
  @@index([sellerId, status])
}

model Order {
  id           String   @id @default(uuid())
  listingId    String
  buyerId      String
  sellerId     String
  qty          Int
  amount       Int      // 결제 총액
  feeBuyer     Int      @default(0)
  feeSeller    Int      @default(0)
  state        OrderState @default(PAYMENT_PENDING)
  // PAYMENT_PENDING → PAID → DELIVERY_PENDING → DELIVERED
  //                  → CONFIRMED → SETTLED
  //                  → DISPUTED → REFUNDED / SETTLED
  paidAt       DateTime?
  deliveredAt  DateTime?
  confirmedAt  DateTime?
  autoConfirmAt DateTime? // 미확인 시 자동 확정 시점

  payment      Payment?
  escrow       Escrow?
  dispute      DisputeCase?
  chatRoom     ChatRoom?

  @@index([buyerId, state])
  @@index([sellerId, state])
}

model Payment {
  id        String   @id @default(uuid())
  orderId   String   @unique
  pgProvider String   // toss, kakao, inicis
  pgTxnId   String   @unique
  method    String   // CARD / BANK / VBANK
  amount    Int
  status    String   // READY / PAID / CANCELED / FAILED
  raw       Json     // PG 원응답 (감사용)
}

model Escrow {
  id        String   @id @default(uuid())
  orderId   String   @unique
  heldAmount Int
  releasedAt DateTime?
  refundedAt DateTime?
}

model PayoutAccount {
  id        String   @id @default(uuid())
  userId    String
  bankCode  String
  accountNoEnc String  // 암호화 저장
  accountHolder String
  verifiedAt DateTime?
}

model Wallet {
  id        String   @id @default(uuid())
  userId    String   @unique
  available Int      @default(0)  // 출금 가능
  pending   Int      @default(0)  // 정산 보류
}

model LedgerEntry {  // 모든 머니 이동의 단일 진실
  id        String   @id @default(uuid())
  userId    String
  orderId   String?
  type      String   // ESCROW_HOLD / ESCROW_RELEASE / FEE / PAYOUT / REFUND
  amount    Int      // +/-
  memo      String?
  createdAt DateTime @default(now())
  @@index([userId, createdAt])
}

model ChatRoom {
  id        String   @id @default(uuid())
  orderId   String?  @unique  // 거래방이면 연결, 일반 1:1 문의는 null
  buyerId   String
  sellerId  String
  listingId String?
  messages  Message[]
}

model Message {
  id        String   @id @default(uuid())
  roomId    String
  senderId  String
  body      String
  redacted  Boolean  @default(false) // 마스킹 여부
  attachments Json?
  createdAt DateTime @default(now())
  @@index([roomId, createdAt])
}

model Review {
  id         String  @id @default(uuid())
  orderId    String  @unique
  reviewerId String
  targetId   String
  rating     Int     // 1~5
  body       String?
}

model DisputeCase {
  id         String   @id @default(uuid())
  orderId    String   @unique
  openedById String
  reason     String   // NOT_DELIVERED, ITEM_MISMATCH, FRAUD ...
  state      String   // OPEN / IN_REVIEW / RESOLVED
  resolution String?  // REFUND / RELEASE / PARTIAL
  evidence   Json?    // 증빙 첨부 메타
  assignedToId String?
}

model AdminAuditLog {
  id     String @id @default(uuid())
  actorId String
  action String
  target String
  diff   Json
  createdAt DateTime @default(now())
}

enum Role { MEMBER SELLER_PRO ADMIN CS }
enum UserStatus { ACTIVE SUSPENDED BANNED }
enum ListingStatus { ACTIVE PAUSED SOLD BLOCKED }
enum OrderState {
  PAYMENT_PENDING PAID DELIVERY_PENDING DELIVERED
  CONFIRMED SETTLED DISPUTED REFUNDED
}
```

---

## 3. Order 상태 머신

```
PAYMENT_PENDING ──결제완료──▶ PAID ──거래방 생성──▶ DELIVERY_PENDING
                                                       │
                                              인계 완료(셀러)│
                                                       ▼
                                                   DELIVERED
                                       ┌────────────────┴────────────────┐
                          buyer 확인   │                                  │ autoConfirmAt 도달
                                       ▼                                  ▼
                                   CONFIRMED ──────정산 작업──────▶ SETTLED
                                       │
                                buyer/seller 분쟁
                                       ▼
                                   DISPUTED ──운영자 결정──▶ REFUNDED 또는 SETTLED
```

- `autoConfirmAt`: DELIVERED 후 48시간(MVP).
- DISPUTED 들어가면 정산 잡 일시정지.

---

## 4. 주요 API (REST 초안)

> 모두 `/api/v1/...`. 인증은 세션 쿠키 + CSRF 토큰. 관리자 API는 별도 prefix.

### 4.1 인증/회원
- `POST /auth/signup` (email, password, nickname)
- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/kyc/start` → 인증 토큰 반환
- `POST /auth/kyc/callback` ← 본인인증 사 콜백
- `POST /me/payout-account` (1원 인증 트리거)

### 4.2 게임/카테고리
- `GET /games`
- `GET /games/{slug}`  → 동적 스키마 포함
- `GET /categories`

### 4.3 상품
- `GET /listings?game=&category=&server=&q=&min=&max=&sort=&page=`
- `GET /listings/{id}`
- `POST /listings` (인증 + KYC 필요)
- `PATCH /listings/{id}` / `DELETE`

### 4.4 거래
- `POST /orders` (listingId, qty) → PAYMENT_PENDING + 결제 세션
- `POST /orders/{id}/pay/confirm` ← PG webhook
- `POST /orders/{id}/deliver` (seller) → DELIVERY_PENDING → DELIVERED
- `POST /orders/{id}/confirm` (buyer) → CONFIRMED
- `POST /orders/{id}/dispute`
- `POST /orders/{id}/cancel`

### 4.5 채팅
- `POST /chat/rooms` (listingId or orderId)
- `GET /chat/rooms/{id}/messages?cursor=`
- `POST /chat/rooms/{id}/messages`
- WebSocket: `wss://.../chat/{roomId}` (메시지·읽음)

### 4.6 정산
- `GET /me/wallet`
- `GET /me/wallet/ledger`
- `POST /me/wallet/payouts` (출금 신청)

### 4.7 관리자
- `GET /admin/disputes?state=OPEN&sort=slaLeftAsc`
- `POST /admin/disputes/{id}/resolve` (resolution, memo)
- `POST /admin/users/{id}/sanction`
- `GET /admin/stats/dashboard`

---

## 5. 파일/이미지 저장

- 객체 스토리지(S3 호환). Listing 이미지 키만 DB 저장.
- 업로드는 presigned URL 방식. 클라 → S3 직접.
- 채팅 첨부는 별도 버킷 + 1년 보관 정책.

---

## 6. 인덱싱/검색

- 1차: Postgres 인덱스 + `pg_trgm` 으로 LIKE 검색.
- 2차: OpenSearch / Meilisearch 도입(아이템 옵션 facet 검색).

---

## 7. 머니 이동 불변 원장

모든 금전 이동은 `LedgerEntry`에 기록(append-only).
재무 정합성은 `사용자별 합계 = wallet.available + wallet.pending` 으로 일치 검증(일배치).
