import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { uploadBuffer, publicUrl, storageEnabled, BUCKETS } from "@/lib/storage";
import { randomUUID } from "crypto";

export const maxDuration = 60;

const MAX_FILES = 30;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

// GET — 내 업로드 목록
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (isNextResponse(session)) return session;

  const year = req.nextUrl.searchParams.get("year");
  const month = req.nextUrl.searchParams.get("month");

  const images = await prisma.statImage.findMany({
    where: {
      userId: session.id,
      ...(year ? { year: parseInt(year) } : {}),
      ...(month ? { month: parseInt(month) } : {}),
    },
    include: { client: { select: { clientName: true } } },
    orderBy: { createdAt: "desc" },
  });

  const batches = new Map<string, typeof images>();
  for (const img of images) {
    if (!batches.has(img.batchKey)) batches.set(img.batchKey, []);
    batches.get(img.batchKey)!.push(img);
  }

  const result = [...batches.entries()].map(([key, imgs]) => ({
    batchKey: key,
    year: imgs[0].year,
    month: imgs[0].month,
    clientName: imgs[0].client?.clientName ?? "미입력",
    fileCount: imgs.length,
    createdAt: imgs[0].createdAt,
    files: imgs.map((f) => ({
      id: f.id,
      storedName: f.storedName,
      viewUrl: f.driveViewUrl,
      downloadUrl: f.driveViewUrl,
    })),
  }));

  return NextResponse.json({ batches: result, storageEnabled: storageEnabled() });
}

// POST — 파일 업로드 (전체 병렬)
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (isNextResponse(session)) return session;

  if (!storageEnabled()) {
    return NextResponse.json({ error: "스토리지 미설정 (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" }, { status: 503 });
  }

  const form = await req.formData();
  const year = parseInt(form.get("year") as string);
  const month = parseInt(form.get("month") as string);
  const clientId = (form.get("clientId") as string) || null;
  const files = form.getAll("files") as File[];

  if (!year || !month) return NextResponse.json({ error: "year/month 필수" }, { status: 400 });
  if (!files.length) return NextResponse.json({ error: "파일 없음" }, { status: 400 });
  if (files.length > MAX_FILES) return NextResponse.json({ error: `최대 ${MAX_FILES}개` }, { status: 400 });

  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `파일 크기 초과: ${file.name} (최대 20MB)` }, { status: 400 });
    }
  }

  // 거래처명 조회
  let clientName = "병원";
  if (clientId) {
    const client = await prisma.userClient.findUnique({ where: { id: clientId }, select: { clientName: true } });
    if (client) clientName = client.clientName;
  }

  const prefix = `${year}년${month}월_${clientName}`;
  const batchKey = randomUUID();

  // 모든 파일 버퍼 병렬 로드
  const buffers = await Promise.all(files.map((f) => f.arrayBuffer().then(Buffer.from)));

  // 업로드 항목 준비
  const items = buffers.map((buffer, i) => {
    const ext = files[i].name.split(".").pop() ?? "jpg";
    const storedName = `${prefix}_${i + 1}.${ext}`;
    const storageKey = `stat-images/${session.id}/${year}/${month}/${batchKey}/${storedName}`;
    return {
      buffer,
      storedName,
      storageKey,
      mimeType: files[i].type || "image/jpeg",
    };
  });

  // Supabase Storage에 전체 병렬 업로드
  const uploadResults = await Promise.all(
    items.map((item) => uploadBuffer(BUCKETS.statImage, item.storageKey, item.buffer, item.mimeType)),
  );

  const failed = uploadResults.findIndex((r) => !r.ok);
  if (failed !== -1) {
    return NextResponse.json({ error: `업로드 실패: ${uploadResults[failed].error}` }, { status: 500 });
  }

  // DB 저장 (한 번에)
  await prisma.statImage.createMany({
    data: items.map((item, i) => ({
      userId: session.id,
      clientId,
      year,
      month,
      driveFileId: item.storageKey,
      driveViewUrl: publicUrl(BUCKETS.statImage, item.storageKey),
      fileName: files[i].name,
      storedName: item.storedName,
      mimeType: item.mimeType,
      batchKey,
    })),
  });

  return NextResponse.json({
    ok: true,
    batchKey,
    count: items.length,
    files: items.map((item) => ({
      storedName: item.storedName,
      viewUrl: publicUrl(BUCKETS.statImage, item.storageKey),
    })),
  });
}
