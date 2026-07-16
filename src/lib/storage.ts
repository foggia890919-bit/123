import { randomUUID, createHash } from "node:crypto";

// Supabase Storage helper. Works in two modes:
//   - Enabled: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set -> upload to Storage, return key
//   - Disabled: fall back to storing base64 directly in DB (legacy behavior)
//
// This lets new deploys use Storage while legacy rows still serve from the DB.

export const BUCKETS = {
  userDocument: "user-documents",
  userClientBiz: "client-documents",
  filterRequestBiz: "filter-request-docs",
  prescriptionImage: "prescription-images",
  bannerImage: "banners",
  postImage: "post-images",
  settlementTemplate: "settlement-templates",
  settlementDocument: "settlement-documents",
  bizRateFile: "biz-rate-files",
  incomingEmail: "incoming-emails",
  statImage: "stat-images",
} as const;

export function publicUrl(bucket: BucketName, key: string): string {
  if (!process.env.SUPABASE_URL) return "";
  let base: string;
  try { base = new URL(process.env.SUPABASE_URL).origin; }
  catch { base = process.env.SUPABASE_URL.replace(/\/+$/, ""); }
  return `${base}/storage/v1/object/public/${bucket}/${encodeURI(key)}`;
}

export type BucketName = (typeof BUCKETS)[keyof typeof BUCKETS];

export function storageEnabled(): boolean {
  return !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function baseUrl(): string {
  const raw = process.env.SUPABASE_URL!;
  try {
    return new URL(raw).origin; // strip any /rest/v1 or other path suffixes
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

function serviceKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY!;
}

export interface ParsedDataUri {
  contentType: string;
  data: Buffer;
}

export function parseDataUri(input: string | null | undefined): ParsedDataUri | null {
  if (!input) return null;
  const match = input.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) return null;
  return { contentType: match[1], data: Buffer.from(match[2], "base64") };
}

export function extensionFromMime(mime: string): string {
  const m = mime.toLowerCase();
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/tiff": "tiff",
    "application/pdf": "pdf",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  };
  return map[m] ?? "bin";
}

export function newStorageKey(prefix: string, extension: string): string {
  return `${prefix}/${randomUUID()}.${extension}`;
}

// 저장 키 세그먼트 sanitize — 슬래시·역슬래시·제어문자 제거, 연속 공백 1칸으로,
// 100자 절단. 한글은 그대로 유지 (Supabase 는 UTF-8 키 허용).
export function sanitizePathSegment(seg: string): string {
  return (seg || "")
    .replace(/[/\\]/g, " ") // 슬래시류 → 공백 (경로 계층 오염 방지)
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "") // 제어문자 제거
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

// 한글 키를 거부하는 스토리지용 ASCII 폴백 세그먼트.
// ASCII 안전 문자만 남기고, 남는 게 거의 없으면 짧은 해시로 대체 (결정적).
function asciiFallbackSegment(seg: string): string {
  const ascii = (seg || "").replace(/[^A-Za-z0-9._-]/g, "");
  if (ascii.length >= 2) return ascii.slice(0, 80);
  return "seg" + createHash("sha1").update(seg || "").digest("hex").slice(0, 10);
}

export async function uploadDataUri(
  bucket: BucketName,
  key: string,
  dataUri: string
): Promise<{ ok: boolean; error?: string }> {
  const parsed = parseDataUri(dataUri);
  if (!parsed) return { ok: false, error: "INVALID_DATA_URI" };
  if (!storageEnabled()) return { ok: false, error: "STORAGE_DISABLED" };

  const url = `${baseUrl()}/storage/v1/object/${bucket}/${encodeURI(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey()}`,
      "Content-Type": parsed.contentType,
      "x-upsert": "true",
    },
    body: new Uint8Array(parsed.data),
  });
  if (!res.ok) {
    return { ok: false, error: `${res.status} ${await res.text().catch(() => "")}` };
  }
  return { ok: true };
}

export async function downloadAsDataUri(bucket: BucketName, key: string): Promise<string | null> {
  if (!storageEnabled()) return null;
  const url = `${baseUrl()}/storage/v1/object/${bucket}/${encodeURI(key)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${serviceKey()}` },
  });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") ?? "application/octet-stream";
  return `data:${ct};base64,${buf.toString("base64")}`;
}

export async function uploadBuffer(
  bucket: BucketName,
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!storageEnabled()) return { ok: false, error: "STORAGE_DISABLED" };
  const url = `${baseUrl()}/storage/v1/object/${bucket}/${encodeURI(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey()}`,
      apikey: serviceKey(),
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: new Uint8Array(buffer),
  });
  if (!res.ok) {
    return { ok: false, error: `${res.status} ${await res.text().catch(() => "")}` };
  }
  return { ok: true };
}

export async function deleteObject(bucket: BucketName, key: string): Promise<boolean> {
  if (!storageEnabled()) return false;
  const url = `${baseUrl()}/storage/v1/object/${bucket}/${encodeURI(key)}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${serviceKey()}` },
  });
  return res.ok;
}

// Upload a data URI; if Storage is enabled and succeeds, returns {fileKey, fileData: null}.
// If Storage is disabled or upload fails, returns {fileKey: null, fileData: original} so the
// caller can persist it in the legacy base64 column.
// pathSegments (선택) — 주면 키를 `{pathPrefix}/{seg1}/{seg2}/…/{uuid}.ext` 로 계층화.
// 예: 처방통계 사진을 `{userId}/{제출처}/{제약사}_{거래처명}/{uuid}.jpg` 로.
// 세그먼트는 sanitizePathSegment 로 정리(한글 유지). Supabase 가 한글 키를 거부할 수 있어
// 업로드 실패 시 1) ASCII 폴백 키 재시도 → 2) 기존 평면 키 재시도 → 3) DB 폴백 순으로 강등.
// 업로드 자체가 죽어 데이터가 유실되는 일은 없게 한다. 세그먼트가 없으면 기존 평면 키 그대로.
export async function persistDataUri(
  bucket: BucketName,
  pathPrefix: string,
  dataUri: string | null | undefined,
  pathSegments?: string[]
): Promise<{ fileKey: string | null; fileData: string | null }> {
  if (!dataUri) return { fileKey: null, fileData: null };
  if (!storageEnabled()) return { fileKey: null, fileData: dataUri };

  const parsed = parseDataUri(dataUri);
  if (!parsed) return { fileKey: null, fileData: null };

  const ext = extensionFromMime(parsed.contentType);
  const uuid = randomUUID();
  const segs = (pathSegments ?? []).map(sanitizePathSegment).filter(Boolean);

  // 세그먼트 없음 → 기존 평면 키 (하위호환)
  if (segs.length === 0) {
    const key = newStorageKey(pathPrefix, ext);
    const r = await uploadDataUri(bucket, key, dataUri);
    return r.ok ? { fileKey: key, fileData: null } : { fileKey: null, fileData: dataUri };
  }

  // 1) 한글 포함 계층 키
  const layeredKey = `${pathPrefix}/${segs.join("/")}/${uuid}.${ext}`;
  const r1 = await uploadDataUri(bucket, layeredKey, dataUri);
  if (r1.ok) return { fileKey: layeredKey, fileData: null };

  // 2) ASCII 폴백 계층 키 (스토리지가 한글 키 거부 시)
  const asciiSegs = segs.map(asciiFallbackSegment).filter(Boolean);
  if (asciiSegs.length > 0) {
    const asciiKey = `${pathPrefix}/${asciiSegs.join("/")}/${uuid}.${ext}`;
    const r2 = await uploadDataUri(bucket, asciiKey, dataUri);
    if (r2.ok) return { fileKey: asciiKey, fileData: null };
  }

  // 3) 기존 평면 키 최종 시도
  const flatKey = newStorageKey(pathPrefix, ext);
  const r3 = await uploadDataUri(bucket, flatKey, dataUri);
  if (r3.ok) return { fileKey: flatKey, fileData: null };

  // 4) DB 폴백 — 데이터 유실 방지
  return { fileKey: null, fileData: dataUri };
}

// Read a file — prefer Storage key, fall back to legacy base64
export async function readFileAsDataUri(
  bucket: BucketName,
  row: { fileKey?: string | null; fileData?: string | null }
): Promise<string | null> {
  if (row.fileKey) {
    const uri = await downloadAsDataUri(bucket, row.fileKey);
    if (uri) return uri;
  }
  return row.fileData ?? null;
}
