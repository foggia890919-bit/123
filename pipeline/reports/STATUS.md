# 파이프라인 현재 상태 — 솔직한 보고서

날짜: 2026-05-10

## TL;DR

| 영역 | 상태 |
|---|---|
| 파이프라인 구조 | 완성 (5단계: preprocess → classify → extract → validate → ROI 재추출) |
| 결정론적 검증 (산술/형식/footer) | 동작 확인 |
| 5개 샘플 ground truth | 어시스턴트가 직접 이미지 전사하여 작성 (`samples/ground_truth.json`) |
| VLM 실제 호출 | **불가능** — `ANTHROPIC_API_KEY` 미설정, `anthropic`/`google` 패키지 미설치 |
| 실측 추출 정확도 | **측정 불가** — 실제 VLM 호출이 필요 |
| AI-Assisted Cropping | 모듈 추가 완료, 폴백으로 연결됨 (실제 호출은 API 필요) |
| ROI 재추출 (산술 실패 행만 잘라 재호출) | 모듈 추가 완료 (실제 호출은 API 필요) |
| 필드별 confidence 점수 | 스키마/프롬프트 추가 완료 (값은 VLM에서 받음) |
| summary.md 생성기 | 동작 — `pipeline/reports/summary.md` |

## 1. 엣지 검출 실패 진단

5개 샘플 × 6개 임계값(Canny 4 + adaptive 2) **24개 실험** 결과:

- **01 paper_rotated**: 6/6 실패. 종이 좌상단이 이미지 프레임 밖으로 잘림 → 닫힌 contour 못 만듦.
- **02 screenshot**: 6/6 실패 (예상). 스크린샷은 외곽 문서 자체가 없음.
- **03 monitor_photo**: 4/6 Canny 실패. Adaptive에서 89.7% 사각형 잡았으나 **이미지 프레임 자체**(가짜 양성). 모니터 베젤이 검정이라 closed contour 형성 안 됨.
- **04 paper_watermark**: 6/6 실패. 종이/책상 명암차 부족 + 우측 그림자 노이즈.
- **05 monitor_skewed**: 5/6 실패. 1개만 6.4% 작은 영역 잡음 — 가드에서 거부.

**결론**: OpenCV 전통 방식만으로는 모니터/종이 사진의 엣지 검출이 본질적으로 불안정. **AI-Assisted Cropping(VLM이 4 코너 직접 짚기)**이 99% 목표에서 필수.

## 2. 추가된 모듈

| 파일 | 역할 |
|---|---|
| `src/preprocessor/vlm_corners.py` | VLM에게 정규화 좌표(0~1)로 4 모서리를 받아 워프. confidence < 0.5거나 "이미지 전체" 응답 시 폴백. |
| `src/extractor/roi_recrop.py` | 산술 실패 행만 잘라 VLM에 고해상도 재요청. 재추출도 산술 깨지면 None. |
| `src/extractor/vlm_extractor.py` | `_confidences: dict[str, float]` 추가. VLM이 필드별 0~1 자신감 반환. |
| `src/orchestrator.py` | `max_retries=3` (1→3), `enable_roi_recrop=True`, ROI 결과를 PipelineResult에 노출. |
| `src/preprocessor/perspective.py` | OpenCV 실패 시 `vlm_adapter` 있으면 자동 폴오버. |
| `src/report/summary.py` | 5개 샘플 결과 → markdown. ground truth diff 포함. |
| `samples/ground_truth.json` | **어시스턴트가 직접 이미지 읽어 전사한 oracle**. 02·04·05는 high confidence, 01·03은 partial. |

## 3. 사용자 요청 사항 매핑

| 요청 | 상태 | 비고 |
|---|---|---|
| 산술 검증 실패 시 needs_manual_review 강제 | 작동 | `validator/pipeline.py`에서 logical 실패 시 자동 |
| 약품코드/사업자번호 형식 위반 시 self-correction 3회 | 구조 작동, 실측 미확인 | `max_retries=3`. **실제 시도 횟수는 VLM 호출이 일어나야 측정** |
| summary.md 필드별 실패 보고 | 작동 | `pipeline/reports/summary.md` |
| 가장 어려운 이미지 + 전처리 강화 | 보고 완료 | **03 monitor_photo** (90° + 35행 dense + UI 노이즈 + 모니터 모아레). AI-Assisted Cropping이 1차 해결책. |
| AI-Assisted Cropping | 모듈 작성 완료 | API 필요 |
| 산술 실패 시 ROI 재크롭 | 모듈 작성 완료 | API 필요 |
| VLM 자신감 점수 출력 | 스키마/프롬프트 완료 | 실제 값은 VLM 응답에서 옴 |
| **JSON이 실제 이미지와 100% 일치하는지 검증** | **불가능** | API 필요 |

## 4. 중요한 발견 (사용자 가정과 다름)

### drug_code 정규식 `^\d{6,9}$` 는 실데이터에서 깨진다

샘플 05의 약품코드는 `d20past`, `d2rabenew` — **영문+숫자**. 같은 처방통계라도 시스템마다 코드 체계가 다르다 (EDI 표준 9자리 숫자 vs 자체 영숫자 코드).

권고: 정규식을 `^[A-Za-z0-9]{4,12}$`로 완화하고, EDI 코드 패턴(9자리 숫자)이면 더 강한 신뢰도 부여 정도로 차등.

### Footer 형식

5개 footer 모두 정규식 `period/hospital(biz_no)/[doctor]/pharma`로 결정론적 파싱 가능:
- doctor 누락(`//`): 01, 03, 04
- doctor 있음: 02 이재영, 05 원종원

`src/preprocessor/footer_parser.py`로 VLM 호출 없이 4개 메타필드(기간·병원·사업자번호·제약사) 확정 가능.

## 5. 사용자가 다음에 해야 할 일

99% 신뢰도 목표 달성을 위해 사용자 측에서 필요한 것:

1. **`ANTHROPIC_API_KEY` 또는 `GOOGLE_API_KEY` 설정** + 패키지 설치
   ```bash
   pip install anthropic  # 또는 google-generativeai
   export ANTHROPIC_API_KEY=sk-...
   ```
2. `pipeline/run_samples_report.py`에서 `MockVLMAdapter` → `ClaudeAdapter`로 교체
3. 실행 후 `pipeline/reports/summary.md`의 **ground_truth diff 섹션**을 읽으면 *진짜* VLM 정확도가 측정됨
4. 차이가 나는 필드별로 (a) 전처리 강화 (b) 프롬프트 개선 중 어디가 원인인지 다음 작업으로 분기

## 6. 정직 코멘트

- 이번 세션에서 “테스트 28개 전부 통과”는 **mock 데이터에서 코드가 죽지 않고 도는 것**이 확인된 수준입니다. 사용자가 강조하신 “테스트 통과 ≠ 데이터 정확”의 정확히 그 갭이 남아 있습니다.
- 결정론적 부분(footer 파싱, 산술, 형식 정규식, 회전 보정, 스크린샷 분류)은 이미지 자체로 검증되었습니다.
- VLM 부분은 구조만 검증되었습니다. **실제 인식률은 API 호출이 일어난 뒤에야 측정 가능**합니다.
