# Document Intelligence Pipeline — 샘플 처리 리포트

각 샘플별 전처리/추출/검증/ground-truth 대조 결과 통합 대시보드.

## 요약

| 샘플 | 회전 | Source | Perspective | Template | 시도 | 신뢰도 | 검수필요 |
|---|---|---|---|---|---|---|---|
| 01_paper_rotated.jpg | 90° | photo | vlm(conf=0.98) | pharmacy_stats_kr | 4 | 0.70 | 예 |
| 02_screenshot_clean.jpg | 0° | screenshot | skipped | pharmacy_stats_kr | 4 | 0.70 | 예 |
| 03_monitor_photo.jpg | 90° | photo | vlm(conf=0.95) | pharmacy_stats_kr | 4 | 0.70 | 예 |
| 04_paper_watermark.jpg | 0° | photo | vlm(conf=0.90) | pharmacy_stats_kr | 4 | 0.61 | 예 |
| 05_monitor_skewed.jpg | 0° | photo | fallback_vlm_fallback_too_small | pharmacy_stats_kr | 4 | 0.70 | 예 |

---

## 01_paper_rotated.jpg

**전처리 노트**:
  - orientation: 90도 자동 회전
  - perspective: AI-Assisted Cropping 적용 (vlm(conf=0.98))

### 필드별 추출/검증

| 필드 | 상태 | 값 | conf | 비고 |
|---|---|---|---|---|
| period_start | OK | `2019-12-01` | — |  |
| period_end | OK | `2019-12-31` | — |  |
| hospital_name | OK | `연세소아청소년과의원` | — |  |
| hospital_biz_no | OK | `134-91-95047` | — |  |
| prescriber_name | OK | `김영훈` | — |  |
| pharma_company | OK | `(주)지메디칼약품(주)` | — |  |
| drugs | OK | `[{}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}]` | — |  |
| summary_total_amount | OK | `1662681` | — |  |

### 논리/산술 검증

- [FAIL] `sum_eq(Σdrugs.total_amount)=summary_total_amount` — 행 단위 total_amount 누락 다수 — 행 수가 부족할 가능성

### Ground-truth 대조

**Summary 필드 차이**:

| 필드 | 기대값 | 추출값 |
|---|---|---|
| period_start | `2026-04-01` | `2019-12-01` |
| period_end | `2026-04-30` | `2019-12-31` |
| hospital_name | `신목제일의원` | `연세소아청소년과의원` |
| hospital_biz_no | `113-96-03529` | `134-91-95047` |
| prescriber_name | `None` | `김영훈` |
| pharma_company | `정우신약` | `(주)지메디칼약품(주)` |

- 약품 행 수: 기대 `14`, 추출 `14`

---

## 02_screenshot_clean.jpg

**전처리 노트**:
  - source: 스크린샷 감지 (score=1.0) → perspective/shadow 비활성

### 필드별 추출/검증

| 필드 | 상태 | 값 | conf | 비고 |
|---|---|---|---|---|
| period_start | OK | `2026-04-01` | — |  |
| period_end | OK | `2026-04-30` | — |  |
| hospital_name | OK | `일산365의원` | — |  |
| hospital_biz_no | OK | `687-90-02484` | — |  |
| prescriber_name | OK | `이재영` | — |  |
| pharma_company | OK | `위더스제약(주)` | — |  |
| drugs | OK | `[{}, {}, {}, {}]` | — |  |
| summary_total_amount | OK | `578686` | — |  |

### 논리/산술 검증

- [FAIL] `sum_eq(Σdrugs.total_amount)=summary_total_amount` — 행 단위 total_amount 누락 다수 — 행 수가 부족할 가능성

### Ground-truth 대조

**Summary 필드 차이**:

| 필드 | 기대값 | 추출값 |
|---|---|---|
| pharma_company | `위더스제약` | `위더스제약(주)` |

- 약품 행 수: 기대 `4`, 추출 `4`

---

## 03_monitor_photo.jpg

**전처리 노트**:
  - orientation: 90도 자동 회전
  - perspective: AI-Assisted Cropping 적용 (vlm(conf=0.95))

### 필드별 추출/검증

| 필드 | 상태 | 값 | conf | 비고 |
|---|---|---|---|---|
| period_start | OK | `2026-04-01` | — |  |
| period_end | OK | `2026-04-30` | — |  |
| hospital_name | OK | `연세소아과의원` | — |  |
| hospital_biz_no | OK | `301-90-50346` | — |  |
| prescriber_name | OK | `김진동` | — |  |
| pharma_company | OK | `전체` | — |  |
| drugs | OK | `[{}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, ...` | — |  |
| summary_total_amount | OK | `1309366` | — |  |

### 논리/산술 검증

- [FAIL] `sum_eq(Σdrugs.total_amount)=summary_total_amount` — 행 단위 total_amount 누락 다수 — 행 수가 부족할 가능성

### Ground-truth 대조

**Summary 필드 차이**:

| 필드 | 기대값 | 추출값 |
|---|---|---|
| hospital_name | `강남대보의원` | `연세소아과의원` |
| hospital_biz_no | `419-90-65803` | `301-90-50346` |
| prescriber_name | `None` | `김진동` |
| pharma_company | `세아엔영약(주)` | `전체` |
| summary_total_amount | `11309366` | `1309366` |

- 약품 행 수: 기대 `35`, 추출 `32`

---

## 04_paper_watermark.jpg

**전처리 노트**:
  - perspective: AI-Assisted Cropping 적용 (vlm(conf=0.90))

### 필드별 추출/검증

| 필드 | 상태 | 값 | conf | 비고 |
|---|---|---|---|---|
| period_start | OK | `2026-04-01` | — |  |
| period_end | OK | `2026-04-30` | — |  |
| hospital_name | OK | `제약사별통계-제약사별` | — |  |
| hospital_biz_no | FAIL | `null` | — | biz_no 형식 불일치 |
| prescriber_name | OK | `null` | — |  |
| pharma_company | OK | `(주)경보제약` | — |  |
| drugs | OK | `[{}]` | — |  |
| summary_total_amount | OK | `58080` | — |  |

### 논리/산술 검증

- [FAIL] `sum_eq(Σdrugs.total_amount)=summary_total_amount` — 행 단위 total_amount 누락 다수 — 행 수가 부족할 가능성

### Ground-truth 대조

**Summary 필드 차이**:

| 필드 | 기대값 | 추출값 |
|---|---|---|
| hospital_name | `배재천신경과의원` | `제약사별통계-제약사별` |
| hospital_biz_no | `221-90-46977` | `null` |
| prescriber_name | `None` | `null` |
| summary_total_amount | `29040` | `58080` |

- 약품 행 수: 기대 `2`, 추출 `1`

---

## 05_monitor_skewed.jpg

**전처리 노트**:
  - perspective: fallback_vlm_fallback_too_small → 원본 사용

### 필드별 추출/검증

| 필드 | 상태 | 값 | conf | 비고 |
|---|---|---|---|---|
| period_start | OK | `2026-04-01` | — |  |
| period_end | OK | `2026-04-30` | — |  |
| hospital_name | OK | `강동천호정형외과` | — |  |
| hospital_biz_no | OK | `384-98-00322` | — |  |
| prescriber_name | OK | `원종원` | — |  |
| pharma_company | OK | `영진약품` | — |  |
| drugs | OK | `[{}, {}, {}]` | — |  |
| summary_total_amount | OK | `209600` | — |  |

### 논리/산술 검증

- [FAIL] `sum_eq(Σdrugs.total_amount)=summary_total_amount` — 행 단위 total_amount 누락 다수 — 행 수가 부족할 가능성

### Ground-truth 대조

**Summary 필드 차이**:

| 필드 | 기대값 | 추출값 |
|---|---|---|
| summary_total_amount | `209600` | `209,600` |

- 약품 행 수: 기대 `3`, 추출 `3`
