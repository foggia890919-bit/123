import { randomUUID } from "node:crypto";

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
} as const;

export function publicUrl(bucket: BucketName, key: string): string {
  if (!process.env.SUPABASE_URL) return "";
  return `${process.env.SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/${encodeURI(key)}`;
}

export type BucketName = (typeof BUCKETS)[keyof typeof BUCKETS];

export function storageEnabled(): boolean {
  return !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function baseUrl(): string {
  return process.env.SUPABASE_URL!.replace(/\/+$/, "");
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
  };
  return map[m] ?? "bin";
}

export function newStorageKey(prefix: string, extension: string): string {
  return `${prefix}/${randomUUID()}.${extension}`;
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
export async function persistDataUri(
  bucket: BucketName,
  pathPrefix: string,
  dataUri: string | null | undefined
): Promise<{ fileKey: string | null; fileData: string | null }> {
  if (!dataUri) return { fileKey: null, fileData: null };
  if (!storageEnabled()) return { fileKey: null, fileData: dataUri };

  const parsed = parseDataUri(dataUri);
  if (!parsed) return { fileKey: null, fileData: null };

  const key = newStorageKey(pathPrefix, extensionFromMime(parsed.contentType));
  const result = await uploadDataUri(bucket, key, dataUri);
  if (!result.ok) {
    // Storage write failed; fall back to DB so data is not lost
    return { fileKey: null, fileData: dataUri };
  }
  return { fileKey: key, fileData: null };
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
