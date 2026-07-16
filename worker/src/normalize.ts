// 제품명·제약사명 정규화 유틸 (공용).
// 원래 master-sync.ts 안에 로컬로 있던 함수를 공용화 — export-ykorder.ts 의
// 비급여 이름 매칭에서도 동일 규칙을 써야 KMD Medication ↔ ykpharm-order products
// 사이 매칭이 일관된다.
// src/lib/utils.ts · company-name.ts 에서 복사 (Node24 ESM/CJS 경계 때문에 직접 import 불가).

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

export function normalizeCompanyKey(name: string): string {
  if (!name) return "";
  return name
    .replace(/^\(주\)\s*|\s*\(주\)$/g, "")
    .replace(/^㈜\s*|\s*㈜$/g, "")
    .replace(/^주식회사\s+|\s+주식회사$/g, "")
    .replace(/^\(유\)\s*|\s*\(유\)$/g, "")
    .replace(/^유한회사\s+|\s+유한회사$/g, "")
    .replace(/^\(재\)\s*/g, "")
    .replace(/^\(사\)\s*/g, "")
    .replace(/^\(합\)\s*/g, "")
    .replace(/\s*\(본사\)$/g, "")
    .replace(/\s*\(지사\)$/g, "")
    .replace(/\s*\(지점\)$/g, "")
    .replace(/\s*\(파트너스\)$/g, "")
    .replace(/\s*\(파트너즈\)$/g, "")
    .replace(/\s*\(파너스\)$/g, "")
    .replace(/\s*\(영업소\)$/g, "")
    .replace(/\s*\(영업부\)$/g, "")
    .replace(/\s*\(영업\)$/g, "")
    .replace(/\s*Co\.\s*,?\s*Ltd\.?$/gi, "")
    .replace(/\s*Corp\.?$/gi, "")
    .replace(/\s*Corporation$/gi, "")
    .replace(/\s*Inc\.?$/gi, "")
    .trim()
    .replace(/[\s.,()/\-_·]/g, "")
    .toLowerCase();
}
