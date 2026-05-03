# 텔레그램 디제스트 셋업

## 1단계: 봇 생성
1. 텔레그램 앱에서 @BotFather 검색 → 채팅 시작
2. /newbot 입력
3. 봇 이름 (예: "비즈관리 알림 봇")
4. 봇 username (예: "biz_admin_bot") — 끝에 bot 또는 _bot 필수
5. BotFather가 토큰 줌. 예: `1234567890:AAEhBP9sJ...`

## 2단계: 본인 chat ID 확인
1. 만든 봇과 채팅 시작 → 아무 메시지 발송 (예: "안녕")
2. 브라우저로 `https://api.telegram.org/bot<토큰>/getUpdates` 접속
3. 응답 JSON에서 `"chat":{"id":숫자}` — 그 숫자가 chat ID
   - 본인이라면 숫자가 양수, 그룹채팅이면 음수

## 3단계: webhook 시크릿 만들기
무작위 문자열 32자 이상 생성:
```bash
openssl rand -hex 32
```

## 4단계: Vercel 환경변수 등록
Vercel Dashboard → Settings → Environment Variables에 추가:
- `TELEGRAM_BOT_TOKEN` = (1단계 토큰)
- `TELEGRAM_CHAT_ID_BIZ` = (2단계 chat ID)
- `TELEGRAM_WEBHOOK_SECRET` = (3단계 무작위 문자열)
- `CRON_SECRET` = (별도 무작위 문자열, openssl rand -hex 32)

배포 후 적용.

## 5단계: webhook 등록
브라우저 또는 curl로 한 번 호출:
```
https://api.telegram.org/bot<토큰>/setWebhook?url=https://<도메인>/api/telegram/webhook?token=<webhook_secret>
```
응답에 `"ok":true` 뜨면 성공.

## 6단계: 테스트
다음 curl로 수동 디제스트 발송 테스트:
```bash
curl -H "Authorization: Bearer <CRON_SECRET>" \
  https://<도메인>/api/cron/biz-digest
```
봇에게 메시지가 오면 정상 동작.

## 코드에서 디제스트 큐 사용법
다른 에이전트/서버 코드에서 아래와 같이 import하여 사용:
```ts
import { pushDigest } from "@/lib/digest";

await pushDigest({
  type: "completed",
  category: "정산",
  title: "정산 업로드 행-나열 방식 개편 완료",
  body: "기존 열 방식에서 행 방식으로 변경. 처리 시간 40% 단축.",
});

await pushDigest({
  type: "decision_needed",
  category: "요율",
  title: "신규 제약사 요율 적용 방식 결정 필요",
  body: "A사 신규 계약 요율 3% vs 5% 중 선택 필요.",
  decisionOptions: [
    { id: "a", label: "3% (보수적)" },
    { id: "b", label: "5% (공격적)" },
  ],
});

await pushDigest({
  type: "blocker",
  category: "재고크롤러",
  title: "IBJP 로그인 세션 만료 — 크롤링 중단",
  body: "SCRAPER_IBJP_PW 갱신 필요. 현재 재고 데이터 미수집 중.",
});
```

type 값:
- `completed` — 정상 완료된 작업 (PROGRESS.md에도 기록)
- `decision_needed` — 사용자 결정이 필요한 사항
- `blocker` — 즉시 조치가 필요한 문제
- `info` — 참고용 정보

category 값 (자유 문자열, 권장):
`거래처/유저`, `정산`, `요율`, `필터링`, `통계제출처`, `재고크롤러`, `메타`
