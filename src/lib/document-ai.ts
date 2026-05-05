// Google Document AI Form Parser 호출 + 응답 파싱.
//
// 처방통계 표 같은 정형 문서의 텍스트·테이블·폼필드를 추출.
// 한국어 지원. 기울어진 사진·꾸겨진 종이도 ML 로 자동 dewarp.
//
// 환경변수:
//   GCP_PROJECT_ID            — 프로젝트 번호 또는 프로젝트 ID (예: 231295969267)
//   GCP_DOCAI_LOCATION        — us | eu (default us)
//   GCP_DOCAI_PROCESSOR_ID    — 프로세서 ID (예: fd38aca9509a6841)
//   GCP_SA_JSON               — Service Account JSON 전체 (google-auth.ts 가 사용)

import { getAccessToken } from "./google-auth";

interface Vertex { x?: number; y?: number }
interface BoundingPoly { vertices?: Vertex[]; normalizedVertices?: Vertex[] }
interface Layout { textAnchor?: { textSegments?: { startIndex?: string; endIndex?: string }[] }; boundingPoly?: BoundingPoly; confidence?: number }
interface TableCell { layout?: Layout; rowSpan?: number; colSpan?: number }
interface TableRow { cells?: TableCell[] }
interface DocumentTable { headerRows?: TableRow[]; bodyRows?: TableRow[]; layout?: Layout }
interface DocumentPage {
  pageNumber?: number;
  dimension?: { width?: number; height?: number };
  tables?: DocumentTable[];
}
interface DocumentResponse {
  text?: string;
  pages?: DocumentPage[];
}

export interface DocAiTableRow {
  cells: string[];
}

export interface DocAiResult {
  rawText: string;                          // 전체 추출 텍스트
  tables: DocAiTableRow[][];                // [tableIdx][rowIdx].cells[colIdx]
  pageCount: number;
  pageWidth: number;
  pageHeight: number;
}

export function isDocumentAiConfigured(): boolean {
  return !!(process.env.GCP_PROJECT_ID && process.env.GCP_DOCAI_PROCESSOR_ID && process.env.GCP_SA_JSON);
}

function endpoint(): string {
  const project = process.env.GCP_PROJECT_ID!;
  const location = process.env.GCP_DOCAI_LOCATION || "us";
  const processor = process.env.GCP_DOCAI_PROCESSOR_ID!;
  return `https://${location}-documentai.googleapis.com/v1/projects/${project}/locations/${location}/processors/${processor}:process`;
}

export async function callDocumentAi(imageBase64: string, mimeType: string): Promise<DocAiResult> {
  const token = await getAccessToken();
  const body = {
    rawDocument: {
      content: imageBase64,
      mimeType,
    },
  };
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Document AI 실패 (${res.status}): ${txt.slice(0, 500)}`);
  }
  const data = await res.json() as { document?: DocumentResponse };
  const doc = data.document;
  if (!doc) throw new Error("Document AI 응답에 document 필드 없음");

  const fullText = doc.text ?? "";
  const pages = doc.pages ?? [];
  const tables: DocAiTableRow[][] = [];

  for (const page of pages) {
    for (const tbl of page.tables ?? []) {
      const rows: DocAiTableRow[] = [];
      for (const r of [...(tbl.headerRows ?? []), ...(tbl.bodyRows ?? [])]) {
        const cells: string[] = [];
        for (const c of r.cells ?? []) {
          cells.push(extractText(fullText, c.layout));
        }
        if (cells.some((s) => s.trim())) rows.push({ cells });
      }
      if (rows.length > 0) tables.push(rows);
    }
  }

  const firstPage = pages[0];
  return {
    rawText: fullText,
    tables,
    pageCount: pages.length,
    pageWidth: firstPage?.dimension?.width ?? 0,
    pageHeight: firstPage?.dimension?.height ?? 0,
  };
}

function extractText(fullText: string, layout?: Layout): string {
  if (!layout?.textAnchor?.textSegments) return "";
  let result = "";
  for (const seg of layout.textAnchor.textSegments) {
    const start = parseInt(seg.startIndex ?? "0", 10);
    const end = parseInt(seg.endIndex ?? "0", 10);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      result += fullText.slice(start, end);
    }
  }
  return result.replace(/\s+/g, " ").trim();
}
