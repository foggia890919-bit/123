import { prisma } from "../../lib/prisma";
import type { ScrapeResult, WholesaleAdapter } from "./types";

export async function ensureSite(a: WholesaleAdapter) {
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
  await prisma.inventorySnapshot.createMany({ data: rows });
  return rows.length;
}

export async function startJob(siteKey: string, mode: string, totalCodes: number): Promise<string> {
  const job = await prisma.scrapeJob.create({
    data: { siteKey, mode, totalCodes },
  });
  return job.id;
}

export async function finishJob(id: string, stats: { done: number; failed: number; error?: string }) {
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
