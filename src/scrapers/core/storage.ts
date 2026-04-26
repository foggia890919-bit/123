import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import type { ScrapeResult, WholesaleAdapter } from "./types";

interface OutputRow {
  scrapedAt: string;
  siteKey: string;
  insuranceCode: string;
  productName: string;
  spec: string;
  manufacturer: string;
  unitPrice: number | "";
  stock: number | "";
  note: string;
}

function toRows(results: ScrapeResult[]): OutputRow[] {
  const now = new Date().toISOString();
  const rows: OutputRow[] = [];
  for (const r of results) {
    if (r.items.length === 0) {
      rows.push({
        scrapedAt: now,
        siteKey: r.siteKey,
        insuranceCode: r.insuranceCode,
        productName: "",
        spec: "",
        manufacturer: "",
        unitPrice: "",
        stock: "",
        note: r.error ?? "no results",
      });
      continue;
    }
    for (const item of r.items) {
      rows.push({
        scrapedAt: now,
        siteKey: r.siteKey,
        insuranceCode: item.insuranceCode || r.insuranceCode,
        productName: item.productName,
        spec: item.spec ?? "",
        manufacturer: item.manufacturer ?? "",
        unitPrice: item.unitPrice ?? "",
        stock: item.stock ?? "",
        note: "",
      });
    }
  }
  return rows;
}

// ---------- File outputs (always on, no DB needed) ------------------------
// XLSX is the primary user-facing output: insurance codes stay as text
// (no scientific-notation mangling), columns are auto-sized, Korean text
// renders correctly in Excel without any encoding workarounds.
// CSV is also written for downstream tools / scripts.

function timestampPath(ext: string) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  return resolve(process.cwd(), "output", `inventory-${ts}.${ext}`);
}

export async function saveResultsToXlsx(results: ScrapeResult[]): Promise<string> {
  await mkdir(resolve(process.cwd(), "output"), { recursive: true });
  const path = timestampPath("xlsx");
  const rows = toRows(results);

  const ws = XLSX.utils.json_to_sheet(rows, {
    header: [
      "scrapedAt",
      "siteKey",
      "insuranceCode",
      "productName",
      "spec",
      "manufacturer",
      "unitPrice",
      "stock",
      "note",
    ],
  });

  // Force insuranceCode column to be text so 643703630 doesn't become 6.44E+08
  if (ws["!ref"]) {
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const insuranceCol = 2; // 0-based: scrapedAt, siteKey, insuranceCode
    for (let R = range.s.r + 1; R <= range.e.r; R++) {
      const ref = XLSX.utils.encode_cell({ r: R, c: insuranceCol });
      const cell = ws[ref];
      if (cell && cell.v != null) {
        cell.t = "s";
        cell.v = String(cell.v);
        cell.z = "@"; // text format
      }
    }
  }

  ws["!cols"] = [
    { wch: 22 }, // scrapedAt
    { wch: 8 },  // siteKey
    { wch: 14 }, // insuranceCode
    { wch: 32 }, // productName
    { wch: 8 },  // spec
    { wch: 16 }, // manufacturer
    { wch: 12 }, // unitPrice
    { wch: 8 },  // stock
    { wch: 20 }, // note
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Inventory");
  XLSX.writeFile(wb, path);
  return path;
}

export async function saveResultsToCsv(results: ScrapeResult[]): Promise<string> {
  await mkdir(resolve(process.cwd(), "output"), { recursive: true });
  const path = timestampPath("csv");
  const rows = toRows(results);
  const headers = Object.keys(rows[0] ?? { scrapedAt: "" }) as (keyof OutputRow)[];

  const escape = (v: unknown) => {
    if (v === null || v === undefined || v === "") return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map(h => escape(row[h])).join(","));
  }
  // BOM for Excel UTF-8 compatibility
  await writeFile(path, "﻿" + lines.join("\r\n"), "utf8");
  return path;
}

// ---------- DB (only when DATABASE_URL is set) ----------------------------
// All DB calls go through the lazy loader so the scraper can run with no
// Supabase configured at all — the import doesn't even execute until needed.

async function getPrisma() {
  const mod = await import("../../lib/prisma");
  return mod.prisma;
}

export async function ensureSite(a: WholesaleAdapter) {
  const prisma = await getPrisma();
  await prisma.wholesaleSite.upsert({
    where: { key: a.key },
    update: { name: a.name, baseUrl: a.baseUrl, loginUrl: a.loginUrl },
    create: { key: a.key, name: a.name, baseUrl: a.baseUrl, loginUrl: a.loginUrl },
  });
}

export async function saveResults(results: ScrapeResult[]): Promise<number> {
  const rows = results
    .filter(r => !r.error)
    .flatMap(r =>
      r.items.map(item => ({
        siteKey: r.siteKey,
        insuranceCode: item.insuranceCode || r.insuranceCode,
        productName: item.productName,
        spec: item.spec,
        manufacturer: item.manufacturer,
        unitPrice: item.unitPrice,
        stock: item.stock,
        raw: item.raw as Record<string, unknown> | undefined,
      }))
    );
  if (rows.length === 0) return 0;
  const prisma = await getPrisma();
  await prisma.inventorySnapshot.createMany({ data: rows });
  return rows.length;
}

export async function startJob(siteKey: string, mode: string, totalCodes: number): Promise<string> {
  const prisma = await getPrisma();
  const job = await prisma.scrapeJob.create({
    data: { siteKey, mode, totalCodes },
  });
  return job.id;
}

export async function finishJob(id: string, stats: { done: number; failed: number; error?: string }) {
  const prisma = await getPrisma();
  await prisma.scrapeJob.update({
    where: { id },
    data: {
      doneCodes: stats.done,
      failedCodes: stats.failed,
      finishedAt: new Date(),
      error: stats.error,
    },
  });
}
