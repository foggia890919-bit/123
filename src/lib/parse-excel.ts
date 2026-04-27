import * as XLSX from "xlsx";

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseFileBuffer(buf: ArrayBuffer): ParsedSheet {
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<Record<string, string | number>>(sheet, { defval: "" });
  if (json.length === 0) return { headers: [], rows: [] };
  const headers = Object.keys(json[0]);
  const rows = json.map((row) => {
    const out: Record<string, string> = {};
    for (const k of headers) out[k] = String(row[k] ?? "");
    return out;
  });
  return { headers, rows };
}

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

export function pick(row: Record<string, string>, candidates: string[]): string {
  const map = new Map<string, string>();
  for (const k of Object.keys(row)) map.set(norm(k), row[k]);
  for (const c of candidates) {
    const v = map.get(norm(c));
    if (v !== undefined && v !== "") return v;
  }
  return "";
}

export function toInt(v: string): number {
  if (!v) return 0;
  const n = Number(String(v).replace(/[,\s원]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
}
