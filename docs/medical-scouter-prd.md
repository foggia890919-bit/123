# Medical Scouter Platform — PRD v2

> 의약품 유통업체가 자체 메디컬 빌딩을 시행·운영하기 위해 필요한
> "입지 발굴 → 가설계 → 사업 수지 → 처방·공급 매출 시뮬레이션" 통합 플랫폼.

본 문서는 두 가지 대화 기록을 통합한 결과물이다:
- (a) Claude Code 세션 — 네이버 매물 크롤러, MOLIT/R-ONE/SBIZ 연동, 매물 평가 엔진까지 구현 완료.
- (b) Gemini 세션 — 토지·건축 가설계, 처방 데이터, 빅데이터(유동·카드·통신) 결합 아이디어.

핵심 차별화: **"건물"이 아니라 "약의 흐름"으로 입지를 본다.**
일반 시행 플랫폼이 답하지 못하는 질문 — *"이 자리에 메디컬 빌딩을 지으면, 처방 매출이
얼마나 발생하고, 우리 유통망으로 공급할 약의 볼륨은 얼마인가?"* — 에 답하는 게 목표.

---

## 0. 비즈니스 정체성

| 항목 | 내용 |
|---|---|
| 운영 주체 | 의약품 유통업체 (자체 사용 + 향후 외부 시행사 SaaS 확장 고려) |
| 1차 사용자 | 본인 (사업주 / 의사결정권자) |
| 2차 사용자 | 시행 PM, 임차 의사, 약국 운영자 |
| 차별화 자산 | 자체 의약품 공급 데이터 (지역별 약국 납품량) |
| 운영 모드 | (i) 자동 매물 발굴·알림 + (ii) 후보지 입력 시 즉시 수지 분석 |

### 단계별 시나리오

1. **모니터링** — 관심 지역(대단지 입주 예정지 인근)의 매물을 24/7 추적.
2. **발굴** — AI 스카우팅: 신규 분양·입주 공고 → 주동선 필지 자동 후보군화.
3. **검토** — 지번 입력 → 가설계(최대 연면적·층수·주차) + 수지(대출·이익) + 처방수요 + 공급매출.
4. **섭외** — 매칭된 매물의 중개사 접촉 (※ 본인이 직접 연락. 자동 광고 발송 금지).
5. **입찰/계약** → **시행** → 운영 단계에서 임차 의사에게 약국 자리 + 처방 데이터 협업 제공.

---

## 1. 데이터 카탈로그 (무료 vs 유료)

### 1-A. 무료 / 공공 / Open API ⭐ MVP 1차 통합 대상

| 카테고리 | 데이터셋 | 출처 | 현재 상태 |
|---|---|---|---|
| **부동산 매물** | 매물·중개사 정보 | 네이버부동산 (크롤링) | ✅ 구현됨 |
| **실거래가** | 매매 (상업업무용·아파트·오피스텔·단독·연립·토지) | data.go.kr (RTMS) | ✅ |
| **실거래가** | 전월세 (아파트·오피스텔·단독·연립) | data.go.kr (RTMS) | ✅ |
| **임대시세 통계** | 오피스/상가 cap rate, 공실률, 단가(원/㎡) | data.go.kr R-ONE | ✅ |
| **상권 점포** | 행정동별 업종·점포·의료기관 분포 | data.go.kr 소상공인 상권정보 | ✅ |
| **토지이용계획** | 용도지역/지구/구역, 지적도 | V월드 (vworld.kr) | 🔲 Phase 3 |
| **건축물대장** | 기존 건물의 건폐율·용적률·층수·구조 | data.go.kr 건축물대장 | 🔲 Phase 3 |
| **개별공시지가** | 필지별 공시지가 시계열 | data.go.kr | 🔲 Phase 3 |
| **도로명주소 / PNU** | 지번 ↔ 좌표 ↔ 행정동코드 변환 | 행정안전부 / V월드 | 🔲 Phase 3 |
| **분양·청약** | 입주 예정 단지·세대수·평형 | 청약홈 / LH OpenAPI | 🔲 Phase 4 |
| **지구단위계획** | 정비구역, 재개발 예정 | data.go.kr 도시계획 | 🔲 Phase 4 |
| **처방·진료** | 행정동·진료과별 환자수·처방건수 | 심평원(HIRA) 보건의료빅데이터 | 🔲 Phase 5 |
| **의약품 사용** | 성분별 처방량 통계 | 심평원 의약품사용정보 | 🔲 Phase 5 |
| **의료기관 개·폐업** | 개원·폐업·이전 이력, 전문과목, 보유장비 | 심평원 / 건강보험공단 | 🔲 Phase 5 |
| **인구통계** | 행정동 단위 성·연령 인구 | 행안부 주민등록통계 | 🔲 Phase 4 |
| **유동인구(공공)** | 지하철 시간대별 승하차 | 서울 열린데이터 광장 | 🔲 Phase 6 |
| **유동인구(공공)** | 시내·광역버스 정류장 승하차 | 서울 / 수도권 / TOPIS | 🔲 Phase 6 |
| **지도/길찾기** | 도보 경로, 주변 시설 | 카카오맵·네이버맵 (개발자 등록 무료 한도) | 🔲 Phase 3 |
| **검색 트렌드** | 지역+질환 키워드 관심도 | 네이버 데이터랩 / Google Trends | 🔲 Phase 6 |

### 1-B. 유료 / 민간 / 신청 승인

| 카테고리 | 데이터셋 | 공급사 | 가격 성격 |
|---|---|---|---|
| **유동인구 정밀** | 50m 격자 시간대별 성·연령·체류 | SKT 지오비전 Manda, KT 빅데이터 마켓 | 정액 또는 건당 |
| **카드 소비** | 업종별 평균 결제·시간대·연령대 | 신한카드 MyData·삼성카드·BC카드 | 정액 / 컨설팅 형태 |
| **신용·소득 추정** | 행정동별 평균 소득·자산·소비성향 | NICE·KCB | 정액 |
| **통신사 이동** | 정밀 OD(출발-도착) 매트릭스 | SKT·KT pCell | 고가 |
| **민간 부동산** | 토지·건물 통합 실거래·호가, 가설계 | 밸류맵, 디스코, 부동산플래닛 | API 정액 |
| **AI 가설계** | 필지 입력 → 최적 매싱·수익률 | 랜드북(스페이스워크), 플랜잇(텐일레븐), 하우즈 | API/SaaS |
| **국세청 매출** | 사업자 단위 부가세 신고 (간접) | KDX 데이터마켓 등 | 가공 데이터 형태로만 |

### 1-C. 자체 보유 데이터 (가장 강력한 차별화)

| 항목 | 활용 |
|---|---|
| 약국별 월 의약품 공급량·매출·결제 | 입지별 "기대 공급 매출" 추정 회귀모델 학습 |
| 처방 트렌드 (진료과·성분 단위) | 신규 입지 진료과 추천 |
| 거래 약국 폐·개업 시점 이력 | 신도시 데드존 패턴 학습 |

---

## 2. 시스템 아키텍처

### 2-1. 전체 그림

```
                       ┌─────────────────────────────┐
                       │   Next.js 15 (Vercel)       │
   사용자 ─────────▶│   /realestate ── 매물·평가  │
                       │   /scouter   ── 입지 발굴   │  (신규)
                       │   /landplan  ── 가설계      │  (신규)
                       └─────────────┬───────────────┘
                                     │ REST/JSON
                       ┌─────────────▼───────────────┐
                       │  PostgreSQL (Supabase)      │
                       │  + PostGIS 확장 (좌표·면적)  │  (신규)
                       └─────┬─────────────────┬─────┘
                             ▲                 ▲
                             │ 적재             │ 조회
                       ┌─────┴─────────────────┴─────┐
                       │  Worker (Lightsail/EC2)     │
                       │  Node.js + Playwright       │
                       │  ┌───────────────────────┐  │
                       │  │ Naver scraper (✅)    │  │
                       │  │ MOLIT / R-ONE / SBIZ  │  │
                       │  │ V월드 / 건축물대장    │  │
                       │  │ 심평원 / 청약홈       │  │
                       │  │ 카카오·네이버맵       │  │
                       │  │ Massing 엔진          │  │
                       │  │ Valuation 엔진 (✅)   │  │
                       │  │ Scoring 엔진          │  │
                       │  └───────────────────────┘  │
                       └─────────────────────────────┘

알림: 본인 SMS(Coolsms) / 텔레그램 — 본인 수신 전용
```

### 2-2. 기술 스택 결정 사항

| 레이어 | 채택 | 사유 |
|---|---|---|
| Frontend | **Next.js 16 + Tailwind + shadcn** | 기존 프로젝트 연속성. SSR + 빠른 프로토타이핑. |
| Backend (light) | Next.js Route Handlers | 단순 CRUD·조회 |
| Backend (heavy) | Node.js Worker (Lightsail) | Playwright 크롤러는 Vercel 불가 |
| DB | PostgreSQL (Supabase) | 기존 + **PostGIS** 추가 (필지 폴리곤 공간연산) |
| 3D 시각화 | **Three.js / react-three-fiber** | 매싱 결과 웹에서 즉시 렌더 |
| 지도 | **Kakao Map + V월드 WMS 오버레이** | 한국 지번 검색은 카카오 우월 |
| 스케줄러 | Vercel Cron (위임만) + Lightsail systemd 타이머 | Phase별 배치 |
| Secret 관리 | `.env` (운영은 Vercel/Lightsail Env) | 기존 패턴 유지 |

---

## 3. 모듈 로드맵

### ✅ Phase 1 — 매물 모니터·알림 (완료)

| 모듈 | 파일 |
|---|---|
| Naver 부동산 크롤러 | `src/realestate/naver/scraper.ts` |
| 매물·중개사 저장 | `src/realestate/storage.ts` |
| 워치 매칭·알림 (SMS/텔레그램) | `src/realestate/match.ts`, `notify.ts` |
| 뷰어·워치 관리 UI | `src/app/realestate/*` |

### ✅ Phase 2 — 시세 분석 + 사업 수지 (완료)

| 모듈 | 파일 |
|---|---|
| MOLIT 실거래가 (10개 엔드포인트) | `src/realestate/molit/client.ts` |
| R-ONE 임대동향 | `src/realestate/rone/client.ts` |
| 소상공인 상권정보 | `src/realestate/sbiz/client.ts` |
| 평가 엔진 (cap rate × 매매가 → 임대료·대출·ROI) | `src/realestate/valuation.ts` |
| 평가 UI | `src/app/realestate/valuation` |

### 🔲 Phase 3 — 토지·가설계 엔진 (다음 작업)

| 모듈 | 신규 파일 (제안) | API |
|---|---|---|
| 지번 → PNU·좌표 변환 | `src/realestate/land/geocode.ts` | V월드 + 카카오 로컬 |
| 토지이용계획 (용도지역·지구) | `src/realestate/land/landuse.ts` | V월드 토지정보 |
| 건축물대장 | `src/realestate/land/building.ts` | data.go.kr 건축HUB |
| 개별공시지가 | `src/realestate/land/price.ts` | data.go.kr |
| 매싱(가설계) 엔진 | `src/realestate/land/massing.ts` | 자체 |

#### Massing 알고리즘 (핵심 공식)

```
대지면적 A (㎡) — V월드 토지정보에서 취득
용도지역 → 건폐율(BCR%), 용적률(FAR%) 룩업

기초 산출:
  최대건축면적 = A × BCR / 100
  최대연면적   = A × FAR / 100
  최대층수     = floor(최대연면적 / 최대건축면적)

메디컬 빌딩 보정:
  층고 = 4.2m (수술실·MRI 가능 가정)
  주차대수 = ceil(연면적 / 100㎡) × 1.5  # 의료시설 표준
  지하층수 = ceil(주차대수 / 한 층 주차가능대수)
  엘리베이터 = ceil(층수 / 4) (침대용 ≥1대)

일조권 사선 제한 (전용·일반주거):
  9m까지 1.5m 이격, 9m초과 분 H/2 이격
  → 북쪽 인접지 거리 분석으로 가능 층수 추가 보정

주차장법 시행령 제6조 별표 1:
  근생 1종 (병원/의원) — 시설면적 100㎡당 1대 (지자체 조례로 가산)
```

### 🔲 Phase 4 — 분양·입주 예정지 트래킹

| 모듈 | API |
|---|---|
| 청약홈 분양공고 RSS·파싱 | applyhome.co.kr 비공식 + LH OpenAPI |
| 도시계획 정비구역 | V월드 도시계획 |
| 행안부 주민등록인구 (월/연) | data.go.kr |
| 신규 단지 ↔ 인접 필지 매칭 | PostGIS ST_DWithin |

→ 산출물: **"이 단지 입주 1년 전, 정문 반경 300m 내 매매 가능 토지"** 자동 리스트.

### 🔲 Phase 5 — 처방수요·의료기관 분석

| 모듈 | API |
|---|---|
| 행정동 진료과별 처방건수 | 심평원 보건의료빅데이터 |
| 의약품 성분 처방량 | 심평원 의약품사용정보 |
| 의료기관 개·폐업 | 심평원 / 건보공단 / 식약처 |

#### 처방 점수 (Prescription Score)

```
PS = (배후세대수 × 평균인구/세대 × 인당연처방횟수) / 반경500m_경쟁의원수

세분화:
  진료과별 PS_i = (인구피라미드 × 진료과별처방률) / 진료과경쟁의원수
  → 추천 MD 구성: argmax_i (PS_i × 평균진료수가)
```

### 🔲 Phase 6 — 빅데이터 융합·AI 스카우팅

| 데이터 | 처리 |
|---|---|
| 지하철·버스 OD | 단지 → 후보필지 보행 동선 가중치 |
| 카드 소비 (유료) | **P-Index** = 비급여 진료 잠재 매출 |
| 통신사 유동인구 (유료) | 시간대별 진료시간 맞춤 점수 |
| 검색 트렌드 (네이버 데이터랩) | "○○동 + 진료과" 관심도 시계열 |

#### 종합 입지 점수 (Composite Score)

```
Composite = w1·PrescriptionScore
          + w2·TrafficFlow      (지하철·버스)
          + w3·PIndex           (카드 비급여)
          + w4·VacancyPenalty   (R-ONE 공실률)
          + w5·SupplyAdvantage  (자체 약국 납품 지표)
          + w6·BuildableROI     (Phase 2 ROI)

기본 가중치 (논의 후 튜닝):
  w1=0.30  w2=0.15  w3=0.15  w4=0.10  w5=0.20  w6=0.10
```

### 🔲 Phase 7 — 3D 시각화 + 보고서

- Three.js로 매싱 결과 인터랙티브 렌더
- 일일 PDF 보고서 (분석 대상 매물 + 점수 + 추천 MD + 수지표)
- 카카오 알림톡 템플릿 등록 → 결재용 요약 발송

---

## 4. Phase 3 우선 작업 — Claude Code 핸드오프 지시서

다음 세션에서 가장 먼저 손댈 부분이다. 5단계로 쪼개서 순차 실행.

### Step 3-1. 환경 변수 + DB 스키마

```bash
# .env 추가
VWORLD_API_KEY=          # vworld.kr 인증키 (무료)
KAKAO_REST_API_KEY=      # 카카오 디벨로퍼스
BUILDING_HUB_KEY=        # data.go.kr 건축HUB (MOLIT_SERVICE_KEY 재사용 가능)
```

```sql
-- prisma/migrations/manual/add_land_info.sql
CREATE TABLE "Parcel" (
  id TEXT PRIMARY KEY,
  pnu TEXT UNIQUE,                  -- 19자리 필지고유번호
  jibun TEXT,                       -- "서울특별시 강남구 역삼동 825-22"
  cortarNo TEXT,
  area DOUBLE PRECISION,            -- 대지면적 ㎡
  landUse TEXT,                     -- 용도지역 (제2종일반주거 등)
  landUseDistrict TEXT,             -- 용도지구
  bcrLimit DOUBLE PRECISION,        -- 법정 건폐율 %
  farLimit DOUBLE PRECISION,        -- 법정 용적률 %
  officialPrice INTEGER,            -- 공시지가 원/㎡
  geom JSONB,                       -- GeoJSON Polygon
  fetchedAt TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE "BuildingLedger" (
  id TEXT PRIMARY KEY,
  pnu TEXT,
  bldgNm TEXT,
  totalFloorArea DOUBLE PRECISION,  -- 연면적
  buildArea DOUBLE PRECISION,       -- 건축면적
  bcr DOUBLE PRECISION,             -- 실제 건폐율
  far DOUBLE PRECISION,
  groundFloors INT,
  undergroundFloors INT,
  mainPurpose TEXT,
  approvedAt TIMESTAMPTZ,
  raw JSONB,
  fetchedAt TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE "MassingResult" (
  id TEXT PRIMARY KEY,
  parcelId TEXT REFERENCES "Parcel"(id),
  scenario TEXT,                    -- "medical-default" 등
  maxBuildArea DOUBLE PRECISION,
  maxFloorArea DOUBLE PRECISION,
  maxFloors INT,
  parkingRequired INT,
  basementFloors INT,
  netRentableArea DOUBLE PRECISION,  -- 전용률 0.7 가정
  estimatedConstructionCost INTEGER, -- 만원 (평당단가 × 평수)
  notes TEXT[],
  createdAt TIMESTAMPTZ DEFAULT now()
);
```

### Step 3-2. V월드 클라이언트

```ts
// src/realestate/land/vworld.ts
// V월드 API 종류:
//   - /req/data?service=data&request=GetFeature&data=LP_PA_CBND_BUBUN  (지적)
//   - /req/data?service=data&data=LT_C_LHBLPN                          (용도지역)
//   - /coord/transform                                                 (좌표 변환)
// 인증키 필수, JSON/XML 둘 다 지원.
```

요구사항:
- `geocodeJibun(jibun): Promise<{pnu, lat, lng}>`
- `getParcelGeometry(pnu): Promise<GeoJSONPolygon>`
- `getLandUse(pnu): Promise<{landUse, district, bcrLimit, farLimit}>`
- 건폐율·용적률은 V월드가 직접 주지 않으므로 **용도지역 → 법정 한도 매핑 테이블** 별도 (`src/realestate/land/zoning.ts`).

### Step 3-3. 건축HUB 클라이언트

```ts
// src/realestate/land/buildingLedger.ts
// data.go.kr "국토교통부_건축HUB_건축물대장정보 서비스"
//   - getBrTitleInfo(표제부): 연면적, 건폐율, 용적률, 층수
//   - getBrFlrOulnInfo(층별): 층별 면적·용도
```

### Step 3-4. 매싱 엔진

```ts
// src/realestate/land/massing.ts
export interface MassingScenario {
  parcelId: string;
  buildingType: "medical" | "office" | "mixed";
  floorHeight: number;     // 4.2 (medical default)
  efficiency: number;      // 전용률 0.7
  parkingRule: "medical" | "office";
}

export interface MassingResult {
  maxBuildArea: number;    // ㎡ = area × bcrLimit/100
  maxFloorArea: number;    // ㎡ = area × farLimit/100
  maxFloors: number;
  groundFloors: number;
  basementFloors: number;
  parkingRequired: number;
  netRentableArea: number;
  notes: string[];
}

export function compute(parcel, scenario): MassingResult { ... }
```

규칙 (`src/realestate/land/zoning.ts`):

| 용도지역 | BCR | FAR |
|---|---|---|
| 제1종전용주거 | 50 | 100 |
| 제2종전용주거 | 50 | 150 |
| 제1종일반주거 | 60 | 200 |
| 제2종일반주거 | 60 | 250 |
| 제3종일반주거 | 50 | 300 |
| 준주거 | 70 | 500 |
| 일반상업 | 80 | 1300 (서울 기준) |
| 근린상업 | 70 | 900 |
| 유통상업 | 80 | 1100 |
| 중심상업 | 90 | 1500 |

> 주의: 위는 **국토계획법 한도**이고 실제 적용은 **각 지자체 도시계획조례**가 더 엄격할 수 있음. 서울·경기·인천 우선 하드코딩, 그 외는 V월드 도시계획속성정보로 fallback.

### Step 3-5. UI

`/realestate/landplan` 페이지:
1. 지번/도로명 입력 → 지도 위 폴리곤 강조
2. 사이드 패널: 대지면적·용도·BCR/FAR·공시지가
3. "메디컬 빌딩 매싱" 버튼 → 결과 + 3D 박스 렌더링
4. "수지 분석" 버튼 → 기존 `valuation.ts` 호출, 매매가 입력 받아 결과 표시

---

## 5. Phase별 KPI · 검증 기준

| Phase | 1차 KPI | 검증 |
|---|---|---|
| 1 매물 알림 | 워치 매칭 정확도 ≥ 90% | 수동 샘플링 30건 |
| 2 평가 엔진 | 추정 월세 ↔ 실제 호가 오차 ±20% 이내 | 실제 매물 50건 검증 |
| 3 가설계 | 법정 BCR·FAR 적용 정확도 100% | 시군구 5곳 × 10필지 |
| 4 입주 트래킹 | 입주 90일 전 매물 자동 리스트업 | 강남·송파·하남 등 신축 분양지 |
| 5 처방 수요 | 진료과 추천 ↔ 실제 입점 의사 매칭률 | 정성 평가 |
| 6 종합 점수 | 후보 Top 10 중 사업주 결심률 ≥ 30% | 실제 의사결정 |

---

## 6. 법적 / 윤리적 가드레일

- **네이버 크롤링** — 약관상 자동수집 금지. 개인 사용 한정, 폴링 ≥3초, 동시접속 1로 제한.
- **개인정보보호법·정보통신망법** — 수집한 중개사·약국·병원 연락처를 **동의 없이** 광고 발송 금지. 알림은 본인 수신용으로만. 제3자에게 정보 노출하는 외부 SaaS화 시점에는 별도 법률 자문 필수.
- **심평원 보건의료빅데이터** — 비식별 통계만 사용. 개별 환자 데이터 접근 금지.
- **카드사·통신사 데이터** — 모두 비식별·집계 상품으로 한정. 개별 결제 추적 시도 금지.
- **자체 약국 공급 데이터** — 거래처 식별 정보는 내부 DB에만 보관, UI에는 집계만 노출.

---

## 7. 비용 추정 (월 운영)

| 항목 | 비용 (KRW/월) | 비고 |
|---|---|---|
| Vercel Pro | ~25,000 | 1인 |
| Supabase Free → Pro 전환 | 0 → 35,000 | 데이터 50GB 시 Pro |
| Lightsail (4GB / 2vCPU) | ~25,000 | 워커 |
| Coolsms (1,000건 가정) | ~10,000 | 알림 |
| 공공 API | 0 | data.go.kr |
| V월드 / 카카오맵 | 0 | 무료 한도 충분 |
| **소계 (Phase 1–5)** | **~95,000** | |
| 카드사 빅데이터 (옵션) | 500,000~2,000,000 | 정액제 |
| 통신사 유동인구 | 500,000~3,000,000 | 패키지 |

→ Phase 5까지는 월 10만 원 이하로 운영 가능.

---

## 8. 다음 단계 액션 아이템

| # | 액션 | 담당 | 비고 |
|---|---|---|---|
| 1 | data.go.kr에서 V월드 + 건축HUB API 활용 신청 | 사업주 | 즉시 승인 |
| 2 | 카카오 디벨로퍼스 앱 등록 (REST API 키) | 사업주 | 5분 |
| 3 | Phase 3 Step 3-1 ~ 3-5 구현 | Claude Code | 다음 세션 |
| 4 | 서울시 5개 시범 지역 선정 (분양 예정지) | 사업주 | 강남·송파·마포·하남·동탄 후보 |
| 5 | 자체 약국 공급 데이터 스키마 정의 | 사업주 + Claude Code | Phase 5 전제 |

---

## Appendix A. 이미 구현된 모듈 인덱스

```
src/realestate/
  naver/scraper.ts       ✅ Phase 1
  storage.ts             ✅
  match.ts               ✅
  notify.ts              ✅
  molit/client.ts        ✅ Phase 2
  molit/sync.ts          ✅
  rone/client.ts         ✅
  rone/sync.ts           ✅
  sbiz/client.ts         ✅
  sbiz/sync.ts           ✅
  valuation.ts           ✅
  run.ts                 ✅
  README.md
src/app/realestate/
  page.tsx               ✅ 매물 뷰어
  watches/page.tsx       ✅ 워치 관리
  valuation/page.tsx     ✅ 평가
src/app/api/realestate/
  listings/route.ts
  watches/route.ts
  molit/route.ts
  valuation/route.ts
src/app/api/cron/realestate-poll/route.ts
prisma/migrations/manual/
  add_real_estate.sql
  add_real_estate_stats.sql
```

## Appendix B. CLI 치트시트

```bash
# 매물
npm run re:scrape   -- --watches
npm run re:detail   -- <articleNo>

# 실거래
npm run re:molit    -- --endpoint commercialSale --lawd 11680 --months 12
npm run re:molit    -- --endpoint apartmentRent  --lawd 11680 --months 12

# 시세 통계
npm run re:rone
npm run re:sbiz     -- --cortar 1168010100

# 평가
npm run re:valuate  -- --listing <REListing.id>
npm run re:valuate  -- --lawd 11680 --cap 4 --months 12

# (다음 단계 예정)
npm run re:land     -- --jibun "서울특별시 강남구 역삼동 825-22"
npm run re:massing  -- --pnu 1168010100... --type medical
```
