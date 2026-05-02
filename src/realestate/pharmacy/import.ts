// 자체 거래 약국 + 월별 공급 매출 CSV 임포터.
//
// CSV 포맷 (utf-8, 헤더 필수):
//
//   pharmacies.csv:
//     externalId,name,bizNumber,address,joinedAt,active,notes
//     P001,역삼약국,1234567890,서울특별시 강남구 역삼동 825-22,2022-03-01,true,
//     P002,강남종합약국,2345678901,서울특별시 강남구 ...,2021-06-15,true,처방조제 위주
//
//   supply.csv:
//     externalId,yearMonth,totalAmount,scriptCount
//     P001,202412,4350,1820
//     P001,202501,4720,1910
//
// 사용:
//   npm run re:supply -- --pharmacies pharmacies.csv
//   npm run re:supply -- --supply supply.csv
//   npm run re:supply -- --geocode   # 주소 있는 약국에 V월드 geocoding 실행

import * as fs from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { geocodeJibun } from "../land/vworld";

export interface ImportSummary {
  fetched: number;
  upserted: number;
  geocoded: number;
  errors: { row: number; error: string }[];
}

/** 매우 기본적인 CSV 파서 — 따옴표·이스케이프 없는 깔끔한 CSV 가정. */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = splitLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) obj[headers[j]] = (cells[j] ?? "").trim();
    rows.push(obj);
  }
  return { headers, rows };
}

function splitLine(line: string): string[] {
  // 단순 split — 쉼표가 값에 들어가면 따옴표로 감싸야 한다.
  if (line.includes('"')) {
    const out: string[] = [];
    let cur = "";
    let inQuote = false;
    for (const ch of line) {
      if (ch === '"') inQuote = !inQuote;
      else if (ch === "," && !inQuote) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }
  return line.split(",");
}

export async function importPharmacies(csvPath: string, opts: { geocode?: boolean } = {}): Promise<ImportSummary> {
  const text = await fs.readFile(csvPath, "utf-8");
  const { rows } = parseCsv(text);
  const summary: ImportSummary = { fetched: rows.length, upserted: 0, geocoded: 0, errors: [] };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const externalId = r.externalId?.trim();
      if (!externalId) throw new Error("externalId 비어 있음");
      let lat: number | null = null;
      let lng: number | null = null;
      if (opts.geocode && r.address) {
        try {
          const g = await geocodeJibun(r.address);
          if (g) { lat = g.lat; lng = g.lng; summary.geocoded++; }
        } catch { /* skip */ }
      }
      await prisma.ownedPharmacy.upsert({
        where: { externalId },
        create: {
          externalId,
          name: r.name ?? "",
          bizNumber: r.bizNumber || null,
          address: r.address || null,
          joinedAt: r.joinedAt ? new Date(r.joinedAt) : null,
          active: r.active ? r.active.toLowerCase() !== "false" : true,
          notes: r.notes || null,
          latitude: lat,
          longitude: lng,
        },
        update: {
          name: r.name ?? undefined,
          bizNumber: r.bizNumber || undefined,
          address: r.address || undefined,
          notes: r.notes || undefined,
          active: r.active ? r.active.toLowerCase() !== "false" : undefined,
          latitude: lat ?? undefined,
          longitude: lng ?? undefined,
          fetchedAt: new Date(),
        },
      });
      summary.upserted++;
    } catch (e) {
      summary.errors.push({ row: i + 2, error: (e as Error).message });
    }
  }
  return summary;
}

export async function importSupply(csvPath: string): Promise<ImportSummary> {
  const text = await fs.readFile(csvPath, "utf-8");
  const { rows } = parseCsv(text);
  const summary: ImportSummary = { fetched: rows.length, upserted: 0, geocoded: 0, errors: [] };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const externalId = r.externalId?.trim();
      if (!externalId) throw new Error("externalId 비어 있음");
      const ym = r.yearMonth?.trim().replace(/[^\d]/g, "");
      if (!ym || ym.length < 6) throw new Error("yearMonth 형식 오류 (YYYYMM)");
      const totalAmount = Number(String(r.totalAmount).replace(/[^\d-]/g, ""));
      if (!Number.isFinite(totalAmount)) throw new Error("totalAmount 숫자 아님");
      const scriptCount = r.scriptCount ? Number(String(r.scriptCount).replace(/[^\d-]/g, "")) : null;

      const pharmacy = await prisma.ownedPharmacy.findUnique({ where: { externalId } });
      if (!pharmacy) throw new Error(`약국 미등록(externalId=${externalId}) — pharmacies.csv 먼저 import`);

      await prisma.pharmacySupply.upsert({
        where: { pharmacyId_yearMonth: { pharmacyId: pharmacy.id, yearMonth: ym.slice(0, 6) } },
        create: { pharmacyId: pharmacy.id, yearMonth: ym.slice(0, 6), totalAmount, scriptCount },
        update: { totalAmount, scriptCount: scriptCount ?? undefined },
      });
      summary.upserted++;
    } catch (e) {
      summary.errors.push({ row: i + 2, error: (e as Error).message });
    }
  }
  return summary;
}

/** 저장된 약국 중 좌표 없는 행을 일괄 geocoding. */
export async function geocodeAllPharmacies(): Promise<{ done: number; failed: number }> {
  const targets = await prisma.ownedPharmacy.findMany({
    where: { latitude: null, address: { not: null } },
  });
  let done = 0, failed = 0;
  for (const p of targets) {
    try {
      const g = await geocodeJibun(p.address!);
      if (g) {
        await prisma.ownedPharmacy.update({
          where: { id: p.id },
          data: { latitude: g.lat, longitude: g.lng },
        });
        done++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }
  return { done, failed };
}
