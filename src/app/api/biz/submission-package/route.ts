import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, parseDataUri, extensionFromMime } from "@/lib/storage";
import { normalizeCompanyKey } from "@/lib/utils";
import JSZip from "jszip";
import ExcelJS from "exceljs";

// GET /api/biz/submission-package?year=2026&month=5&entity=메디펄스(optional)
//
// 월별 처방통계를 (제출처 → 제약사) 별로 분리하여 ZIP 으로 반환.
// 한 처방전 이미지에 여러 제약사 약품이 있으면 제약사별로 사본 생성.
//
// 누락 방지:
//  - 제약사명 정규화 매칭 (앞의 "(주)"·공백·법인접미어 제거 후 비교)
//  - 거래처명 정규화 매칭 (공백·소문자)
//  - 이미지 fetch 실패 추적 → _요약.txt 의 "이미지 누락" 섹션
//  - finalDrugs 가 비어있는 report 추적 → _요약.txt 의 "OCR 미완료" 섹션
//  - 미매핑 (제약사,거래처) 목록 → _미매핑.txt 와 _요약.txt
//
// ZIP 구조:
//   {YYYYMM}_제출패키지/
//   ├── {제출처}/
//   │   ├── {제약사}_{YYYYMM}.xlsx     ← 겉표지 시트 + 세부내역 시트
//   │   └── {제약사}_이미지/
//   │       └── {병원명}_{제약사}_{YYYYMM}.jpg
//   ├── _미매핑.txt
//   └── _요약.txt

const UNMAPPED = "_미매핑";

interface FinalDrug {
  insuranceCode?: string;
  companyName?: string;
  productName?: string;
  quantity?: string | number;
  unitPrice?: number | null;
  commissionRate?: number | null;
  additionalRate?: number | null;
}

interface DrugRow {
  hospitalName: string;
  bizNumber: string;
  insuranceCode: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  amount: number; // 처방금액 = qty × price
}

function safeName(s: string): string {
  return (s || "").replace(/[/\\:*?"<>|\n\r\t]/g, "_").trim() || "_";
}

function toNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

// 거래처명 정규화 — 공백·zero-width 제거 + 소문자.
// 제약사명 정규화처럼 적극적으로 prefix 를 깎지는 않음 (병원명이 너무 짧아져 충돌 위험).
function normalizeClientKey(s: string): string {
  if (!s) return "";
  return s.replace(/[\s​-‍﻿]/g, "").toLowerCase();
}

async function fetchImage(report: { imageKey: string | null; imageData: string | null }): Promise<{ buf: Buffer; ext: string } | null> {
  if (report.imageKey && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const url = `${process.env.SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/${BUCKETS.prescriptionImage}/${encodeURI(report.imageKey)}`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } });
      if (res.ok) {
        const ct = res.headers.get("content-type") ?? "image/jpeg";
        return { buf: Buffer.from(await res.arrayBuffer()), ext: extensionFromMime(ct) };
      }
    } catch {}
  }
  if (report.imageData) {
    const parsed = parseDataUri(report.imageData);
    if (parsed) return { buf: parsed.data, ext: extensionFromMime(parsed.contentType) };
  }
  return null;
}

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (user.role !== "BIZ" && user.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const year = parseInt(req.nextUrl.searchParams.get("year") || "0", 10);
  const month = parseInt(req.nextUrl.searchParams.get("month") || "0", 10);
  const entityFilter = req.nextUrl.searchParams.get("entity") || "";
  if (!year || !month) return NextResponse.json({ error: "year, month 필요" }, { status: 400 });

  // 1) 그 월의 모든 PrescriptionReport — 권한 정책은 Phase 1B 에서 정밀화. 여기선 전체 조회.
  const reports = await prisma.prescriptionReport.findMany({
    where: { year, month },
    select: {
      id: true, hospitalName: true, clientId: true, status: true, createdAt: true,
      imageKey: true, imageData: true, ocrData: true, totalFee: true,
      client: { select: { clientName: true, bizNumber: true } },
    },
  });

  // ── 누락 추적용
  const reportsWithNoDrugs: { id: string; clientName: string; createdAt: Date }[] = [];
  const imageFailures: { id: string; clientName: string; reason: string }[] = [];

  // 2) 모든 (clientName × companyName) 쌍 수집
  type Pair = { clientName: string; companyName: string };
  const pairSet = new Set<string>();
  const drugRowsByPair = new Map<string, DrugRow[]>(); // key = clientName::companyName

  for (const r of reports) {
    const clientName = r.client?.clientName ?? r.hospitalName ?? "(미상)";
    const bizNumber = r.client?.bizNumber ?? "";
    const drugs = (r.ocrData as { finalDrugs?: FinalDrug[] } | null)?.finalDrugs ?? [];
    if (drugs.length === 0) {
      reportsWithNoDrugs.push({ id: r.id, clientName, createdAt: r.createdAt });
      continue;
    }
    for (const d of drugs) {
      const companyName = (d.companyName || "").trim() || "(미분류)";
      const qty = toNum(d.quantity);
      const price = toNum(d.unitPrice ?? 0);
      const amount = qty * price;
      const row: DrugRow = {
        hospitalName: clientName, bizNumber,
        insuranceCode: d.insuranceCode || "", productName: d.productName || "",
        quantity: qty, unitPrice: price, amount,
      };
      const key = `${clientName}::${companyName}`;
      pairSet.add(key);
      if (!drugRowsByPair.has(key)) drugRowsByPair.set(key, []);
      drugRowsByPair.get(key)!.push(row);
    }
  }

  // 3) SubmissionRoute lookup — 정규화 키로 매칭하여 (주)/공백/대소문자 차이 흡수
  const allRoutes = await prisma.submissionRoute.findMany({
    where: { active: true },
    select: { clientName: true, companyName: true, submissionEntity: true },
  });
  const routeNormMap = new Map<string, string>();
  for (const r of allRoutes) {
    const k = `${normalizeClientKey(r.clientName)}::${normalizeCompanyKey(r.companyName)}`;
    routeNormMap.set(k, r.submissionEntity);
  }
  function lookupEntity(clientName: string, companyName: string): string | null {
    if (companyName === "(미분류)") return null;
    const k = `${normalizeClientKey(clientName)}::${normalizeCompanyKey(companyName)}`;
    return routeNormMap.get(k) ?? null;
  }

  // 4) 제출처별 그룹화
  type GroupKey = string; // submissionEntity
  type CompanyKey = string; // companyName (원본 표기)
  const grouped = new Map<GroupKey, Map<CompanyKey, DrugRow[]>>();
  const unmapped: Pair[] = [];

  for (const [pairKey, rows] of drugRowsByPair) {
    const [clientName, companyName] = pairKey.split("::");
    const entity = lookupEntity(clientName, companyName) ?? UNMAPPED;
    if (entity === UNMAPPED) unmapped.push({ clientName, companyName });
    if (entityFilter && entity !== entityFilter) continue;
    if (!grouped.has(entity)) grouped.set(entity, new Map());
    const companyMap = grouped.get(entity)!;
    if (!companyMap.has(companyName)) companyMap.set(companyName, []);
    companyMap.get(companyName)!.push(...rows);
  }

  if (grouped.size === 0 && reportsWithNoDrugs.length === 0) {
    return NextResponse.json({ error: "해당 조건에 제출 가능한 데이터가 없어요." }, { status: 404 });
  }

  // 5) 이미지 fetch 캐시 + 실패 추적
  const imageCache = new Map<string, { buf: Buffer; ext: string } | null>();
  async function getImage(report: typeof reports[number]) {
    if (!imageCache.has(report.id)) {
      const result = await fetchImage(report);
      imageCache.set(report.id, result);
      if (!result) {
        const reason = !report.imageKey && !report.imageData ? "이미지 자체 없음"
                     : report.imageKey ? "Supabase Storage fetch 실패" : "imageData 파싱 실패";
        imageFailures.push({
          id: report.id,
          clientName: report.client?.clientName ?? report.hospitalName ?? "(미상)",
          reason,
        });
      }
    }
    return imageCache.get(report.id) ?? null;
  }

  // 6) ZIP 생성
  const zip = new JSZip();
  const yymm = `${year}${String(month).padStart(2, "0")}`;
  const rootFolderName = `${yymm}_제출패키지`;
  const root = zip.folder(rootFolderName)!;
  let imageWriteCount = 0;

  for (const [entity, companyMap] of grouped) {
    const entityFolder = root.folder(safeName(entity))!;
    for (const [companyName, rows] of companyMap) {
      // ── Excel (겉표지 + 세부내역)
      const wb = new ExcelJS.Workbook();
      const cover = wb.addWorksheet("겉표지");
      cover.columns = [
        { header: "사업자번호", key: "biz", width: 18 },
        { header: "병원명", key: "name", width: 28 },
        { header: "총금액", key: "total", width: 16, style: { numFmt: "#,##0" } },
      ];
      const byHospital = new Map<string, { biz: string; total: number }>();
      for (const r of rows) {
        const cur = byHospital.get(r.hospitalName) ?? { biz: r.bizNumber, total: 0 };
        cur.total += r.amount;
        if (!cur.biz && r.bizNumber) cur.biz = r.bizNumber;
        byHospital.set(r.hospitalName, cur);
      }
      for (const [name, agg] of byHospital) cover.addRow({ biz: agg.biz, name, total: agg.total });
      cover.getRow(1).font = { bold: true };
      cover.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };

      const detail = wb.addWorksheet("세부내역");
      detail.columns = [
        { header: "병원명", key: "hospital", width: 24 },
        { header: "보험코드", key: "code", width: 14 },
        { header: "제품명", key: "product", width: 32 },
        { header: "수량", key: "qty", width: 10, style: { numFmt: "#,##0" } },
        { header: "단가", key: "price", width: 12, style: { numFmt: "#,##0" } },
        { header: "처방금액", key: "amount", width: 14, style: { numFmt: "#,##0" } },
      ];
      for (const r of rows) {
        detail.addRow({
          hospital: r.hospitalName, code: r.insuranceCode, product: r.productName,
          qty: r.quantity, price: r.unitPrice, amount: r.amount,
        });
      }
      detail.getRow(1).font = { bold: true };
      detail.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };

      const wbBuf = await wb.xlsx.writeBuffer();
      entityFolder.file(`${safeName(companyName)}_${yymm}.xlsx`, wbBuf);

      // ── 이미지 사본
      const clientNamesForCompany = [...new Set(rows.map((r) => r.hospitalName))];
      const imgFolder = entityFolder.folder(`${safeName(companyName)}_이미지`)!;
      for (const clientName of clientNamesForCompany) {
        const matchingReports = reports.filter((r) =>
          (r.client?.clientName ?? r.hospitalName) === clientName &&
          ((r.ocrData as { finalDrugs?: FinalDrug[] } | null)?.finalDrugs ?? []).some(
            (d) => ((d.companyName || "").trim() || "(미분류)") === companyName,
          ),
        );
        let copyIdx = 0;
        for (const rep of matchingReports) {
          const img = await getImage(rep);
          if (!img) continue;
          copyIdx++;
          const suffix = matchingReports.length > 1 ? `_${copyIdx}` : "";
          const fname = `${safeName(clientName)}_${safeName(companyName)}_${yymm}${suffix}.${img.ext || "jpg"}`;
          imgFolder.file(fname, img.buf);
          imageWriteCount++;
        }
      }
    }
  }

  // 7) 미매핑 목록
  if (unmapped.length > 0) {
    const txt = [
      `[제출처 미매핑 (제약사 × 거래처) 목록] ${year}년 ${month}월`,
      "통계제출처 관리에서 SubmissionRoute 등록 후 다시 다운로드하세요.",
      "(주)/공백 차이는 자동 흡수되므로 진짜 매핑이 없는 건들입니다.",
      "",
      ...unmapped.map((u, i) => `${i + 1}. ${u.clientName} × ${u.companyName}`),
    ].join("\n");
    root.file("_미매핑.txt", txt);
  }

  // 8) 종합 요약 — 모든 누락 시나리오를 한 파일에서 확인
  const totalDrugRows = [...drugRowsByPair.values()].reduce((s, rows) => s + rows.length, 0);
  const summary = [
    `[제출 패키지 요약] ${year}년 ${month}월`,
    `생성일시: ${new Date().toLocaleString("ko-KR")}${entityFilter ? ` · 제출처 필터: ${entityFilter}` : ""}`,
    "",
    "── 처리 통계",
    `- 대상 PrescriptionReport: ${reports.length}건`,
    `- (제약사 × 거래처) 쌍: ${pairSet.size}개`,
    `- 약품 행 합계: ${totalDrugRows.toLocaleString()}행`,
    `- 제출처 그룹: ${grouped.size}곳`,
    `- 이미지 사본 생성: ${imageWriteCount}건`,
    "",
    "── ⚠ 누락·점검 필요 항목",
    `- OCR 미완료 (finalDrugs 없음): ${reportsWithNoDrugs.length}건`,
    `- 제출처 미매핑 (제약사 × 거래처): ${unmapped.length}건`,
    `- 이미지 fetch 실패: ${imageFailures.length}건`,
    "",
  ];

  if (reportsWithNoDrugs.length > 0) {
    summary.push("── OCR 미완료 (해당 report 다시 인식 필요)");
    summary.push(...reportsWithNoDrugs.map((r, i) =>
      `  ${i + 1}. ${r.clientName} · ${new Date(r.createdAt).toLocaleDateString("ko-KR")} · id=${r.id}`));
    summary.push("");
  }
  if (imageFailures.length > 0) {
    summary.push("── 이미지 fetch 실패");
    summary.push(...imageFailures.map((f, i) => `  ${i + 1}. ${f.clientName} · ${f.reason} · id=${f.id}`));
    summary.push("");
  }
  if (unmapped.length > 0) {
    summary.push("── 미매핑 (자세한 내용은 _미매핑.txt 참조)");
    summary.push(`  총 ${unmapped.length}건`);
  }
  root.file("_요약.txt", summary.join("\n"));

  const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const filename = `${rootFolderName}${entityFilter ? `_${safeName(entityFilter)}` : ""}.zip`;
  return new NextResponse(new Uint8Array(zipBuf), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "X-Entity-Count": String(grouped.size),
      "X-Unmapped-Count": String(unmapped.length),
      "X-No-Drugs-Count": String(reportsWithNoDrugs.length),
      "X-Image-Failure-Count": String(imageFailures.length),
      "X-Image-Write-Count": String(imageWriteCount),
    },
  });
}
