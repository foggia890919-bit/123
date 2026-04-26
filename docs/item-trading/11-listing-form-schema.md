# 동적 등록 폼(Listing Form Schema)

## 1. "동적 등록 폼"이 뭐야?

게시글 작성 폼이 **카테고리·게임마다 다르게 보이도록** DB에 정의해두고, 프론트가 그걸 읽어 화면을 그리는 구조다.

예시:
- 게임머니를 등록할 때 → "서버 / 단위(1만 골드) / 수량 / 단가" 입력칸이 뜬다.
- 아이템을 등록할 때 → "서버 / 캐릭터명 / 옵션 / 강화수치 / 수량 / 이미지" 입력칸이 뜬다.
- 같은 "아이템"이라도 **로스트아크와 메이플스토리는 옵션 항목이 다르므로**, 게임 마스터 데이터에 폼 스키마를 따로 둔다.

이렇게 하면:
- 새 게임을 추가할 때 코드 배포 없이 **어드민에서 폼만 바꿔도 새 카테고리 등록 가능**.
- 검색 필터도 같은 스키마를 재사용해 자동 생성(예: "강화 +20 이상" 슬라이더 자동 표시).

```
GameMaster (DB)
  └─ schemaJson: { categories: { ITEM: [필드…], MONEY: [필드…], … } }
            ↓ 프론트가 fetch
LoadGameForm(category) → 화면에 동적으로 입력칸 렌더
            ↓ 사용자 입력
Listing.attributes (Json) ← 검증된 값 저장
            ↓ 검색
Filter UI ← 같은 스키마로 자동 생성
```

## 2. 공통 필드 (모든 카테고리)

```yaml
common:
  - id: title
    label: 제목
    type: text
    required: true
    maxLength: 60
  - id: gameId
    label: 게임
    type: select(games)
    required: true
  - id: serverId
    label: 서버
    type: select(servers, depends=gameId)
    required: true
  - id: price
    label: 가격(원)
    type: number
    required: true
    min: 100
  - id: tradeMethod
    label: 거래방법
    type: multiselect
    options: [직접거래, 우편/우체국, 게임내전달, 코드전송]
    required: true
  - id: description
    label: 상세설명
    type: textarea
    maxLength: 2000
  - id: images
    label: 이미지
    type: image[]
    max: 8
  - id: contactPreference
    label: 선호 연락 수단
    type: select
    options: [채팅, 게임내우편]
    default: 채팅
```

## 3. 카테고리별 폼

### 3.1 아이템 (`ITEM`)

```yaml
- id: characterName
  label: 캐릭터명(인계용)
  type: text
- id: itemName
  label: 아이템명
  type: text
  required: true
- id: itemGrade
  label: 등급
  type: select
  options: [일반, 고급, 희귀, 영웅, 전설, 신화]
- id: enhanceLevel
  label: 강화 수치
  type: number
  min: 0
  max: 30
- id: options
  label: 부가 옵션
  type: tag[]   # 예: ["치명타+12%", "쿨감-5%"]
- id: quantity
  label: 수량
  type: number
  default: 1
- id: tradable
  label: 거래 가능 횟수 남음
  type: number
```

### 3.2 게임머니 (`MONEY`)

```yaml
- id: unit
  label: 거래 단위
  type: select
  options: ["1만", "10만", "100만", "1억"]
  required: true
- id: quantity
  label: 보유 수량(단위 적용)
  type: number
  required: true
- id: minOrder
  label: 최소 거래 단위
  type: number
  default: 1
- id: unitPrice
  label: 단위당 단가(원)
  type: number
  required: true
- id: deliveryWindow
  label: 인계 가능 시간대
  type: text
  placeholder: "평일 18~24시"
```

### 3.3 계정 (`ACCOUNT`)

```yaml
- id: charLevel
  label: 대표 캐릭터 레벨
  type: number
- id: charClass
  label: 직업/클래스
  type: text
- id: combatPower
  label: 전투력/스펙 점수
  type: text
- id: keyItems
  label: 주요 보유 아이템
  type: tag[]
- id: accountAgeMonths
  label: 계정 사용 개월
  type: number
- id: emailLinked
  label: 이메일 변경 가능
  type: checkbox
- id: handoverMethod
  label: 인계 방법
  type: select
  options: [이메일변경+계정정보전달, 본인양도신청서, 게임사 공식 양도]
  required: true
- id: warningAccepted
  label: 게임사 약관 위반 위험 고지 확인
  type: checkbox
  required: true
```

> ⚠️ 계정 거래는 게임사 약관에 따라 **금지되는 경우**가 있어, 등록 시 게임별 정책 배지 노출 + 사용자 동의 게이트.

### 3.4 상품권 (`GIFT_CARD`)

```yaml
- id: giftType
  label: 상품권 종류
  type: select
  options: [문화상품권, 게임문화상품권, 컬쳐랜드, 해피머니, 넥슨캐시, 스팀카드, 구글기프트, 애플기프트, 기타]
  required: true
- id: faceValue
  label: 액면가(원)
  type: number
  required: true
- id: quantity
  label: 수량
  type: number
  default: 1
- id: expiresAt
  label: 유효기간(만료일)
  type: date
- id: purchasePath
  label: 구입 경로
  type: select
  options: [직접구매, 선물수령, 기타]
- id: codeMaskNotice
  label: "안전을 위해 코드는 거래 합의 후 전달하세요"
  type: notice   # 안내 텍스트, 입력값 없음
```

> ⚠️ 채팅 메시지에 상품권 코드 패턴 발견 시 자동 마스킹·신고 권장 토스트.

## 4. 검증/저장 규칙

- `Listing.attributes` (Json)에 카테고리 키 + 필드값을 저장한다. 예:
  ```json
  {
    "category": "MONEY",
    "values": {
      "unit": "1만",
      "quantity": 500,
      "unitPrice": 1100,
      "deliveryWindow": "평일 19-24"
    }
  }
  ```
- 백엔드는 게임 스키마를 다시 로드해 **서버에서 한 번 더 검증**(클라 변조 방지).
- `attributes.values` 중 검색에 자주 쓰는 키는 별도 컬럼으로 비정규화(예: `serverId`, `unitPriceForSort`).

## 5. 어드민에서 게임 추가하기

1. 어드민 → "게임 등록" → 슬러그/이름/서버 목록.
2. 카테고리별 활성 여부 체크(예: 메이플은 캐릭터 양도 OFF).
3. 카테고리별 필드 스키마 편집(JSON 또는 폼 빌더).
4. 미리보기 → 저장 → 즉시 사용자에게 노출.

## 6. 1차 출시 게임 (제안)

| 우선순위 | 게임 | 활성 카테고리 | 비고 |
|---|---|---|---|
| 1 | 로스트아크 | 게임머니/아이템/계정 | 거래 수요 큼, 골드 단위 명확 |
| 1 | 메이플스토리 | 게임머니/아이템 | 계정 거래는 게임사 정책상 비활성 |
| (공통) | 상품권 | 상품권 카테고리 단일 | 게임 무관 |

> 위 두 게임은 약관 검토 후 확정. 계정 거래 활성 여부는 게임별 토글.
