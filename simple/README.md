# 네이버 매출 → 텔레그램 (개인용 단순 버전)

**한 파일 (`run.ts`) 280줄.** DB 없음, 로그인 없음, 관리자 페이지 없음.
매일 09시(KST) 텔레그램 1통 받기 위한 최소 코드.

## 어떤 메시지가 오나

```
📊 2026-04-26 매출 보고

💰 매출 1,234,500원
📦 9건 배송 / 17개
💳 수수료 88,500원
⚠️ 취소·반품·환불 1건 제외

━━ 키워드별 ━━
• 피쿠알 [비타앤오리진]
   8병 · 250,000원 · 4건
• 블렌딩 [비타앤오리진]
   6병 · 150,000원 · 2건
…

━━ 스토어별 ━━
• 비타앤오리진 — 1,100,000원 · 17병 · 8건
• 여기명품 — 134,500원 · 0병 · 1건
```

## 옵션 → 키워드 매핑 룰

`run.ts` 상단의 `KEYWORD_RULES` 직접 수정:

```ts
const KEYWORD_RULES = [
  { keyword: "피쿠알", patterns: ["피쿠알", "picual"] },
  { keyword: "아르베키나", patterns: ["아르베키나", "arbequina"] },
  { keyword: "블렌딩", patterns: ["블렌딩", "blending", "blend", "혼합"] },
];
```

병수는 「N병/N개/N세트」 정규식으로 자동 추출.

## 로컬에서 한 번 돌려보기

```bash
cd simple
npm install
cp .env.example .env
# .env 에 TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID 채우기
npx tsx run.ts
```

특정 날짜 보고:
```bash
npx tsx run.ts 2026-04-25
```

## 매일 자동 실행 — 3가지 옵션

### 옵션 A: GitHub Actions (무료, 추천)

레포에 `.github/workflows/simple-daily.yml` 이미 추가됨.
- 09:00 KST 매일 자동 실행
- GitHub → Settings → Secrets 에 3개 등록:
  - `NAVER_STORES_JSON`
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_CHAT_ID`
- ⚠️ **GitHub Actions 의 IP 가 매번 다름** → 네이버 콘솔에서 IP 화이트리스트 비워두거나 서비스 IP 대역(다수) 등록 필요. 「IP 못 쓰겠다」면 옵션 B/C.

### 옵션 B: AWS Lightsail $5/월 (가장 안정적)

```bash
# Lightsail Ubuntu 인스턴스에서:
git clone <레포> /home/ubuntu/sales
cd /home/ubuntu/sales/simple
npm install
cp .env.example .env  # 값 채우기

# crontab -e 에 추가:
0 0 * * * cd /home/ubuntu/sales/simple && /usr/bin/npx tsx run.ts >> /var/log/sales.log 2>&1
```

- 고정 IP 1개 → 네이버 콘솔에 그것만 등록
- 한 번 셋업하면 끝, 신경 안 씀

### 옵션 C: 사장님 사무실 PC 의 cron / Task Scheduler

- 비용 0
- 단점: PC 가 켜져있어야 함, 네트워크 변경 시 IP 등록 다시

## 「Host not in allowlist」 오류가 뜨면

네이버 커머스 API 센터 → 「내 스토어 애플리케이션」 → 각 앱 → 「수정」 → **「API호출 IP」 칸 비우기 또는 실제 호출 IP 추가**.

확인 방법: 실행 환경에서
```bash
curl https://api.ipify.org
```

## SaaS 버전과의 관계

이 폴더는 **사장님 개인용** 단순 스크립트입니다.

루트의 Next.js 앱(/admin/sales/...)은 **회원가입·다중 사업자·대시보드 등 SaaS 화** 코드. 둘은 같은 레포에 공존하며 서로 영향 없음.
- 개인용만 돌리려면: 이 폴더만 신경쓰고 cron 1개 돌리면 끝
- SaaS 도 같이 띄우려면: 루트에서 Next.js + Postgres 셋업 (`SALES_DEPLOY.md`)

## 이 스크립트의 한계

- 원가 미반영 (수수료만 차감해서 「매출 - 수수료」 표시. 이익 계산 X)
- DB 없음 (그날 그날 새로 조회)
- 백필 없음 (어제 데이터만)

원가/이익/백필이 필요하면 SaaS 버전 쓰세요.
