# Document Intelligence Pipeline — 샘플 처리 리포트

각 샘플별 전처리/추출/검증/ground-truth 대조 결과 통합 대시보드.

## 요약

| 샘플 | 회전 | Source | Perspective | Template | 시도 | 신뢰도 | 검수필요 |
|---|---|---|---|---|---|---|---|
| 01_paper_rotated.jpg | 90° | photo | fallback_too_small | pharmacy_stats_kr | 1 | 1.00 | 아니오 |
| 02_screenshot_clean.jpg | 0° | screenshot | skipped | pharmacy_stats_kr | 1 | 1.00 | 아니오 |
| 03_monitor_photo.jpg | 90° | photo | fallback_too_small | pharmacy_stats_kr | 1 | 1.00 | 아니오 |
| 04_paper_watermark.jpg | 0° | photo | fallback_partial | pharmacy_stats_kr | 1 | 1.00 | 아니오 |
| 05_monitor_skewed.jpg | 0° | photo | fallback | pharmacy_stats_kr | 1 | 1.00 | 아니오 |

---

## 01_paper_rotated.jpg

**전처리 노트**:
  - orientation: 90도 자동 회전
  - perspective: fallback_too_small → 원본 사용

### 필드별 추출/검증

| 필드 | 상태 | 값 | conf | 비고 |
|---|---|---|---|---|
| period_start | OK | `2026-04-01` | — |  |
| period_end | OK | `2026-04-30` | — |  |
| hospital_name | OK | `사상제일의원` | — |  |
| hospital_biz_no | OK | `113-96-03529` | — |  |
| prescriber_name | OK | `정의일` | — |  |
| pharma_company | OK | `(주)서흥약품 | 제일약품(주)` | — |  |
| drugs | OK | `[{}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}]` | — |  |
| summary_total_amount | OK | `1662681` | — |  |

### 논리/산술 검증

- [PASS] `row_arith(drugs, ['unit_price', 'total_qty']mul=total_amount)` — 전 14행 통과 (허용오차 1)

### Ground-truth 대조

**Summary 필드 차이**:

| 필드 | 기대값 | 추출값 |
|---|---|---|
| period_start | `2026-04-01` | `2026.04.01` |
| period_end | `2026-04-30` | `2026.04.30` |
| hospital_name | `신목제일의원` | `사상제일의원` |
| prescriber_name | `None` | `정의일` |
| pharma_company | `정우신약` | `(주)서흥약품 | 제일약품(주)` |
| summary_total_amount | `1662681` | `1,662,681` |

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
| drugs | OK | `[{}]` | — |  |
| summary_total_amount | OK | `578686` | — |  |

### 논리/산술 검증

- [PASS] `row_arith(drugs, ['unit_price', 'total_qty']mul=total_amount)` — 전 1행 통과 (허용오차 1)

### Ground-truth 대조

**Summary 필드 차이**:

| 필드 | 기대값 | 추출값 |
|---|---|---|
| pharma_company | `위더스제약` | `위더스제약(주)` |
| summary_total_amount | `578686` | `578,686` |

- 약품 행 수: 기대 `4`, 추출 `1`

---

## 03_monitor_photo.jpg

**전처리 노트**:
  - orientation: 90도 자동 회전
  - perspective: fallback_too_small → 원본 사용

### 필드별 추출/검증

| 필드 | 상태 | 값 | conf | 비고 |
|---|---|---|---|---|
| period_start | OK | `2020-04-01` | — |  |
| period_end | OK | `2020-04-30` | — |  |
| hospital_name | OK | `김안과내과의원` | — |  |
| hospital_biz_no | OK | `410-90-65803` | — |  |
| prescriber_name | OK | `전체` | — |  |
| pharma_company | OK | `테라젠이텍스` | — |  |
| drugs | OK | `[{}]` | — |  |
| summary_total_amount | OK | `1399306` | — |  |

### 논리/산술 검증

- [PASS] `row_arith(drugs, ['unit_price', 'total_qty']mul=total_amount)` — 전 1행 통과 (허용오차 1)

### Ground-truth 대조

**Summary 필드 차이**:

| 필드 | 기대값 | 추출값 |
|---|---|---|
| period_start | `2026-04-01` | `2020-04-01` |
| period_end | `2026-04-30` | `2020-04-30` |
| hospital_name | `강남대보의원` | `김안과내과의원` |
| hospital_biz_no | `419-90-65803` | `410-90-65803` |
| prescriber_name | `None` | `전체` |
| pharma_company | `세아엔영약(주)` | `테라젠이텍스` |
| summary_total_amount | `11309366` | `1,399,306` |

- 약품 행 수: 기대 `35`, 추출 `1`

---

## 04_paper_watermark.jpg

**전처리 노트**:
  - perspective: fallback_partial → 원본 사용

### 필드별 추출/검증

| 필드 | 상태 | 값 | conf | 비고 |
|---|---|---|---|---|
| period_start | OK | `2026-04-01` | — |  |
| period_end | OK | `2026-04-30` | — |  |
| hospital_name | OK | `배재천신경과의원` | — |  |
| hospital_biz_no | OK | `221-90-46977` | — |  |
| prescriber_name | OK | `배재천` | — |  |
| pharma_company | OK | `(주)경보제약` | — |  |
| drugs | OK | `[{}]` | — |  |
| summary_total_amount | OK | `29040` | — |  |

### 논리/산술 검증

- [PASS] `row_arith(drugs, ['unit_price', 'total_qty']mul=total_amount)` — 전 1행 통과 (허용오차 1)

### Ground-truth 대조

**Summary 필드 차이**:

| 필드 | 기대값 | 추출값 |
|---|---|---|
| prescriber_name | `None` | `배재천` |
| summary_total_amount | `29040` | `29,040` |

- 약품 행 수: 기대 `2`, 추출 `1`

---

## 05_monitor_skewed.jpg

**전처리 노트**:
  - perspective: fallback → 원본 사용

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

- [PASS] `row_arith(drugs, ['unit_price', 'total_qty']mul=total_amount)` — 전 3행 통과 (허용오차 1)

### Ground-truth 대조

**Summary 필드 차이**:

| 필드 | 기대값 | 추출값 |
|---|---|---|
| summary_total_amount | `209600` | `209,600` |

- 약품 행 수: 기대 `3`, 추출 `3`
