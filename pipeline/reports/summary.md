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
| period_start | OK | `2026-04-01` | 0.70 |  |
| period_end | OK | `2026-04-30` | — |  |
| hospital_name | OK | `신목제일의원` | 1.00 |  |
| hospital_biz_no | OK | `113-96-03529` | 1.00 |  |
| prescriber_name | OK | `—` | — |  |
| pharma_company | OK | `정우신약` | 1.00 |  |
| drugs | OK | `[{'drug_code': '645400190', 'drug_name': '닥소토닐캡', 'unit_p...` | 0.55 |  |
| summary_total_amount | OK | `1662681` | — |  |

### 논리/산술 검증

- [PASS] `row_arith(drugs, ['unit_price', 'total_qty']mul=total_amount)` — 전 12행 통과 (허용오차 1)

### Ground-truth 대조

- Summary 필드: 모두 일치 ✓

- 약품 행 수: 기대 `14`, 추출 `12`
- 모든 행 산술 통과 ✓

---

## 02_screenshot_clean.jpg

**전처리 노트**:
  - source: 스크린샷 감지 (score=1.0) → perspective/shadow 비활성

### 필드별 추출/검증

| 필드 | 상태 | 값 | conf | 비고 |
|---|---|---|---|---|
| period_start | OK | `2026-04-01` | 1.00 |  |
| period_end | OK | `2026-04-30` | — |  |
| hospital_name | OK | `일산365의원` | 1.00 |  |
| hospital_biz_no | OK | `687-90-02484` | 1.00 |  |
| prescriber_name | OK | `이재영` | — |  |
| pharma_company | OK | `위더스제약` | 1.00 |  |
| drugs | OK | `[{'drug_code': '660701210', 'drug_name': '위더스세프라디캡슐500mg'...` | 0.95 |  |
| summary_total_amount | OK | `578686` | — |  |

### 논리/산술 검증

- [PASS] `row_arith(drugs, ['unit_price', 'total_qty']mul=total_amount)` — 전 4행 통과 (허용오차 1)

### Ground-truth 대조

- Summary 필드: 모두 일치 ✓

- 약품 행 수: 기대 `4`, 추출 `4`
- 모든 행 산술 통과 ✓

---

## 03_monitor_photo.jpg

**전처리 노트**:
  - orientation: 90도 자동 회전
  - perspective: fallback_too_small → 원본 사용

### 필드별 추출/검증

| 필드 | 상태 | 값 | conf | 비고 |
|---|---|---|---|---|
| period_start | OK | `2026-04-01` | 0.70 |  |
| period_end | OK | `2026-04-30` | — |  |
| hospital_name | OK | `강남대보의원` | 1.00 |  |
| hospital_biz_no | OK | `419-90-65803` | 1.00 |  |
| prescriber_name | OK | `—` | — |  |
| pharma_company | OK | `세아엔영약(주)` | 1.00 |  |
| drugs | OK | `[{'drug_name': '엑스코랄정5/5/5mg', 'total_qty': 16669.5, 'tot...` | 0.55 |  |
| summary_total_amount | OK | `11309366` | — |  |

### 논리/산술 검증

- [PASS] `row_arith(drugs, ['unit_price', 'total_qty']mul=total_amount)` — 전 1행 통과 (허용오차 1)

### Ground-truth 대조

- Summary 필드: 모두 일치 ✓

- 약품 행 수: 기대 `35`, 추출 `1`

---

## 04_paper_watermark.jpg

**전처리 노트**:
  - perspective: fallback_partial → 원본 사용

### 필드별 추출/검증

| 필드 | 상태 | 값 | conf | 비고 |
|---|---|---|---|---|
| period_start | OK | `2026-04-01` | 1.00 |  |
| period_end | OK | `2026-04-30` | — |  |
| hospital_name | OK | `배재천신경과의원` | 1.00 |  |
| hospital_biz_no | OK | `221-90-46977` | 1.00 |  |
| prescriber_name | OK | `—` | — |  |
| pharma_company | OK | `(주)경보제약` | 1.00 |  |
| drugs | OK | `[{'drug_code': '665002840', 'drug_name': '아픽솔정2.5mg(내복)',...` | 0.95 |  |
| summary_total_amount | OK | `29040` | — |  |

### 논리/산술 검증

- [PASS] `row_arith(drugs, ['unit_price', 'total_qty']mul=total_amount)` — 전 2행 통과 (허용오차 1)

### Ground-truth 대조

- Summary 필드: 모두 일치 ✓

- 약품 행 수: 기대 `2`, 추출 `2`
- 모든 행 산술 통과 ✓

---

## 05_monitor_skewed.jpg

**전처리 노트**:
  - perspective: fallback → 원본 사용

### 필드별 추출/검증

| 필드 | 상태 | 값 | conf | 비고 |
|---|---|---|---|---|
| period_start | OK | `2026-04-01` | 1.00 |  |
| period_end | OK | `2026-04-30` | — |  |
| hospital_name | OK | `강동천호정형외과` | 1.00 |  |
| hospital_biz_no | OK | `384-98-00322` | 1.00 |  |
| prescriber_name | OK | `원종원` | — |  |
| pharma_company | OK | `영진약품` | 1.00 |  |
| drugs | OK | `[{'drug_code': 'd20past', 'drug_name': '오파스트정(리마프로스트알파덱스)...` | 0.95 |  |
| summary_total_amount | OK | `209600` | — |  |

### 논리/산술 검증

- [PASS] `row_arith(drugs, ['unit_price', 'total_qty']mul=total_amount)` — 전 3행 통과 (허용오차 1)

### Ground-truth 대조

- Summary 필드: 모두 일치 ✓

- 약품 행 수: 기대 `3`, 추출 `3`
- 모든 행 산술 통과 ✓
