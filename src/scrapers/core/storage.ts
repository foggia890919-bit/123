import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ScrapeResult, WholesaleAdapter } from "./types";

// ---------- CSV (always on, no DB needed) ---------------------------------

export async function saveResultsToCsv(results: ScrapeResult[]): Promise<string> {
  const dir = resolve(process.cwd(), "output");
  await mkdir(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const path = resolve(dir, `inventory-${ts}.csv`);

  const headers = [
    "scrapedAt",
    "siteKey",
    "insuranceCode",
    "productName",
    "spec",
    "manufacturer",
    "unitPrice",
    "stock",
    "note",
  ];
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const now = new Date().toISOString();
  const lines: string[] = [headers.join(",")];

  for (const r of results) {
    if (r.items.length === 0) {
      lines.push(
        [now, r.siteKey, r.insuranceCode, "", "", "", "", "", r.error ?? "no results"]
          .map(escape)
          .join(",")
      );
      continue;
    }
    for (const item of r.items) {
      lines.push(
        [
          now,
          r.siteKey,
          item.insuranceCode || r.insuranceCode,
          item.productName,
          item.spec ?? "",
          item.manufacturer ?? "",
          item.unitPrice ?? "",
          item.stock ?? "",
          "",
        ]
          .map(escape)
          .join(",")
      );
    }
  }

  // BOM for Excel UTF-8 compatibility (so Korean displays correctly)
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
