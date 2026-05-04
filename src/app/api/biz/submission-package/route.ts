import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, parseDataUri, extensionFromMime } from "@/lib/storage";
import JSZip from "jszip";
import ExcelJS from "exceljs";

// GET /api/biz/submission-package?year=2026&month=5&entity=메디펄스(optional)
//
// 월별 제출된 처방통계를 (제출처 → 제약사) 별로 분리하여 ZIP 으로 반환.
// 한 처방전 이미지에 여러 제약사 약품이 있으면 제약사별로 사본 생성.
//
// ZIP 구조:
//   {YYYYMM}_제출패키지/
//   ├── {제출처}/
//   │   ├── {제약사}_{YYYYMM}.xlsx     ← 겉표지 시트 + 세부내역 시트
//   │   └── {제약사}_이미지/
//   │       └── {병원명}_{제약사}_{YYYYMM}.jpg
//   └── _미매핑.txt                    ← SubmissionRoute 미등록 (제약사,거래처) 목록

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
      id: true, hospitalName: true, clientId: true,
      imageKey: true, imageData: true, ocrData: true, totalFee: true,
      client: { select: { clientName: true, bizNumber: true } },
    },
  });

  // 2) 모든 (clientName × companyName) 쌍 수집 → SubmissionRoute lookup
  type Pair = { clientName: string; companyName: string };
  const pairSet = new Set<string>();
  const drugRowsByPair = new Map<string, DrugRow[]>(); // key = clientName::companyName

  for (const r of reports) {
    const clientName = r.client?.clientName ?? r.hospitalName ?? "(미상)";
    const bizNumber = r.client?.bizNumber ?? "";
    const drugs = (r.ocrData as { finalDrugs?: FinalDrug[] } | null)?.finalDrugs ?? [];
    for (const d of drugs) {
      const companyName = (d.companyName || "").trim() || "(미분류)";
      const qty = toNum(d.quantity);
      const price = toNum(d.unitPrice ?? 0);
      const amount = qty * price;
      const row: DrugRow = {
        hospitalName: clientName,
        bizNumber,
        insuranceCode: d.insuranceCode || "",
        productName: d.productName || "",
        quantity: qty,
        unitPrice: price,
        amount,
      };
      const key = `${clientName}::${companyName}`;
      pairSet.add(key);
      if (!drugRowsByPair.has(key)) drugRowsByPair.set(key, []);
      drugRowsByPair.get(key)!.push(row);
    }
  }

  const pairs: Pair[] = [...pairSet].map((k) => {
    const [clientName, companyName] = k.split("::");
    return { clientName, companyName };
  });

  // 3) SubmissionRoute lookup → submissionEntity per (clientName, companyName)
  const routes = pairs.length > 0 ? await prisma.submissionRoute.findMany({
    where: {
      active: true,
      OR: pairs.map((p) => ({ clientName: p.clientName, companyName: p.companyName })),
    },
    select: { clientName: true, companyName: true, submissionEntity: true },
  }) : [];
  const routeMap = new Map<string, string>();
  for (const r of routes) routeMap.set(`${r.clientName}::${r.companyName}`, r.submissionEntity);

  // 4) 제출처별 그룹화
  type GroupKey = string; // submissionEntity
  type CompanyKey = string; // companyName
  const grouped = new Map<GroupKey, Map<CompanyKey, DrugRow[]>>();
  const unmapped: Pair[] = [];

  for (const [pairKey, rows] of drugRowsByPair) {
    const entity = routeMap.get(pairKey) ?? UNMAPPED;
    if (entity === UNMAPPED) {
      const [clientName, companyName] = pairKey.split("::");
      unmapped.push({ clientName, companyName });
    }
    if (entityFilter && entity !== entityFilter) continue;
    const [, companyName] = pairKey.split("::");
    if (!grouped.has(entity)) grouped.set(entity, new Map());
    const companyMap = grouped.get(entity)!;
    if (!companyMap.has(companyName)) companyMap.set(companyName, []);
    companyMap.get(companyName)!.push(...rows);
  }

  if (grouped.size === 0) {
    return NextResponse.json({ error: "해당 조건에 제출 가능한 데이터가 없어요." }, { status: 404 });
  }

  // 5) 이미지 fetch 캐시 (한 report 가 여러 제약사에서 재사용됨)
  const imageCache = new Map<string, { buf: Buffer; ext: string } | null>();
  async function getImage(report: typeof reports[number]) {
    if (!imageCache.has(report.id)) imageCache.set(report.id, await fetchImage(report));
    return imageCache.get(report.id) ?? null;
  }

  // 6) ZIP 생성
  const zip = new JSZip();
  const yymm = `${year}${String(month).padStart(2, "0")}`;
  const rootFolderName = `${yymm}_제출패키지`;
  const root = zip.folder(rootFolderName)!;

  for (const [entity, companyMap] of grouped) {
    const entityFolder = root.folder(safeName(entity))!;
    for (const [companyName, rows] of companyMap) {
      const companyFolder = entityFolder; // 제약사를 폴더로 만들지 않고 평탄화

      // ── Excel 생성 (겉표지 + 세부내역)
      const wb = new ExcelJS.Workbook();

      // 겉표지: 거래처별 합계
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
      for (const [name, agg] of byHospital) {
        cover.addRow({ biz: agg.biz, name, total: agg.total });
      }
      cover.getRow(1).font = { bold: true };
      cover.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };

      // 세부내역: 약품별
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
      const xlsxName = `${safeName(companyName)}_${yymm}.xlsx`;
      companyFolder.file(xlsxName, wbBuf);

      // ── 이미지: 이 (entity, companyName) 에 해당하는 모든 (clientName) 의 처방전 이미지를 사본 추가
      const clientNamesForCompany = [...new Set(rows.map((r) => r.hospitalName))];
      const imgFolder = companyFolder.folder(`${safeName(companyName)}_이미지`)!;
      for (const clientName of clientNamesForCompany) {
        const matchingReports = reports.filter((r) =>
          (r.client?.clientName ?? r.hospitalName) === clientName &&
          ((r.ocrData as { finalDrugs?: FinalDrug[] } | null)?.finalDrugs ?? []).some((d) =>
            ((d.companyName || "").trim() || "(미분류)") === companyName,
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
        }
      }
    }
  }

  // 미매핑 목록을 텍스트로 첨부
  if (unmapped.length > 0) {
    const txt = [
      `[제출처 미매핑 (제약사 × 거래처) 목록] ${year}년 ${month}월`,
      "통계제출처 관리에서 SubmissionRoute 등록 후 다시 다운로드하세요.",
      "",
      ...unmapped.map((u, i) => `${i + 1}. ${u.clientName} × ${u.companyName}`),
    ].join("\n");
    root.file("_미매핑.txt", txt);
  }

  const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const filename = `${rootFolderName}${entityFilter ? `_${safeName(entityFilter)}` : ""}.zip`;
  return new NextResponse(new Uint8Array(zipBuf), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "X-Entity-Count": String(grouped.size),
      "X-Unmapped-Count": String(unmapped.length),
    },
  });
}

// HEAD: dry-run 미리보기 — 패키지 생성 없이 entity/거래처/제약사 카운트만 반환
export async function HEAD(req: NextRequest) {
  return GET(req); // 단순화 — 클라이언트가 사이즈만 빠르게 보려면 별도 preview API 추가 가능
}
