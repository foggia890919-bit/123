# Document Intelligence Pipeline

20~30종의 양식과 열악한 촬영 환경(각도, 조도, 그림자, 어두운 배경, 복잡한 표)을
견디는 OCR 데이터 추출 파이프라인. 4단계로 구성된다.

```
preprocess  ->  classify  ->  extract  ->  validate
   (CV)       (VLM 1-pass)  (VLM 2-pass)   (regex+logic)
```

## 구조

```
pipeline/
├── configs/
│   └── templates.json          # 양식별 메타데이터 (필드 목록, 키워드, 검증 규칙)
├── src/
│   ├── preprocessor/           # OpenCV 기반 보정 (원근, 조도, 표 강조)
│   ├── classifier/             # VLM 1-pass 양식 분류
│   ├── extractor/              # VLM 2-pass 필드 추출 + Pydantic 스키마
│   ├── validator/              # 정규식 / 논리 / 신뢰도
│   └── llm/                    # VLM 어댑터 (Gemini/Claude 등 교체 가능)
├── samples/                    # 입력 이미지
├── debug/                      # 전처리 중간 산출물
└── tests/
```

## 실행

```bash
pip install -r requirements.txt
export GOOGLE_API_KEY=...    # 또는 ANTHROPIC_API_KEY
python -m pipeline.main samples/invoice_001.jpg
```

`--debug` 플래그를 주면 전처리 단계별 이미지가 `debug/`에 저장된다.

## 설계 원칙

- **Config-Driven** — 새 양식 추가 시 코드 수정 없이 `configs/templates.json` 한 줄
  추가. 추출 필드와 검증 규칙은 데이터로 다룬다.
- **모듈 경계가 곧 단계 경계** — 각 모듈은 다음 단계로 넘기는 dataclass 한 종류만
  알면 된다. preprocessor는 VLM을 모르고, validator는 OpenCV를 모른다.
- **VLM은 교체 가능** — `src/llm/`의 어댑터 인터페이스 한 군데만 구현하면 다른
  공급자로 갈아탈 수 있다.
- **결정론 우선, LLM은 보정용** — 정규식/산술이 답을 낼 수 있는 자리에서는 LLM을
  부르지 않는다. `validator`가 추출 결과의 진실 게이트키퍼다.

## 범용성 — 양식·각도가 변해도 끄떡없게 만든 장치

새 병원이 새 양식을 가져와도 코드를 안 고치고 대응하기 위한 4가지 장치.

1. **앵커 기반 추출 프롬프트** (`src/extractor/vlm_extractor.py:_ANCHOR_RULES`)
   - "좌표 (100,200)을 봐라" 가 아니라 **인접 라벨**(앵커 키워드) 옆/아래 값을
     찾도록 강제. 같은 의미의 동의어(예: 합계금액=총액=TOTAL=결제금액)도 함께
     받아들이라고 모델에게 명시.
   - 가로형/세로형 양식 모두 허용. 표 안에서는 같은 행의 라벨–값 짝만 묶는다.
2. **분류 실패 시 generic_document 폴백** (`src/orchestrator.py`)
   - 20~30종 카탈로그에 없는 양식이 들어와도 시스템이 멈추지 않는다. VLM이
     `key_value_pairs` / `line_items`로 가능한 모든 라벨–값 쌍을 자유 형식으로
     뽑아낸다.
3. **Self-Correction 루프** (`run_pipeline(..., max_retries=N)`)
   - validator가 형식 위반·필수 누락·산술 불일치를 잡으면, 그 사유를 자연어로
     모델에게 되먹여 재추출. 1차에서 어긋난 결과가 unattended로 final이 되는 사고를
     방지한다.
4. **상대적 보정** (`src/preprocessor/`)
   - 모서리는 절대좌표로 박지 않고 매 이미지에서 다시 검출.
   - 어두운 배경 자동 색반전, CLAHE, 그림자 광맵 제거를 거쳐 "정면 + 균일 조도"
     상태로 정규화한 뒤에야 VLM에 넘긴다.

### 새 양식 추가 절차

1. `configs/templates.json`에 항목 한 줄 추가 (id / label / match_keywords / fields /
   logical_checks).
2. 끝. 코드 변경 없이 분류기·추출기·검증기가 자동으로 따라온다.
