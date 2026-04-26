import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, newStorageKey, extensionFromMime, parseDataUri, uploadDataUri, publicUrl, storageEnabled } from "@/lib/storage";

export async function POST(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  if (!storageEnabled()) {
    return NextResponse.json({ error: "스토리지 환경변수가 설정되지 않았습니다." }, { status: 503 });
  }

  const { dataUri } = await req.json();
  if (!dataUri) return NextResponse.json({ error: "dataUri 필수" }, { status: 400 });

  const parsed = parseDataUri(dataUri);
  if (!parsed) return NextResponse.json({ error: "잘못된 이미지 형식" }, { status: 400 });

  if (parsed.data.length > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "이미지 크기는 5MB 이하여야 합니다." }, { status: 400 });
  }

  const key = newStorageKey("banners", extensionFromMime(parsed.contentType));
  const result = await uploadDataUri(BUCKETS.bannerImage, key, dataUri);
  if (!result.ok) return NextResponse.json({ error: "업로드 실패", detail: result.error }, { status: 500 });

  return NextResponse.json({ key, url: publicUrl(BUCKETS.bannerImage, key) });
}
