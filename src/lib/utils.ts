import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPrice(price: number | null | undefined): string {
  if (price == null) return "-";
  return price.toLocaleString("ko-KR") + "원";
}

/**
 * 제약사명 매칭용 정규화 키.
 * "국제약품(주)" === "국제약품" === " 국제약품 주식회사 " 가 되도록 접미사/공백을 제거.
 */
export function normalizeCompanyKey(name: string): string {
  if (!name) return "";
  return name
    .replace(/\([^)]*\)/g, "")
    .replace(/주식회사|유한회사|합자회사|합명회사/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}
