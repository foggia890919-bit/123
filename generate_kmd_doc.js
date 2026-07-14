const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel,
        AlignmentType, BorderStyle, WidthType, ShadingType, PageBreak, LevelFormat, ImageRun } = require('docx');
const fs = require('fs');

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };

function createTable(columnWidths, rows) {
  const totalWidth = columnWidths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths,
    rows: rows.map(row => new TableRow({
      children: row.map((cell, idx) => new TableCell({
        borders,
        width: { size: columnWidths[idx], type: WidthType.DXA },
        shading: { fill: "F5F5F5", type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({
          children: [new TextRun(cell.toString())]
        })]
      }))
    }))
  });
}

const doc = new Document({
  styles: {
    default: {
      document: { run: { font: "Arial", size: 22 } }
    },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "Arial", color: "1F4E78" },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Arial", color: "2E5C8A" },
        paragraph: { spacing: { before: 180, after: 100 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "Arial", color: "3A7BA3" },
        paragraph: { spacing: { before: 120, after: 80 }, outlineLevel: 2 } },
    ]
  },
  numbering: {
    config: [
      { reference: "bullets",
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } }
        ]
      }
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
      }
    },
    children: [
      // 표지
      new Paragraph({ spacing: { after: 480 }, children: [new TextRun("")] }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [new TextRun({ text: "KMD 플랫폼", bold: true, size: 48, color: "1F4E78" })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [new TextRun({ text: "검색어로 품목찾기 & 네이버 매출 자동화", size: 28, color: "2E5C8A" })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [new TextRun({ text: "통합 기능정의 & 코드 아키텍처", size: 24 })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 480 },
        children: [new TextRun({ text: "2026년 5월", size: 22, italic: true })]
      }),

      new Paragraph({ children: [new PageBreak()] }),

      // 목차
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("📋 목차")]
      }),
      [
        "1. 프로젝트 전체 개요",
        "2. 핵심 구성요소 및 기술 스택",
        "3. KMD 의약품 검색/관리 시스템",
        "4. 네이버 매출 자동화 시스템",
        "5. 데이터베이스 전체 스키마",
        "6. 전체 API 엔드포인트 맵",
        "7. 페이지 및 컴포넌트 구조",
        "8. 배포 및 운영 설정",
        "9. 미비된 기능 및 개선 로드맵",
        "10. 빠른 시작 가이드"
      ].map(text => new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun(text)]
      })),

      new Paragraph({ children: [new PageBreak()] }),

      // 1. 프로젝트 전체 개요
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("1. 프로젝트 전체 개요")]
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("프로젝트 정보")]
      }),
      createTable([4680, 4680], [
        ["항목", "값"],
        ["프로젝트명", "KMD (의약품 관리 & 판매 자동화)"],
        ["GitHub 레포", "github.com/foggia890919-bit/123"],
        ["주 브랜치", "claude/plan-service-project-Ea4Bn"],
        ["배포 도메인", "https://123-nine-lyart.vercel.app"],
        ["배포 플랫폼", "Vercel (Frontend) + Supabase (DB)"],
        ["보조 인프라", "AWS Lightsail (재고 크롤러 워커)"],
        ["개발 언어", "TypeScript 5"],
        ["프레임워크", "Next.js 16.2 + React 19"],
        ["상태", "운영 중 (미비 사항 진행)"],
      ]),

      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("플랫폼의 두 가지 핵심 영역")]
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("1️⃣ KMD: 의약품 검색 & 제안 시스템")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("대상: 약사, 의사, 영업사원, 약국")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("기능: 의약품 검색 → 재고 조회 → 제안서 생성 → PDF 저장")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("데이터: 의약품 마스터(공공+사용자), 원가표, 제안서")]
      }),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("2️⃣ 네이버 매출 자동화: B2C 판매 자동화")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("대상: 네이버 스토어 운영자")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("기능: 주문 동기화 → 매출 집계 → 이익 계산 → 자동 보고")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("채널: Telegram + Google Sheets (일일 자동 보고)")]
      }),

      new Paragraph({ children: [new PageBreak()] }),

      // 2. 핵심 구성요소 및 기술 스택
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("2. 핵심 구성요소 및 기술 스택")]
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("기술 스택")]
      }),
      createTable([3120, 6240], [
        ["레이어", "기술"],
        ["Frontend", "Next.js 16, React 19, TypeScript, Tailwind CSS 4"],
        ["UI Components", "Shadcn/ui, Lucide Icons"],
        ["Backend", "Next.js API Routes (Serverless)"],
        ["ORM", "Prisma 7"],
        ["Database", "PostgreSQL (Supabase)"],
        ["Auth", "NextAuth 4.24 (Session + JWT)"],
        ["PDF", "jsPDF, jsPDF-AutoTable"],
        ["Excel", "XLSX"],
        ["스크래핑", "Puppeteer, Cheerio"],
        ["API 클라이언트", "node-fetch, axios"],
        ["테스트", "Vitest 4"],
        ["린팅", "ESLint 9"],
        ["배포 CI/CD", "GitHub Actions + Vercel"],
      ]),

      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("인프라 구성")]
      }),
      createTable([2880, 6480], [
        ["컴포넌트", "설정"],
        ["Web Server", "Vercel (Next.js Serverless)"],
        ["Database", "Supabase PostgreSQL (managed)"],
        ["Worker", "AWS Lightsail Ubuntu-2medical (13.125.11.218:8080)"],
        ["Object Storage", "Supabase Storage (문서, 이미지)"],
        ["Email", "NextAuth 기본 (관리자 알림)"],
        ["Message", "Telegram Bot API"],
        ["Sheets", "Google Sheets API (v4)"],
        ["AI/LLM", "Claude (분석), Gemini (ICD)"],
      ]),

      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("디렉토리 구조")]
      }),
      new Paragraph({
        children: [new TextRun({ text: "src/", bold: true })]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("app/ - Next.js App Router")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        spacing: { before: 0 },
        children: [new TextRun("├── admin/ - 네이버 매출 대시보드 & 설정")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        spacing: { before: 0 },
        children: [new TextRun("├── api/ - 모든 API 라우트")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        spacing: { before: 0 },
        children: [new TextRun("├── search/ - 의약품 검색 페이지")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        spacing: { before: 0 },
        children: [new TextRun("├── proposals/ - 제안서 작성 & 관리")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        spacing: { before: 0 },
        children: [new TextRun("├── stats/ - 처방통계 분석")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        spacing: { before: 0 },
        children: [new TextRun("├── login/ - 인증")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        spacing: { before: 0 },
        children: [new TextRun("└── filter/ - 품목 필터링")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("components/ - React 컴포넌트")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("lib/ - 유틸리티")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        spacing: { before: 0 },
        children: [new TextRun("├── naver/ - 네이버 API 헬퍼")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        spacing: { before: 0 },
        children: [new TextRun("├── sheets.ts - Google Sheets API")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        spacing: { before: 0 },
        children: [new TextRun("├── auth.ts - NextAuth 설정")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        spacing: { before: 0 },
        children: [new TextRun("└── prisma.ts - DB 클라이언트")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("prisma/ - 데이터베이스 스키마 & 마이그레이션")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("public/ - 정적 파일")]
      }),

      new Paragraph({ children: [new PageBreak()] }),

      // 3. KMD 의약품 시스템
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("3. KMD 의약품 검색/관리 시스템")]
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("3.1 의약품 검색 페이지 (/search)")]
      }),

      new Paragraph({
        children: [new TextRun("사용자가 의약품을 검색하고 실시간 재고를 조회할 수 있는 핵심 페이지")]
      }),
      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("주요 기능")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("다중 필드 검색: 의약품명 | 성분명 | 보험코드")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("회사별 필터 (다중 선택 가능)")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("컬럼 표시/숨김: 가격, 수수료율, 보험코드 등")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("실시간 재고 조회 (Lightsail 워커 연동)")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("배치 재고 조회 (최대 50개 동시)")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("재고 캐싱 (중복 조회 방지)")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("자동 워밍업 (스냅샷 없는 상품)")]
      }),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("API 엔드포인트")]
      }),
      createTable([2880, 6480], [
        ["메서드", "경로"],
        ["GET", "/api/medications/search - 의약품 검색"],
        ["GET", "/api/medications/companies - 회사 목록"],
        ["GET", "/api/inventory/check - 실시간 재고"],
        ["POST", "/api/inventory/batch - 배치 재고"],
      ]),

      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("3.2 제안서 작성 (/proposals)")]
      }),

      new Paragraph({
        children: [new TextRun("영업사원/약사가 고객용 제안서를 작성하고 PDF로 생성")]
      }),
      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("주요 기능")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("검색 결과 → \"제안서에 추가\" 버튼")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("대체약품 제안 (원약 ↔ 대체약품)")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("수량, 단가, 총금액 표시")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("PDF 다운로드")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("제안서 CRUD (목록, 수정, 삭제)")]
      }),

      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("3.3 처방통계 분석 (/stats)")]
      }),

      new Paragraph({
        children: [new TextRun("의사/약사의 처방전 이미지를 분석하여 의약품 통계 추출")]
      }),
      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("주요 기능")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("처방전 이미지 업로드 & OCR 인식")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("의약품 수량/금액 추출")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("총수량, 총금액, 예상수수료 자동 계산")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("ICD 코드 AI 분석 (Gemini)")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("월별 누적 통계")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("합계 박스 (총수량/총금액/수수료) - 헤더 바로 아래")]
      }),

      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("3.4 품목 필터링 요청 (/filter)")]
      }),

      new Paragraph({
        children: [new TextRun("신규 고객/회사의 상품 추가 요청을 관리하는 시스템")]
      }),
      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("주요 기능")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("필터링 요청 제출 (사업자, 회사정보)")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("비즈니스 문서 업로드")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("관리자 승인/거절")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("요청 상태 추적")]
      }),

      new Paragraph({ children: [new PageBreak()] }),

      // 4. 네이버 매출 자동화
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("4. 네이버 매출 자동화 시스템")]
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("개요")]
      }),

      new Paragraph({
        children: [new TextRun("멀티테넌시 기반 네이버 스토어 판매 자동화. 매일 자동으로 매출 보고, 원가 계산, 이익 집계, 텔레그램 & Google Sheets 알림 발송")]
      }),

      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("자동화 워크플로우")]
      }),
      createTable([2880, 6480], [
        ["작업", "일정 (KST)", "대상"],
        ["매출 보고", "매일 09:00", "/api/cron/daily-sales"],
        ["백필 (역주기)", "매 5분", "/api/cron/backfill"],
        ["상품 동기화", "매시간", "/api/cron/product-sync"],
        ["순위 추적", "매일 09:00", "/api/cron/market-crawl"],
      ]),

      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("관리자 대시보드 (/admin/sales)")]
      }),

      createTable([3744, 5616], [
        ["페이지", "기능"],
        ["onboarding", "5단계 위저드 (사업자+스토어+텔레그램+백필)"],
        ["dashboard", "매출·이익·요일·시간대·키워드 분석 (기간 비교)"],
        ["orders", "주문 검색+상세+CSV 내보내기"],
        ["keywords", "옵션↔키워드 자동매핑 룰"],
        ["products", "상품 목록 & 감시 토글"],
        ["costs", "상품별 원가 관리 (옵션/배송/박스비)"],
        ["backfill", "역주기 백필 진행 모니터링"],
        ["health", "환경변수/인증/최근 보고 상태"],
        ["stores", "스토어 관리 (네이버 API 인증)"],
        ["workspaces", "멀티테넌시 워크스페이스 관리"],
      ]),

      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("핵심 기능")]
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("매출 자동화")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("3개 스토어 (비타앤오리진, 여기명품, 와이케이팜) 자동 집계")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("주문 상태별 자동 차감 (CANCELED, RETURNED, REFUNDED 제외)")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("사업자별 텔레그램 메시지 분리 (전체 1개 + 개별 3개)")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("옵션별 sub-line 상세 표시")]
      }),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("백필 (과거 데이터 동기화)")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("과거 1년치 주문 자동 수집")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("7일씩 나누어 진행 (네이버 API 한계)")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("에러 추적 및 자동 재시도")]
      }),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("키워드 자동매핑")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("옵션 → 키워드 자동 매칭 (정규식 규칙)")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("✨ \"빈 옵션 자동 채우기\" 기능")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("우선순위 기반 매칭")]
      }),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("순위 추적")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("검색 결과 내 순위 일일 자동 추적")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Google Sheets에 가로 컬럼 누적")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("텔레그램 전일 대비 알림")]
      }),

      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("멀티테넌시 (워크스페이스)")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("각 사용자별 독립된 워크스페이스")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("워크스페이스별 텔레그램, Google Sheets 설정 오버라이드")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("쿠키 ws=workspaceId로 컨텍스트 결정")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("모든 API가 requireWorkspace() 통과 필수")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("멤버 역할 관리 (OWNER, ADMIN, MEMBER, VIEWER)")]
      }),

      new Paragraph({ children: [new PageBreak()] }),

      // 5. 데이터베이스 스키마
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("5. 데이터베이스 전체 스키마")]
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("User & Auth")]
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("User (사용자)")]
      }),
      createTable([2520, 6840], [
        ["컬럼", "타입 & 설명"],
        ["id", "cuid (고유 ID)"],
        ["email", "String @unique"],
        ["password", "String (bcrypt)"],
        ["name", "String? (선택)"],
        ["role", "ADMIN | SALES_REP | DOCTOR | PHARMACIST"],
        ["approved", "Boolean (관리자 승인)"],
        ["phone, carrier", "String? (선택)"],
        ["createdAt, updatedAt", "DateTime"],
        ["ownedWorkspaces", "Workspace[] 관계"],
        ["workspaceMemberships", "WorkspaceMember[] 관계"],
      ]),

      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("의약품 (Medication)")]
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("Medication")]
      }),
      createTable([2520, 6840], [
        ["컬럼", "타입 & 설명"],
        ["id", "cuid"],
        ["ingredientName", "String (유효성분명, 색인)"],
        ["productName", "String (상품명, 색인)"],
        ["categoryA, B", "String? (분류)"],
        ["companyName", "String (제조사, 색인)"],
        ["insuranceCode", "String? (보험코드, 색인)"],
        ["price", "Int? (기준가)"],
        ["commissionRate", "Float? (수수료율)"],
        ["isSettlement", "Boolean (원외 여부)"],
        ["settlementType", "String? (원외/원내)"],
        ["source", "EXCEL | PUBLIC_API"],
        ["bioStatus", "String? (생동성)"],
        ["originalDrug", "String? (원약)"],
        ["notes", "String? (비고)"],
      ]),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("Proposal & ProposalItem")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Proposal: 제안서 (title, userId, items[])")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("ProposalItem: 항목 (originalMedicationId, altMedicationId, quantity, note)")]
      }),

      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("네이버 매출 자동화")]
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("Workspace (멀티테넌시)")]
      }),
      createTable([2520, 6840], [
        ["컬럼", "타입 & 설명"],
        ["id", "cuid"],
        ["name", "String (워크스페이스명)"],
        ["slug", "String @unique"],
        ["ownerId", "String (FK: User)"],
        ["telegramBotToken", "String? (오버라이드)"],
        ["telegramChatId", "String? (오버라이드)"],
        ["googleSheetsId", "String?"],
        ["googleServiceAccountEmail", "String?"],
        ["googleServiceAccountKey", "String? (암호화)"],
        ["reportTime", "String (HH:mm, KST)"],
        ["enabled", "Boolean"],
      ]),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("NaverStore")]
      }),
      createTable([2520, 6840], [
        ["컬럼", "타입 & 설명"],
        ["id", "cuid"],
        ["workspaceId", "String (FK: Workspace)"],
        ["code", "String (사업자번호)"],
        ["bizName", "String (상호)"],
        ["storeName", "String (스토어명)"],
        ["clientId, clientSecret", "String (네이버 API 인증)"],
        ["enabled", "Boolean"],
        ["lastSyncedAt", "DateTime? (마지막 동기화)"],
        ["products", "NaverProduct[] 관계"],
        ["orders", "NaverOrder[] 관계"],
      ]),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("NaverOrder & NaverOrderItem")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("NaverOrder: orderId, paymentDate, buyerName, totalAmount, status, raw (JSON)")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("NaverOrderItem: 주문 항목별 매출/원가/수수료/이익 계산")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("상태별 자동 차감: CANCELED, RETURNED, REFUNDED")]
      }),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("ProductCost (원가 관리)")]
      }),
      createTable([2520, 6840], [
        ["컬럼", "타입 & 설명"],
        ["id", "cuid"],
        ["productId", "String (FK: NaverProduct)"],
        ["optionName", "String (옵션명)"],
        ["keyword", "String (매칭된 키워드)"],
        ["unitCost", "Int (단위 원가)"],
        ["shippingCost", "Int (배송비)"],
        ["fulfillCost", "Int (이행비)"],
        ["packagingCost", "Int (박스/포장비)"],
        ["etcCost", "Int (기타비용)"],
        ["effectiveAt", "DateTime (적용 시작)"],
        ["updatedAt", "DateTime"],
      ]),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("DailyReportLog & BackfillJob")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("DailyReportLog: 매출 보고 로그 (멱등성: workspaceId + reportDate unique)")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("BackfillJob: 백필 진행 상황 (cursor, status, ordersAdded, itemsAdded, errors)")]
      }),

      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("기타 테이블")]
      }),

      createTable([3120, 6120], [
        ["테이블", "용도"],
        ["MemberCompanyRate", "사용자별 회사별 추가 수수료"],
        ["UserDocument", "사용자 업로드 문서"],
        ["FilterRequest", "품목 필터링 요청"],
        ["ClientCompany", "거래처 정보"],
        ["KeywordRule", "옵션↔키워드 매핑 규칙"],
        ["WorkspaceMember", "워크스페이스 멤버"],
        ["NaverProduct", "네이버 상품"],
        ["SystemSetting", "시스템 설정"],
      ]),

      new Paragraph({ children: [new PageBreak()] }),

      // 6. API 엔드포인트
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("6. 전체 API 엔드포인트 맵")]
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("인증 & 사용자")]
      }),
      createTable([2880, 6480], [
        ["경로", "메서드 & 기능"],
        ["/api/auth/register", "POST - 회원가입"],
        ["/api/auth/forgot-password", "POST - 비밀번호 재설정"],
        ["/api/auth/[...nextauth]", "GET/POST - NextAuth 핸들러"],
        ["/api/admin/users", "GET/POST - 사용자 관리 (ADMIN)"],
      ]),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("의약품 검색 & 재고")]
      }),
      createTable([2880, 6480], [
        ["경로", "메서드 & 기능"],
        ["/api/medications/search", "GET - 의약품 검색"],
        ["/api/medications/companies", "GET - 회사 목록"],
        ["/api/medications/filter", "GET/POST - 상품 필터"],
        ["/api/medications/sync", "POST - 의약품 동기화"],
        ["/api/inventory/check", "GET - 실시간 재고"],
        ["/api/inventory/batch", "POST - 배치 재고"],
      ]),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("필터링 & 제안서")]
      }),
      createTable([2880, 6480], [
        ["경로", "메서드 & 기능"],
        ["/api/filter-request", "GET/POST/PATCH - 필터링 요청 CRUD"],
        ["/api/filter-request/company-status", "POST - 회사 상태 조회"],
      ]),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("네이버 매출 자동화")]
      }),
      createTable([2880, 6480], [
        ["경로", "메서드 & 기능"],
        ["/api/sales/dashboard", "GET - 매출 대시보드 데이터"],
        ["/api/sales/orders", "GET - 주문 검색"],
        ["/api/sales/keywords", "GET/POST - 키워드 매핑"],
        ["/api/sales/products", "GET - 상품 목록"],
        ["/api/sales/costs", "GET/POST - 원가 관리"],
        ["/api/cron/daily-sales", "POST - 일일 매출 보고"],
        ["/api/cron/backfill", "POST - 백필 진행"],
        ["/api/cron/product-sync", "POST - 상품 동기화"],
        ["/api/cron/market-crawl", "POST - 시장조사"],
      ]),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("AI & 분석")]
      }),
      createTable([2880, 6480], [
        ["경로", "메서드 & 기능"],
        ["/api/ai/auto-switch", "POST - Claude/Gemini 자동 선택"],
        ["/api/medications/icd-analysis", "POST - ICD 코드 분석"],
      ]),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("관리자 전용")]
      }),
      createTable([2880, 6480], [
        ["경로", "메서드 & 기능"],
        ["/api/admin/rates", "GET/POST - 수수료율 관리"],
        ["/api/admin/preview-source", "POST - 데이터 소스 미리보기"],
      ]),

      new Paragraph({ children: [new PageBreak()] }),

      // 7. 페이지 및 컴포넌트
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("7. 페이지 및 컴포넌트 구조")]
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("공개 페이지")]
      }),
      createTable([2880, 6480], [
        ["경로", "페이지"],
        ["/", "홈 (Vercel 기본)"],
        ["/login", "로그인"],
        ["/register", "회원가입"],
        ["/forgot-password", "비밀번호 재설정"],
      ]),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("인증된 사용자 페이지")]
      }),
      createTable([2880, 6480], [
        ["경로", "기능"],
        ["/search", "의약품 검색 & 재고 조회"],
        ["/proposals", "제안서 작성 & 관리"],
        ["/stats", "처방통계 분석"],
        ["/mypage", "사용자 프로필"],
        ["/filter", "필터링 요청 목록"],
        ["/filter-list", "필터링 요청 상세"],
      ]),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("관리자 페이지 (/admin/sales/)")]
      }),
      createTable([2880, 6480], [
        ["경로", "페이지"],
        ["/admin/login", "관리자 로그인"],
        ["/admin/dashboard", "KMD 통계 대시보드"],
        ["/admin/sales", "매출 자동화 홈"],
        ["/admin/sales/onboarding", "5단계 위저드"],
        ["/admin/sales/dashboard", "매출 대시보드"],
        ["/admin/sales/orders", "주문 검색"],
        ["/admin/sales/keywords", "키워드 매핑"],
        ["/admin/sales/products", "상품 관리"],
        ["/admin/sales/costs", "원가 관리"],
        ["/admin/sales/backfill", "백필 모니터링"],
        ["/admin/sales/health", "상태 확인"],
        ["/admin/sales/stores", "스토어 관리"],
        ["/admin/sales/workspaces", "워크스페이스 관리"],
      ]),

      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("주요 컴포넌트")]
      }),
      createTable([2880, 6480], [
        ["컴포넌트", "용도"],
        ["MedicationTable", "의약품 테이블 표시"],
        ["ColumnToggles", "컬럼 표시/숨김"],
        ["StockCheckModal", "개별 재고 조회"],
        ["StockCheckBatchModal", "배치 재고 조회"],
        ["RequireAuth", "인증 보호 HOC"],
        ["DashboardChart", "차트/그래프"],
      ]),

      new Paragraph({ children: [new PageBreak()] }),

      // 8. 배포 및 운영
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("8. 배포 및 운영 설정")]
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("배포 플랫폼")]
      }),
      createTable([3744, 5616], [
        ["컴포넌트", "플랫폼 & 설정"],
        ["Frontend/Backend", "Vercel (https://123-nine-lyart.vercel.app)"],
        ["Database", "Supabase PostgreSQL (managed)"],
        ["객체 저장소", "Supabase Storage"],
        ["Worker", "AWS Lightsail Ubuntu-2medical (13.125.11.218:8080)"],
        ["CI/CD", "GitHub Actions (.github/workflows/ci.yml)"],
      ]),

      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("필수 환경변수")]
      }),
      createTable([2520, 6840], [
        ["키", "설명"],
        ["DATABASE_URL", "PostgreSQL 연결 (Supabase)"],
        ["NEXTAUTH_SECRET", "NextAuth 세션 키"],
        ["NEXTAUTH_URL", "OAuth 콜백 URL"],
        ["CRON_SECRET", "cron 끝점 보호"],
        ["ENCRYPTION_KEY", "시크릿 암호화 (32바이트 hex)"],
      ]),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("선택 (워크스페이스 오버라이드 가능)")]
      }),
      createTable([2520, 6840], [
        ["키", "설명"],
        ["TELEGRAM_BOT_TOKEN", "기본 텔레그램 봇"],
        ["TELEGRAM_CHAT_ID", "기본 텔레그램 채팅"],
        ["GOOGLE_SHEETS_ID", "기본 Google Sheets"],
        ["GOOGLE_SERVICE_ACCOUNT_*", "Google 서비스 계정"],
        ["GEMINI_API_KEY", "Gemini AI"],
        ["WORKER_URL", "Lightsail 워커 URL"],
        ["WORKER_TOKEN", "워커 인증 토큰"],
      ]),

      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("로컬 개발")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("npm install - 의존성 설치")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("npm run dev - 개발 서버 (localhost:3000)")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("npm run build - 빌드")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("npm start - 프로덕션 실행")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("npm test - Vitest")]
      }),

      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("DB 마이그레이션")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("스키마 변경: npx prisma migrate dev --name <description>")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("빠른 개발: npx prisma db push")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("배포: DATABASE_URL=\"...\" npx prisma migrate deploy")]
      }),

      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Lightsail 워커 셋업")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("인스턴스: Ubuntu-2medical 1GB RAM ($7/월)")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("고정 IP: 13.125.11.218")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("포트: 8080 (방화벽: Any IPv4)")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("자동 시작: systemctl enable worker")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("헬스 체크: curl http://13.125.11.218:8080/health")]
      }),

      new Paragraph({ children: [new PageBreak()] }),

      // 9. 미비된 기능
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("9. 미비된 기능 및 개선 로드맵")]
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("🔴 우선순위 1: Medication 테이블 리팩토링")]
      }),

      new Paragraph({
        children: [new TextRun({ text: "상태: SQL 스크립트 준비됨 (사용자 승인 대기)", italic: true })]
      }),
      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("문제점")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("요율표 업로드 시 사용자 데이터(수수료율, 정산정보)가 공공 마스터 테이블에 저장")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("결과: 45,334개 레코드 중 비표준 코드 339개가 마스터처럼 박혀있음")]
      }),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("해결 방안")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Phase 1: MedicationRate 테이블 생성 (medicationId FK, commissionRate, isSettlement, settlementType)")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Phase 2: Medication → MedicationRate 데이터 마이그레이션")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Phase 3: Medication 컬럼 제거")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Phase 4: 모든 API & 페이지 업데이트")]
      }),

      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("🟡 우선순위 2: ICD 코드 AI 분석 정확도")]
      }),

      new Paragraph({
        children: [new TextRun({ text: "상태: 해결 방법 선택 필요", italic: true })]
      }),
      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("현재 상황")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Gemini AI가 처방전 이미지를 분석해 ICD 코드 추정")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("문제 1: 비율이 5/10 단위로 깔끔함 (실제 비율 아님)")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("문제 2: 동반질환 섞임 (예: 고지혈증약에 당뇨병 함께 표시)")]
      }),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("해결 옵션 (선택 필요)")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Option A: ICD 분석 기능 제거")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Option B: 큰 Disclaimer 추가")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("Option C: HIRA 실제 공공데이터 연동 (시간 소요)")]
      }),

      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("🟢 우선순위 3: 인프라 정리")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("☐ Lightsail 옛 인스턴스 (inventory-worker 512MB) 삭제")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("☐ 포트 8080 방화벽: Any IPv4 설정 (현재 진행 중)")]
      }),

      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("📋 개선 사항 체크리스트")]
      }),

      createTable([9360], [
        ["개선 항목"],
        ["☐ Medication 테이블 리팩토링 (MedicationRate 분리)"],
        ["☐ ICD 분석 정확도 해결방안 선택 & 시행"],
        ["☐ 처방통계 합계 박스 위치 재확인"],
        ["☐ Lightsail 옛 인스턴스 정리"],
        ["☐ 포트 8080 방화벽 설정"],
        ["☐ API 라우트 단위 테스트 추가"],
        ["☐ 통합 테스트 작성 (재고, 매출보고)"],
        ["☐ 검색 페이지 성능 최적화"],
        ["☐ 제안서 PDF 템플릿 고도화"],
        ["☐ 모바일 반응형 개선"],
      ]),

      new Paragraph({ children: [new PageBreak()] }),

      // 10. 빠른 시작
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("10. 빠른 시작 가이드")]
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("개발 환경 셋업")]
      }),

      new Paragraph({
        children: [new TextRun("1. 클론 & 의존성 설치")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("git clone https://github.com/foggia890919-bit/123.git")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("cd 123")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("npm install")]
      }),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        children: [new TextRun("2. 환경변수 설정 (.env.local)")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("DATABASE_URL=postgresql://...")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("NEXTAUTH_SECRET=...")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("NEXTAUTH_URL=http://localhost:3000")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("(기타 환경변수는 8. 배포 섹션 참조)")]
      }),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        children: [new TextRun("3. DB 동기화")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("npx prisma db push")]
      }),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        children: [new TextRun("4. 개발 서버 실행")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("npm run dev")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("http://localhost:3000 접속")]
      }),

      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("프로덕션 배포")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("1. 코드 변경 커밋 & 푸시")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("2. GitHub 푸시 → Vercel 자동 배포")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("3. 환경변수 Vercel 콘솔에서 확인")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("4. 배포 완료 후 https://123-nine-lyart.vercel.app 확인")]
      }),

      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("주요 커맨드")]
      }),

      createTable([3744, 5616], [
        ["커맨드", "설명"],
        ["npm run dev", "개발 서버 (localhost:3000)"],
        ["npm run build", "빌드"],
        ["npm start", "프로덕션 실행"],
        ["npm test", "테스트"],
        ["npm run lint", "린팅"],
        ["npx prisma studio", "DB 브라우저"],
        ["npx prisma migrate dev --name X", "스키마 마이그레이션"],
      ]),

      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("문제 해결")]
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("재고 조회가 \"서버 연결 불가\" 에러")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("→ Lightsail 포트 8080 방화벽 확인")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("→ WORKER_URL 환경변수 확인")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("→ curl http://13.125.11.218:8080/health 테스트")]
      }),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("로그인이 작동하지 않음")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("→ NEXTAUTH_SECRET, NEXTAUTH_URL 확인")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("→ Database 연결 확인")]
      }),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("텔레그램 알림이 안 옴")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("→ /admin/sales/health 에서 텔레그램 ✅ 확인")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("→ \"텔레그램 핑\" 버튼으로 즉시 검증")]
      }),

      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("")] }),

      // 최종
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("요약")]
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("KMD 플랫폼이란?")]
      }),

      new Paragraph({
        children: [new TextRun("KMD는 의약품 관리와 네이버 판매 자동화를 하나의 플랫폼에서 제공하는 엔터프라이즈 시스템입니다. Next.js + Supabase + Lightsail 조합으로 안정적인 운영 중입니다.")]
      }),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("핵심 3가지")]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("✅ 의약품 검색 → 재고 조회 → 제안서 생성 (KMD 시스템)")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("✅ 주문 자동 동기화 → 매출 집계 → 자동 보고 (네이버 자동화)")]
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun("✅ 멀티테넌시 & 멀티유저 → 역할 기반 권한 관리")]
      }),

      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] }),

      new Paragraph({
        children: [new TextRun("이 문서가 KMD 플랫폼의 전체 모습을 파악하는 데 도움이 되기를 바랍니다.")]
      }),
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("C:\\Users\\김성준\\Desktop\\KMD_통합기능정의서.docx", buffer);
  console.log("✅ Document created: C:\\Users\\김성준\\Desktop\\KMD_통합기능정의서.docx");
}).catch(err => {
  console.error("❌ Error:", err);
});
