import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// PoC sample. Extend via src/scrapers/codes/sample.txt or use DB/CSV loaders below.
export const POC_CODES: string[] = [
  "643703630", // 플라그렐정 (백제약품 order UI sample)
];

// Lazy import so PoC mode (file-based) doesn't require DATABASE_URL or
// a generated Prisma client.
async function getPrisma() {
  const mod = await import("../../lib/prisma");
  return mod.prisma;
}

export async function loadPocCodes(): Promise<string[]> {
  const path = resolve(process.cwd(), "src/scrapers/codes/sample.txt");
  try {
    const txt = await readFile(path, "utf8");
    const fromFile = txt
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(s => s && !s.startsWith("#"));
    if (fromFile.length > 0) return fromFile;
  } catch {
    // file optional
  }
  return POC_CODES;
}

export async function loadCodesFromDB(): Promise<string[]> {
  const prisma = await getPrisma();
  const rows = await prisma.medication.findMany({
    where: { insuranceCode: { not: null } },
    select: { insuranceCode: true },
    distinct: ["insuranceCode"],
  });
  return rows.map(r => r.insuranceCode!).filter(Boolean);
}

export async function loadFrequentCodes(limit = 5000): Promise<string[]> {
  // Placeholder ordering - replace with real frequency signal once available
  // (e.g. ProposalItem counts, HIRA frequency CSV, pharmacy dispense logs).
  const prisma = await getPrisma();
  const rows = await prisma.medication.findMany({
    where: { insuranceCode: { not: null } },
    select: { insuranceCode: true },
    distinct: ["insuranceCode"],
    take: limit,
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(r => r.insuranceCode!).filter(Boolean);
}
