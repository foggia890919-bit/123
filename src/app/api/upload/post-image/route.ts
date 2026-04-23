import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { BUCKETS, newStorageKey, extensionFromMime, parseDataUri, uploadDataUri, publicUrl, storageEnabled } from "@/lib/storage";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const u = session?.user as { id?: string } | undefined;
  if (!u?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  if (!storageEnabled()) {
    return NextResponse.json({ error: "스토리지 환경변수가 설정되지 않았습니다." }, { status: 503 });
  }

  const { dataUri } = await req.json();
  if (!dataUri) return NextResponse.json({ error: "dataUri 필수" }, { status: 400 });

  const parsed = parseDataUri(dataUri);
  if (!parsed) return NextResponse.json({ error: "잘못된 이미지 형식" }, { status: 400 });

  // 10MB limit
  if (parsed.data.length > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "이미지 크기는 10MB 이하여야 합니다." }, { status: 400 });
  }

  const key = newStorageKey(`posts/${u.id}`, extensionFromMime(parsed.contentType));
  const result = await uploadDataUri(BUCKETS.postImage, key, dataUri);
  if (!result.ok) return NextResponse.json({ error: "업로드 실패", detail: result.error }, { status: 500 });

  return NextResponse.json({ key, url: publicUrl(BUCKETS.postImage, key) });
}
