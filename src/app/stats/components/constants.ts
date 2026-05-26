import type { ManualDrug } from "./types";

// Re-export from types (linter moved these there)
export { VENDOR_LABEL_KO, CAPTURE_LABEL_KO, emptyManualDrug } from "./types";

export function confColor(c: number) {
  if (c >= 90) return "bg-green-100 text-green-700 border-green-300";
  if (c >= 75) return "bg-yellow-100 text-yellow-700 border-yellow-300";
  return "bg-red-100 text-red-700 border-red-300";
}

export const CURRENT_YEAR = new Date().getFullYear();
export const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
export const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export async function compressImage(file: File, maxDim = 1600, quality = 0.78): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("압축 실패"))), "image/jpeg", quality);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function rowCommission(d: ManualDrug): number {
  const qty = parseFloat(d.quantity) || 0;
  const price = d.unitPrice ?? 0;
  const ratePct = (d.commissionRate ?? 0) + (d.additionalRate ?? 0);
  return qty * price * ratePct / 100;
}
