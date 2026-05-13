import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { uploadFileToDrive, driveEnabled } from "@/lib/google-drive";
import { randomUUID } from "crypto";

const MAX_FILES = 30;
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB per file

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

  // 배치 단위로 그룹화
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
      driveFileId: f.driveFileId,
      driveViewUrl: f.driveViewUrl,
      downloadUrl: `https://drive.google.com/uc?export=download&id=${f.driveFileId}`,
    })),
  }));

  return NextResponse.json({ batches: result, driveEnabled: driveEnabled() });
}

// POST — 파일 업로드
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (isNextResponse(session)) return session;

  const form = await req.formData();
  const year = parseInt(form.get("year") as string);
  const month = parseInt(form.get("month") as string);
  const clientId = (form.get("clientId") as string) || null;
  const files = form.getAll("files") as File[];

  if (!year || !month) return NextResponse.json({ error: "year/month 필수" }, { status: 400 });
  if (!files.length) return NextResponse.json({ error: "파일 없음" }, { status: 400 });
  if (files.length > MAX_FILES) return NextResponse.json({ error: `최대 ${MAX_FILES}개` }, { status: 400 });

  // 거래처명 조회 (파일명 생성용)
  let clientName = "병원";
  if (clientId) {
    const client = await prisma.userClient.findUnique({ where: { id: clientId }, select: { clientName: true } });
    if (client) clientName = client.clientName;
  }

  const prefix = `${year}년${month}월_${clientName}`;
  const batchKey = randomUUID();
  const created: { storedName: string; driveFileId: string; driveViewUrl: string | null }[] = [];

  if (!driveEnabled()) {
    return NextResponse.json({ error: "Google Drive 미설정 (GOOGLE_DRIVE_CLIENT_EMAIL, GOOGLE_DRIVE_PRIVATE_KEY, GOOGLE_DRIVE_FOLDER_ID 환경변수 필요)" }, { status: 503 });
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `파일 크기 초과: ${file.name} (최대 20MB)` }, { status: 400 });
    }
    const ext = file.name.split(".").pop() ?? "jpg";
    const storedName = `${prefix}_${i + 1}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const { fileId, viewUrl } = await uploadFileToDrive(buffer, storedName, file.type || "image/jpeg");

    await prisma.statImage.create({
      data: {
        userId: session.id,
        clientId,
        year,
        month,
        driveFileId: fileId,
        driveViewUrl: viewUrl,
        fileName: file.name,
        storedName,
        mimeType: file.type || "image/jpeg",
        batchKey,
      },
    });
    created.push({ storedName, driveFileId: fileId, driveViewUrl: viewUrl });
  }

  return NextResponse.json({ ok: true, batchKey, count: created.length, files: created });
}
