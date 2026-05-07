# 네이버부동산 크롤링 예제

`new.land.naver.com` 의 내부 JSON API를 사용해서 **아파트·오피스텔·토지·상업부동산까지** 모두 한번에 분류·수집하는 하이브리드 크롤러 예제.

## 동작 원리

1. **토큰 캡처 (Playwright)** — `chromium`을 띄우고 네이버부동산 첫 화면이 자체적으로 호출하는 `/api/*` 요청을 인터셉트해서 `Authorization: Bearer ...` 헤더를 추출
2. **API 호출 (fetch)** — 캡처한 토큰을 그대로 재사용해서 `/api/regions/list`, `/api/articles` 를 직접 호출
3. **분류** — 매물 카테고리(주거 / 토지 / 상업 / 분양권 / 재건축·재개발) × 거래유형(매매·전세·월세) 매트릭스로 자동 집계

토큰은 보통 30~60분 정도 유효하므로, 본격적으로 돌릴 때는 토큰만 한 번 받아두고 fetch로 다 돌리는 게 빠르다.

## 파일 구성

| 파일 | 역할 |
|------|------|
| `filters.ts` | 매물 종류(`APT`/`TJ`/`SG` 등) · 거래유형(`A1`/`B1`/`B2`) · 정렬 코드 + 카테고리 묶음 |
| `types.ts` | API 응답 타입(`Region`, `Article`, `ArticleListResponse` 등) |
| `token.ts` | `harvestSession()` — Playwright로 Bearer 토큰 + 쿠키 캡처 |
| `api.ts` | `NaverRealestateClient` — 지역 검색·매물 리스트·상세·자동 페이지네이션 |
| `run.ts` | CLI 진입점 — 키워드 → 카테고리 전부 수집 → JSON 저장 |

## 실행

```bash
# 기본 (강남구 역삼동, 카테고리당 5페이지)
npx tsx examples/naver-realestate/run.ts "강남구 역삼동"

# 디버깅용 — 브라우저 띄워서 확인
npx tsx examples/naver-realestate/run.ts "마포구 합정동" --headful

# 페이지 수 늘려서 더 많이
npx tsx examples/naver-realestate/run.ts "용인시 처인구" --pages=10

# 결과 저장 위치 변경
npx tsx examples/naver-realestate/run.ts "송파구 잠실동" --out=./out
```

또는 npm script로:

```bash
npm run scrape:naver -- "강남구 역삼동"
```

## 출력 예시

```
[1/4] 토큰 캡처 (headless=true) ...
      ✓ 토큰 획득: Bearer eyJ0eXAiOiJKV1Qi...
[2/4] 지역 검색: "강남구 역삼동"
      ✓ 역삼동 (cortarNo=1168010100, sec)
[3/4] 매물 수집 — 카테고리 단위로 호출 (페이지 최대 5)
      - 주거 (APT,OPST,VL,YR,DDDGG,HOJT,JWJT,OR) ... 412건
      - 토지 (TJ,LAND) ... 18건
      - 상업 (SG,SMS,SB,GJCG,GM,KSG,STORE) ... 86건
      - 분양권 (ABYG,OBYG) ... 7건
      - 재건축_재개발 (JGC,JGB) ... 0건
[4/4] 분류 + 저장 (총 523건)

  ┌ 카테고리별 매물 분포
  │ 주거            412건  (매매=180, 전세=120, 월세=112)
  │ 토지             18건  (매매=18)
  │ 상업             86건  (매매=40, 전세=10, 월세=36)
  │ 분양권            7건  (매매=7)
  └

  ─ 미리보기
    [주거/아파트/매매] 래미안역삼 — 22억 5,000 · 전용 84㎡ · 12/15층
    ...
  → 저장: tmp/naver-realestate/역삼동_2026-05-07T...json
```

## 필터 커스터마이징

`run.ts` 에서 `client.listAllArticles({...})` 호출 부분을 수정하면 면적·가격 범위까지 좁힐 수 있다:

```ts
await client.listAllArticles({
  cortarNo: region.cortarNo,
  realEstateTypes: [RealEstateType.SG, RealEstateType.SMS],   // 상가+사무실만
  tradeTypes: [TradeType.A1],                                  // 매매만
  areaMin: 33,                                                 // 10평 이상
  areaMax: 165,                                                // 50평 이하
  priceMin: 10000,                                             // 1억 이상 (만원 단위)
  priceMax: 100000,                                            // 10억 이하
  sort: SortType.priceAsc,
});
```

## 주의

- 이 API는 네이버가 공식적으로 공개한 인터페이스가 아니다. 학습·개인 용도로만 쓸 것
- 너무 빠른 호출 금지 — 본 예제는 페이지 사이 350~400ms 딜레이를 둠
- 토큰은 SPA 세션 토큰이라 재시작 후 약 30~60분 안에 다시 캡처해야 한다
