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
