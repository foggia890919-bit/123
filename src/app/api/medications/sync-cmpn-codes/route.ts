import { NextRequest, NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";

export const maxDuration = 300;

// HIRA "주성분명코드 목록" API
// 급여/비급여 무관 전체 주성분코드 사전 — ingredientName 기반으로 코드 매핑 가능
// (기존 ATC sync는 보험코드 매칭 기반 → 비급여 약품 누락. 이 라우트가 보완)
const API_KEY = process.env.PUBLIC_DATA_API_KEY!;
const BASE_URL = "https://apis.data.go.kr/B551182/msupCmpnMeftInfoService/getMajorCmpnNmCdList";

interface CmpnItem { [key: string]: string | undefined }

const xmlParser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });

async function fetchPage(pageNo: number, perPage = 1000): Promise<{ items: CmpnItem[]; totalCount: number }> {
  const url = new URL(BASE_URL);
  url.searchParams.set("serviceKey", API_KEY);
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("numOfRows", String(perPage));
  // type=json 파라미터 제거 — HIRA B551182 서비스는 XML만 반환함

  const res = await fetch(url.toString(), { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HIRA cmpn API ${res.status}: ${text.slice(0, 300)}`);
  }

  // XML 파싱
  const parsed = xmlParser.parse(text);
  const body = parsed?.response?.body ?? parsed?.OpenAPI_ServiceResponse?.cmmMsgHeader ?? parsed;

  // 오류 코드 체크 (HIRA XML 오류 응답)
  const resultCode = parsed?.response?.header?.resultCode ?? parsed?.OpenAPI_ServiceResponse?.cmmMsgHeader?.returnReasonCode;
  if (resultCode && String(resultCode) !== "00" && String(resultCode) !== "0000") {
    const resultMsg = parsed?.response?.header?.resultMsg ?? parsed?.OpenAPI_ServiceResponse?.cmmMsgHeader?.returnAuthMsg ?? "API 오류";
    throw new Error(`HIRA API 오류 (${resultCode}): ${resultMsg}`);
  }

  const rawItems = body?.items?.item ?? body?.item ?? [];
  const items: CmpnItem[] = Array.isArray(rawItems) ? rawItems : (rawItems ? [rawItems] : []);
  // 각 필드를 문자열로 정규화
  const normalizedItems: CmpnItem[] = items.map((it) =>
    Object.fromEntries(Object.entries(it).map(([k, v]) => [k, v != null ? String(v) : undefined]))
  );
  const totalCount = parseInt(String(body?.totalCount ?? body?.numOfRows ?? "0"));
  return { items: normalizedItems, totalCount };
}

async function fetchPageWithRetry(pageNo: number, retries = 3): Promise<{ items: CmpnItem[]; totalCount: number }> {
  let lastError: unknown = null;
  for (let i = 0; i < retries; i++) {
    try { return await fetchPage(pageNo); }
    catch (e) {
      lastError = e;
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 800 * Math.pow(2, i)));
    }
  }
  throw new Error(`cmpn 페이지 ${pageNo} 실패: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

// 필드명 패턴 매칭 (정확한 키명 몰라도 의미로 찾음)
function findValue(item: CmpnItem, patterns: RegExp[]): string {
  for (const key of Object.keys(item)) {
    for (const pat of patterns) {
      if (pat.test(key)) {
        const val = item[key];
        if (val != null) {
          const s = String(val).trim();
          if (s) return s;
        }
      }
    }
  }
  return "";
}

interface CmpnExtract {
  code: string;        // 주성분코드
  name: string;        // 주성분명 (한글)
  engName?: string;    // 영문 주성분명
}

function extractCmpn(item: CmpnItem): CmpnExtract | null {
  // 주성분코드: "주성분코드", "성분코드", "MAIN_INGR_CD", "cmpnCd" 등
  const code = findValue(item, [
    /주성분.*코드|^성분.*코드$/,
    /MAIN_?INGR_?CD|cmpn_?cd|mainIngrCd|ingrCd/i,
  ]);
  // 주성분명 (한글) — "코드" 포함 키는 제외해야 함
  const name = findValue(item, [
    /^주성분명$|^성분명$|^명칭$/,
    /MAIN_?INGR_?NM|cmpn_?nm|mainIngrNm|ingrNm/i,
  ]);
  if (!code || !name) return null;
  // 영문 (있으면 추가 매칭에 활용)
  const engName = findValue(item, [
    /영문.*주성분|영문.*성분|english.*ingr/i,
    /ENG_?INGR_?NM|engCmpnNm|engIngrNm/i,
  ]);
  return { code, name, engName: engName || undefined };
}

// 정규화: 공백/특수문자 제거 + 소문자 (매칭용)
function normalizeName(name: string): string {
  return name
    .replace(/\s+/g, "")
    .replace(/[/,()·.\-_·]/g, "")
    .toLowerCase()
    .trim();
}

function isTransientDbError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /max clients|EMAXCONN|connection|ECONNREFUSED|ETIMEDOUT|pool/i.test(msg);
}

async function withDbRetry<T>(fn: () => Promise<T>, retries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (!isTransientDbError(e) || i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 600 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

// PROBE: GET /api/medications/sync-cmpn-codes
// API 응답 구조와 첫 페이지 샘플 반환 (구조 확인용)
export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  const onlyStats = req.nextUrl.searchParams.get("stats") === "true";
  if (onlyStats) {
    const [withCode, total, settingRows] = await Promise.all([
      prisma.medication.count({ where: { ingredientCode: { not: null } } }),
      prisma.medication.count(),
      prisma.$queryRaw<{ value: string }[]>`
        SELECT "value" FROM "SystemSetting" WHERE "key" = 'lastCmpnSync'
      `.catch(() => [] as { value: string }[]),
    ]);
    return NextResponse.json({ withCode, total, lastSync: settingRows[0]?.value ?? null });
  }

  try {
    // probe는 raw text도 함께 반환해서 XML 구조 확인 가능하게
    const url = new URL(BASE_URL);
    url.searchParams.set("serviceKey", API_KEY);
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("numOfRows", "5");
    const rawRes = await fetch(url.toString(), { cache: "no-store" });
    const rawText = await rawRes.text();
    const parsed = xmlParser.parse(rawText);

    const { items, totalCount } = await fetchPage(1, 5);
    const sampleKeys = items[0] ? Object.keys(items[0]) : [];
    const sampleExtracts = items.map(extractCmpn);
    return NextResponse.json({
      success: true,
      probe: true,
      totalCount,
      sampleKeys,
      sampleItems: items,
      sampleExtracts,
      rawXml: rawText.slice(0, 2000),
      parsedStructure: JSON.stringify(parsed).slice(0, 2000),
      note: totalCount > 0
        ? `사용 가능 (전체 ${totalCount}건). POST로 전체 동기화 실행.`
        : "데이터 없음 - API 키 또는 응답 구조 확인 필요",
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

// SYNC: POST /api/medications/sync-cmpn-codes
// DB 내 (ingredientName → ingredientCode) 맵을 이용해 코드 없는 약품에 코드 채움
// 외부 API 불필요 — 이미 ATC sync로 채워진 19K건을 사전으로 활용
export async function POST() {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  try {
    // 1) 이미 ingredientCode가 있는 약품에서 (정규화 성분명 → 코드) 사전 구축
    const seeded = await withDbRetry(() => prisma.medication.findMany({
      where: { ingredientCode: { not: null }, ingredientName: { not: "" } },
      select: { ingredientName: true, ingredientCode: true },
    }));

    const nameToCodes = new Map<string, Set<string>>();
    for (const med of seeded) {
      const norm = normalizeName(med.ingredientName ?? "");
      if (!norm || !med.ingredientCode) continue;
      if (!nameToCodes.has(norm)) nameToCodes.set(norm, new Set());
      nameToCodes.get(norm)!.add(med.ingredientCode);
    }

    if (nameToCodes.size === 0) {
      return NextResponse.json({
        error: "DB에 ingredientCode가 있는 약품이 없어요. 먼저 ③ ATC 동기화를 실행하세요.",
      }, { status: 400 });
    }

    // 2) ingredientCode가 null인 약품 + ingredientName 있는 약품 후보 조회
    const candidates = await withDbRetry(() => prisma.medication.findMany({
      where: { ingredientCode: null, ingredientName: { not: "" } },
      select: { id: true, ingredientName: true },
    }));

    // 3) 매칭 + bulk update (UNNEST로 한 번에 처리)
    let exactMatched = 0;
    let containsMatched = 0;
    let multiCandidate = 0;
    const updates: { id: string; code: string }[] = [];

    const sortedKeys = Array.from(nameToCodes.keys()).sort((a, b) => b.length - a.length);

    for (const med of candidates) {
      const norm = normalizeName(med.ingredientName ?? "");
      if (!norm) continue;

      let codes: Set<string> | undefined;
      if (nameToCodes.has(norm)) {
        codes = nameToCodes.get(norm);
        exactMatched++;
      } else {
        for (const key of sortedKeys) {
          if (norm.includes(key) || key.includes(norm)) {
            codes = nameToCodes.get(key);
            containsMatched++;
            break;
          }
        }
      }
      if (!codes || codes.size === 0) continue;
      const codeArr = Array.from(codes);
      if (codeArr.length > 1) { multiCandidate++; continue; } // 복수 후보 = 용량 구분 불가 → 스킵
      updates.push({ id: med.id, code: codeArr[0] });
    }

    // bulk UPDATE via UNNEST
    let updated = 0;
    if (updates.length > 0) {
      const BATCH = 500;
      for (let i = 0; i < updates.length; i += BATCH) {
        const batch = updates.slice(i, i + BATCH);
        const ids = batch.map((u) => u.id);
        const codes = batch.map((u) => u.code);
        await withDbRetry(() => prisma.$executeRaw`
          UPDATE "Medication" m
          SET "ingredientCode" = v.code, "updatedAt" = NOW()
          FROM (
            SELECT UNNEST(${ids}::text[]) AS id, UNNEST(${codes}::text[]) AS code
          ) v
          WHERE m.id = v.id
        `);
        updated += batch.length;
      }
    }

    const now = new Date().toISOString();
    await withDbRetry(() => prisma.$executeRaw`
      INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
      VALUES ('lastCmpnSync', ${now}, NOW())
      ON CONFLICT ("key") DO UPDATE SET "value" = ${now}, "updatedAt" = NOW()
    `).catch(() => null);

    const [withCode, totalDb] = await Promise.all([
      withDbRetry(() => prisma.medication.count({ where: { ingredientCode: { not: null } } })),
      withDbRetry(() => prisma.medication.count()),
    ]);

    return NextResponse.json({
      success: true,
      seededNames: nameToCodes.size,
      candidates: candidates.length,
      exactMatched,
      containsMatched,
      multiCandidate,
      updated,
      lastSync: now,
      finalState: { withCode, totalDb, coverage: ((withCode / totalDb) * 100).toFixed(1) + "%" },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
