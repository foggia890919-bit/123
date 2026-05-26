import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { companyNameKey } from "@/lib/company-name";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPrice(price: number | null | undefined): string {
  if (price == null) return "-";
  return price.toLocaleString("ko-KR") + "원";
}

/**
 * 제약사명 매칭용 정규화 키.
 * company-name.ts 의 companyNameKey 를 canonical 로 사용.
 * "(주)셀트리온제약", "셀트리온제약(본사)", "셀트리온제약 (주)" → 동일 키.
 *
 * @deprecated companyNameKey (from "@/lib/company-name") 를 직접 import 권장.
 */
export const normalizeCompanyKey: (name: string) => string = companyNameKey;

/**
 * 약품명 매칭용 정규화 키.
 * 같은 약을 MFDS/HIRA/요율표가 다르게 표기하는 경우(예: "멜라킹서방정2mg (특이사항 필독)"
 * vs "멜라킹서방정2밀리그램(멜라토닌)") 를 흡수하기 위해:
 *  - 괄호 안 부가설명 제거
 *  - 단위어 통일 (밀리그램→mg, 마이크로그램→mcg, 밀리리터→ml)
 *  - 공백 + zero-width 제거
 *  - 소문자
 */
export function normalizeProductKey(name: string): string {
  if (!name) return "";
  return name
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, "")
    .replace(/밀리그[람램]/g, "mg")
    .replace(/마이크로그[람램]/g, "mcg")
    .replace(/밀리리터/g, "ml")
    .replace(/[​-‍﻿]/g, "")
    .toLowerCase();
}
