# 지메일 자동 수신 셋업 (5분)

회사로 오는 요율표·정산내역서 첨부 메일을 사이트가 자동으로 받아서 **`/biz/email-inbox` 어드민 메일함**에 표시. 클릭 한 번으로 분류·등록 완료.

## 1단계: 지메일 라벨 + 필터 만들기 (2분)

지메일 → ⚙️ → **모든 설정 보기** → **필터 및 차단된 주소** → **새 필터 만들기**

조건 예시 (필요한 패턴 추가/조정):
- **보낸사람**: `@제일약품.com OR @대웅바이오.com OR @보령제약.com`
- **제목**: `요율 OR 정산내역서 OR 정산서`
- **첨부파일 있음**: ✅

→ 필터 만들기 → 동작 선택:
- ☑ **라벨 적용**: `자동수신` (없으면 새로 생성)
- ☐ 받은편지함 건너뛰기 (선택)

저장.

> **팁**: Gmail 검색창 우측 슬라이더 아이콘 클릭으로도 동일하게 만들 수 있음.

---

## 2단계: Apps Script 등록 (2분)

1. [https://script.google.com](https://script.google.com) 접속 (지메일 계정으로)
2. **새 프로젝트** 클릭
3. 좌측 `Code.gs` 파일 내용 전부 지우고 아래 코드 붙여넣기

```javascript
// === 사용자 설정 ===
const WEBHOOK_URL = 'https://123-nine-lyart.vercel.app/api/email-ingest/webhook';
const WEBHOOK_SECRET = 'PASTE_YOUR_SECRET_HERE';  // 4단계에서 설정할 값과 동일
const LABEL_RECEIVED = '자동수신';
const LABEL_PROCESSED = '자동수신-처리됨';
const LABEL_FAILED = '자동수신-실패';
const MAX_PER_RUN = 20;

function processIncomingEmails() {
  const label = GmailApp.getUserLabelByName(LABEL_RECEIVED);
  if (!label) {
    Logger.log('Label "' + LABEL_RECEIVED + '" not found. Create it first.');
    return;
  }
  const processedLabel = GmailApp.getUserLabelByName(LABEL_PROCESSED) || GmailApp.createLabel(LABEL_PROCESSED);
  const failedLabel = GmailApp.getUserLabelByName(LABEL_FAILED) || GmailApp.createLabel(LABEL_FAILED);

  const threads = label.getThreads(0, MAX_PER_RUN);
  let success = 0, fail = 0;

  for (const thread of threads) {
    const messages = thread.getMessages();
    let threadOk = true;

    for (const message of messages) {
      try {
        const attachments = message.getAttachments({ includeInlineImages: false, includeAttachments: true });
        const payload = {
          messageId: message.getId(),
          fromAddress: extractEmail(message.getFrom()),
          fromName: extractName(message.getFrom()),
          subject: message.getSubject(),
          bodyPreview: (message.getPlainBody() || '').substring(0, 500),
          receivedAt: message.getDate().toISOString(),
          attachments: attachments.map(att => ({
            fileName: att.getName(),
            mimeType: att.getContentType(),
            size: att.getSize(),
            base64: Utilities.base64Encode(att.getBytes()),
          })),
        };

        const res = UrlFetchApp.fetch(WEBHOOK_URL, {
          method: 'post',
          contentType: 'application/json',
          headers: { 'X-Webhook-Secret': WEBHOOK_SECRET },
          payload: JSON.stringify(payload),
          muteHttpExceptions: true,
        });

        if (res.getResponseCode() >= 200 && res.getResponseCode() < 300) {
          success++;
        } else {
          Logger.log('Webhook fail [' + res.getResponseCode() + ']: ' + res.getContentText());
          threadOk = false;
          fail++;
        }
      } catch (e) {
        Logger.log('Process error: ' + e);
        threadOk = false;
        fail++;
      }
    }

    if (threadOk) {
      thread.removeLabel(label);
      thread.addLabel(processedLabel);
    } else {
      thread.removeLabel(label);
      thread.addLabel(failedLabel);
    }
  }

  Logger.log('Done. success=' + success + ' fail=' + fail);
}

function extractEmail(from) {
  const m = from.match(/<([^>]+)>/);
  return m ? m[1].trim() : from.trim();
}

function extractName(from) {
  const m = from.match(/^([^<]+)</);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}
```

4. **WEBHOOK_SECRET** 자리에 무작위 문자열 한 줄 만들어서 넣기 (이 값은 4단계에 그대로 다시 사용):
   - 예: `bf91e7d3a4c2f8e6d9a1b5c7e3f4a2b8c6d0e1f9` (32자 이상 권장)
   - 만들기 쉬운 방법: 키보드 아무거나 두드려서 32자 이상

5. **저장 (Ctrl+S)** → 프로젝트 이름 (예: `Email Ingest`) 입력

---

## 3단계: 트리거 등록 (30초)

좌측 **🕐 시계 아이콘** 클릭 → 우하단 **+ 트리거 추가**

설정:
- 함수: `processIncomingEmails`
- 배포: `Head`
- 이벤트 소스: `시간 기반`
- 시간 기반 트리거 유형: `분 단위 타이머`
- 분 간격: `5분마다`

→ **저장** → 첫 실행 시 **권한 승인** 팝업 → 본인 계정 선택 → "고급" → "안전하지 않은 페이지로 이동" → 허용

---

## 4단계: Vercel 환경변수 등록 (1분)

[Vercel Dashboard](https://vercel.com) → 프로젝트 → Settings → Environment Variables

| 변수명 | 값 |
|---|---|
| `EMAIL_WEBHOOK_SECRET` | 2단계의 `WEBHOOK_SECRET`과 **완전히 동일한 문자열** |

→ Save → 다음 배포부터 적용 (Redeploy 한 번 권장)

---

## 5단계: 테스트

1. 본인 메일에 첨부파일 포함 메일을 보내고, 그 메일에 "자동수신" 라벨 수동으로 부착
2. 5분 기다리거나 Apps Script 화면에서 ▶ 실행 버튼 직접 누름
3. 사이트 `/biz/email-inbox` 메일함 확인 → 새 메일 행 보이면 성공

---

## 작동 흐름

```
지메일 새 메일 도착
   ↓ (Gmail 필터가 "자동수신" 라벨 부착)
Apps Script 5분마다 실행
   ↓ "자동수신" 라벨 메일 처리
   ↓ 첨부 base64 + 메타정보 → POST /api/email-ingest/webhook
사이트
   ↓ Storage에 첨부 저장 (incoming-emails 버킷)
   ↓ IncomingEmail + EmailAttachment DB 행 생성
   ↓ 발신자 매핑 자동 적용 (있으면 status=CLASSIFIED, 없으면 PENDING)
어드민 /biz/email-inbox
   ↓ 사용자가 미분류 메일 클릭
   ↓ 법인/제약사/적용월/종류 선택 → "분류 + 자동 등록"
   ↓ 요율: CorpRateFile / 정산: SettlementDocument 자동 INSERT
끝
```

## 트러블슈팅

| 증상 | 원인 / 처방 |
|---|---|
| 웹훅 401 | `EMAIL_WEBHOOK_SECRET` 값이 Apps Script와 Vercel 다름 |
| 웹훅 500 | Storage 버킷 `incoming-emails` 없음 → Supabase에서 Private 버킷 생성 |
| 메일이 어드민에 안 보임 | "자동수신" 라벨이 실제로 부착됐는지 확인. 또는 Apps Script Logger 확인 |
| 첨부 너무 큼 | 50MB 초과 → 자동 거절. 사용자가 분할 또는 큰 파일은 매뉴얼 업로드 |
| 권한 승인 못 함 | Google이 "확인되지 않은 앱" 경고 → "고급" → "이동" 클릭 |

---

## 발신자 매핑 자동화 (학습 단계)

처음에는 모든 메일이 PENDING으로 와서 매뉴얼 분류. 매번 같은 발신자에게서 같은 종류 메일이 오면, 어드민 화면에서 **"이 발신자 매핑 등록"** 클릭으로 한 번 학습시키면, 다음부터는 그 발신자 메일은 **CLASSIFIED** 상태로 자동 분류돼서 등록만 한 번 클릭하면 됨.

2단계에서는 매핑이 충분히 쌓이면 **자동 등록**(클릭 없이 바로 등록)까지 켤 예정.
