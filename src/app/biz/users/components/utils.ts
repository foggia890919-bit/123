// ─── Shared Utility Functions ────────────────────────────────────────────────

export function formatBiz(n: string) {
  const d = n.replace(/\D/g, "");
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
  return n;
}

export function formatBizNum(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

export async function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.readAsDataURL(file);
  });
}

// SalesRepsTab utilities
export const TEMPLATE_HEADER = "이름\t이메일\t휴대폰\t임시비밀번호\t사업자번호(콤마구분)";
export const TEMPLATE_EXAMPLE = "김딜러\tdealer1@kmd.com\t010-1111-1111\tabc12345\t2110948285,1234567890";

export function parsePastedData(text: string): { name: string; email: string; phone: string; password: string; bizNumbersText: string }[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("이름\t") && !l.startsWith("# "));
  return lines.map((line) => {
    const cols = line.includes("\t") ? line.split("\t") : line.split(/,(?![^"]*")/);
    const [name = "", email = "", phone = "", password = "", bizNumbersText = ""] = cols.map((c) => c.trim());
    return { name, email, phone, password, bizNumbersText };
  });
}

export function isValidEmail(s: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

export function parseBizNumbers(text: string): string[] {
  return Array.from(new Set(text.split(/[,\s/;]+/).map((s) => s.replace(/[^0-9]/g, "")).filter((b) => b.length >= 9 && b.length <= 12)));
}

// InhouseClientsTab utilities
export function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
