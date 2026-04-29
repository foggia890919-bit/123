# 네이버 매출 자동화 — 배포·운영 가이드

## A. 처음 한번 — Vercel 배포

### 1) DB 만들기 (선택지: Supabase / Neon — 둘 다 무료)

**Supabase (추천)**
1. https://supabase.com 가입
2. New project → 비밀번호 메모
3. Project Settings → Database → **Connection string (Transaction pooler, port 6543)** 복사
4. URL 끝에 `?pgbouncer=true&connection_limit=1` 붙이기

→ 결과 `DATABASE_URL` 예시:
```
postgres://postgres.xxx:비번@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```

### 2) Vercel 프로젝트 만들기

```bash
npm i -g vercel
cd /path/to/repo
vercel link        # 신규 프로젝트면 그냥 vercel 만 — 프롬프트 따라가기
vercel env pull    # 빈 .env.local 받음 (없어도 됨)
```

또는 Vercel 대시보드에서 GitHub 레포 연결 → 자동 배포.

### 3) 환경변수 설정 (Vercel Project → Settings → Environment Variables)

필수:
| 키 | 값 |
|---|---|
| `DATABASE_URL` | 위에서 복사 |
| `NEXTAUTH_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `NEXTAUTH_URL` | 배포된 도메인 (예: `https://my-app.vercel.app`) |
| `CRON_SECRET` | 위 명령어 한 번 더 |
| `ENCRYPTION_KEY` | 위 명령어 한 번 더 (32바이트 hex 권장) |

선택 (워크스페이스 단위로 UI 에서도 등록 가능):
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — 모든 워크스페이스 기본값
- `GOOGLE_SHEETS_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`

### 4) Prisma 마이그레이션

처음 배포 시 한 번만:
```bash
DATABASE_URL="<위에서 복사한 URL>" npx prisma migrate deploy
```

### 5) 첫 배포

```bash
vercel --prod
```

또는 GitHub 푸시하면 자동.

### 6) 네이버 API IP 화이트리스트 등록

배포 끝나면 **고정 IP 가 있는 환경**으로 옮기거나 IP 화이트리스트 해제 필요.

⚠️ Vercel 은 IP 가 변동적이라서 네이버 API 가 거부할 수 있음.

선택지:
- **(a) AWS Lightsail $5/월 + 고정 IP** 1개에 앱 직접 배포 → 네이버에 그 IP 등록
- **(b) Vercel + 외부 프록시** (예: Fixie) — 네이버 API 호출 시에만 프록시 통해 고정 IP
- **(c) 임시: 사장님 사무실 PC IP** 1개 등록 (PC 가 켜져있어야만 동작)

배포 환경의 외부 IP 확인:
```bash
curl https://api.ipify.org
```

확인된 IP 를 네이버 커머스 API 센터 → 각 앱 → 「API호출 IP」 에 추가.

---

## B. 가입 → 사업자 → 스토어 → 키워드 → 백필 → 보고

### 1) 가입
- `/register` → 이메일 + 비밀번호
- DB 에서 본인 user 의 `role=ADMIN`, `approved=true` 로 직접 수정 (한 번만)
  ```sql
  UPDATE "User" SET role = 'ADMIN', approved = true WHERE email = 'me@example.com';
  ```
- `/admin/login` → `isAdmin=true` 들어감

### 2) 첫 진입 → 워크스페이스 자동 생성
- `/admin/sales` 진입하면 「내 사업자」 워크스페이스 자동 생성됨 (키워드 룰 3개 기본 시드)

### 3) 사업자 추가/이름 변경
- `/admin/sales/workspaces` → 와이케이홀딩스, 여기명품, 와이케이팜 등 사업자별로 등록
- 각 사업자 클릭 → 텔레그램·시트 키 입력 → 「테스트 발송」 으로 검증

### 4) 네이버 스토어 등록
- `/admin/sales/stores` → Client ID + Client Secret 입력 (자동 암호화)
- `enabled` 켜기

### 5) 키워드 룰 확인
- `/admin/sales/keywords` → 「피쿠알 / 아르베키나 / 블렌딩」 3개 자동 시드 확인
- 패턴 추가/수정 가능. 우측 상단에서 패턴 테스트 입력해서 매칭 확인

### 6) 1년치 백필
- `/admin/sales/backfill` → 스토어 선택 → 기본값 (1년 전 ~ 어제) → 「잡 생성」
- 스토어 3개면 잡 3개 만들기
- 「30일 처리」 버튼 한번씩 눌러서 진행
- 또는 그냥 두면 5분마다 cron 이 자동으로 7일씩 진행 (~6시간이면 1년치 다 채워짐)

### 7) 키워드 자동 채우기
- `/admin/sales/keywords` → **「✨ 빈 옵션에 자동 채우기」** 클릭
- 옵션명에 「피쿠알/아르베키나/블렌딩」 들어있는 항목 자동 매핑됨
- 병수도 「2병 세트」 → 2 로 자동 추출

### 8) 원가 입력
- `/admin/sales/costs` → 매핑된 옵션마다 원가/물류비 등 입력
- 원가 미입력 옵션은 보고서에 「이익 = 매출 - 수수료」로 계산됨

### 9) 텔레그램 봇 만들기
- 텔레그램 → `@BotFather` → `/newbot` → 토큰 받기
- 본인 Telegram → `@userinfobot` → `/start` → chat_id 받기
- 워크스페이스 설정에 입력 → 「테스트 발송」 클릭 → 메시지 도착 확인

### 10) 보고 시각 확인
- 워크스페이스 설정의 「보고 시각」 = `09:00` (KST 기준)
- Vercel cron 이 매 10분마다 트리거 → 09:00 ±10분 윈도우 안에 발송

---

## C. 일상 운영

- **새 상품 등록 시**: 매시간 cron 이 네이버 상품 API 로 자동 발견 → 텔레그램 「🆕 신규 상품 N개」 알림 → 옵션이 등록되면 키워드 자동 채우기 한 번 더 돌리면 됨
- **API 키 변경 시**: `/admin/sales/stores` 에서 Client Secret 새 값 입력 → 저장 (자동 암호화)
- **데이터 점검**: `/admin/sales/dashboard` 365일 모드 → 큰 그림 확인

## D. 트러블슈팅

| 증상 | 원인 / 해결 |
|---|---|
| 백필 잡 FAILED, errors 에 `Host not in allowlist` | Vercel IP 가 네이버 화이트리스트에 없음. 배포 환경 IP 확인 후 등록 |
| 텔레그램 안 옴 | 워크스페이스 설정에 봇 토큰·chat_id 둘 다 있는지, 「테스트 발송」 으로 사전 검증 |
| 시트 안 채워짐 | Service Account 이메일이 시트 「공유」에 「편집자」로 등록됐는지 확인 |
| 09시 보고 안 옴 | Vercel cron 이 동작하는지 확인. Hobby 플랜은 매분 cron 불가 (Pro 필요) |
| 키워드가 「상품명」으로 폴백됨 | 옵션이 룰에 매칭 안됨. 키워드 룰 페이지에서 패턴 추가 |

---

## E. 비용 가이드 (월별 대략)

| 항목 | 비용 |
|---|---|
| Vercel Hobby | 무료 (단, cron 일 1회 제한 → Pro 필요) |
| Vercel Pro | $20/월 (cron 매분 가능) |
| Supabase Free | 무료 (500MB / 5만 행) |
| AWS Lightsail (고정 IP) | $5/월 |
| 텔레그램 / 구글시트 | 무료 |

**최저비용 추천 구성**: AWS Lightsail $5 + Supabase Free = **월 5천원**.
