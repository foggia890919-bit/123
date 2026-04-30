import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isNextResponse } from "@/lib/auth-guard";
import { BUCKETS, parseDataUri, extensionFromMime } from "@/lib/storage";
import JSZip from "jszip";

// GET /api/submission-routes/download?submissionEntity=XXX&companyName=YYY(optional)
// 제출처(+선택적 제약사)에 해당하는 사업자등록증을 ZIP으로 반환
// Response header: Content-Disposition: attachment; filename="..."

async function fetchFileBuffer(
  bucket: string,
  key: string
): Promise<{ buf: Buffer; ext: string } | null> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const url = `${process.env.SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/${bucket}/${encodeURI(key)}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "application/octet-stream";
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = extensionFromMime(ct);
    return { buf, ext };
  } catch {
    return null;
  }
}

function dataUriToBuffer(dataUri: string): { buf: Buffer; ext: string } | null {
  const parsed = parseDataUri(dataUri);
  if (!parsed) return null;
  return { buf: parsed.data, ext: extensionFromMime(parsed.contentType) };
}

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;
  if (user.role !== "BIZ" && user.role !== "ADMIN")
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const submissionEntity = req.nextUrl.searchParams.get("submissionEntity");
  const companyNameFilter = req.nextUrl.searchParams.get("companyName");

  if (!submissionEntity)
    return NextResponse.json({ error: "submissionEntity 파라미터 필요" }, { status: 400 });

  // 해당 제출처의 활성 제출처 설정 조회
  const routes = await prisma.submissionRoute.findMany({
    where: {
      active: true,
      submissionEntity,
      ...(companyNameFilter ? { companyName: companyNameFilter } : {}),
    },
    select: { clientName: true, companyName: true },
    orderBy: [{ companyName: "asc" }, { clientName: "asc" }],
  });

  if (routes.length === 0) {
    return NextResponse.json({ error: "해당 제출처에 등록된 거래처가 없어요." }, { status: 404 });
  }

  const clientNames = [...new Set(routes.map((r) => r.clientName))];
  const companyNames = [...new Set(routes.map((r) => r.companyName))];

  // 문서 소스 1: FilterRequest (제약사별 최신 문서)
  const filterRequests = await prisma.filterRequest.findMany({
    where: {
      clientName: { in: clientNames },
      companyName: { in: companyNames },
    },
    select: {
      clientName: true, companyName: true,
      bizFileKey: true, bizDocument: true, bizFileName: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // clientName+companyName → 최신 FilterRequest 매핑
  const frMap = new Map<string, typeof filterRequests[0]>();
  for (const fr of filterRequests) {
    const key = `${fr.clientName}::${fr.companyName}`;
    if (!frMap.has(key)) frMap.set(key, fr);
  }

  // 문서 소스 2: UserClient (clientName 기준)
  const userClients = await prisma.userClient.findMany({
    where: { clientName: { in: clientNames } },
    select: { clientName: true, bizFileKey: true, bizDocument: true, bizFileName: true },
    orderBy: { createdAt: "desc" },
    distinct: ["clientName"],
  });
  const ucMap = new Map(userClients.map((u) => [u.clientName, u]));

  // 문서 소스 3: 글로벌 Client
  const globalClients = await prisma.client.findMany({
    where: { clientName: { in: clientNames } },
    select: { clientName: true, bizFileKey: true, bizDocument: true, bizFileName: true },
  });
  const gcMap = new Map(globalClients.map((c) => [c.clientName, c]));

  // ZIP 생성
  const zip = new JSZip();
  const matched: string[] = [];
  const missing: string[] = [];
  // 파일명 중복 방지
  const nameCount = new Map<string, number>();

  for (const route of routes) {
    const { clientName, companyName } = route;
    const frKey = `${clientName}::${companyName}`;

    let fileResult: { buf: Buffer; ext: string } | null = null;
    let originalName: string | null = null;

    // 우선순위 1: FilterRequest (제약사 매칭)
    const fr = frMap.get(frKey);
    if (fr) {
      if (fr.bizFileKey) {
        fileResult = await fetchFileBuffer(BUCKETS.filterRequestBiz, fr.bizFileKey);
        originalName = fr.bizFileName;
      } else if (fr.bizDocument) {
        fileResult = dataUriToBuffer(fr.bizDocument);
        originalName = fr.bizFileName;
      }
    }

    // 우선순위 2: UserClient
    if (!fileResult) {
      const uc = ucMap.get(clientName);
      if (uc) {
        if (uc.bizFileKey) {
          fileResult = await fetchFileBuffer(BUCKETS.userClientBiz, uc.bizFileKey);
          originalName = uc.bizFileName;
        } else if (uc.bizDocument) {
          fileResult = dataUriToBuffer(uc.bizDocument);
          originalName = uc.bizFileName;
        }
      }
    }

    // 우선순위 3: 글로벌 Client
    if (!fileResult) {
      const gc = gcMap.get(clientName);
      if (gc) {
        if (gc.bizFileKey) {
          fileResult = await fetchFileBuffer("client-documents" as typeof BUCKETS.userClientBiz, gc.bizFileKey);
          originalName = gc.bizFileName;
        } else if (gc.bizDocument) {
          fileResult = dataUriToBuffer(gc.bizDocument);
          originalName = gc.bizFileName;
        }
      }
    }

    if (fileResult) {
      const safeName = clientName.replace(/[/\\:*?"<>|]/g, "_");
      const ext = fileResult.ext || (originalName?.split(".").pop() ?? "bin");
      let fileName = `${safeName}_사업자등록증.${ext}`;
      // 중복 파일명 처리
      const prev = nameCount.get(fileName) ?? 0;
      if (prev > 0) fileName = `${safeName}_사업자등록증_${prev + 1}.${ext}`;
      nameCount.set(fileName, (prev ?? 0) + 1);

      // 제약사 폴더별 분류
      const folder = companyNameFilter ? "" : companyName.replace(/[/\\:*?"<>|]/g, "_");
      zip.file(folder ? `${folder}/${fileName}` : fileName, fileResult.buf);
      matched.push(`${clientName}(${companyName})`);
    } else {
      missing.push(`${clientName}(${companyName})`);
    }
  }

  // 누락 목록 텍스트 파일 추가
  if (missing.length > 0) {
    const missingText = [
      `[사업자등록증 누락 목록] - ${new Date().toLocaleDateString("ko-KR")}`,
      `제출처: ${submissionEntity}`,
      "",
      ...missing.map((m, i) => `${i + 1}. ${m}`),
      "",
      `총 ${routes.length}건 중 ${missing.length}건 누락, ${matched.length}건 매칭`,
    ].join("\n");
    zip.file("_누락목록.txt", missingText);
  }

  if (matched.length === 0) {
    return NextResponse.json({
      error: "매칭된 사업자등록증이 없어요. 먼저 문서를 업로드해 주세요.",
      missing,
    }, { status: 404 });
  }

  const safeEntity = submissionEntity.replace(/[/\\:*?"<>|]/g, "_");
  const dateStr = new Date().toISOString().slice(0, 7).replace("-", "");
  const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const body = new Uint8Array(zipBuf.buffer, zipBuf.byteOffset, zipBuf.byteLength);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${safeEntity}_사업자등록증_${dateStr}.zip`)}`,
      "X-Matched-Count": String(matched.length),
      "X-Missing-Count": String(missing.length),
    },
  });
}
