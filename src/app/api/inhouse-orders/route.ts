import { NextRequest, NextResponse } from "next/server";
import { isNextResponse, requireSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { sendTelegramMessage } from "@/lib/telegram";

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const { clientName, bizNumber, note, items } = body as {
    clientName?: string;
    bizNumber?: string;
    note?: string;
    items?: Array<{
      priceCode: string;
      productName: string;
      manufacturer?: string;
      spec?: string | null;
      basePrice?: number | null;
      unitPrice?: number | null;
      quantity?: number;
    }>;
  };

  if (!Array.isArray(items) || items.length === 0)
    return NextResponse.json({ error: "items 필드가 필요합니다 (최소 1개)" }, { status: 400 });

  const order = await prisma.inhouseOrder.create({
    data: {
      userId: user.id,
      clientName: clientName?.trim() || "미지정",
      bizNumber: bizNumber?.trim() || null,
      note: note?.trim() || null,
      items: {
        create: items.map((it) => ({
          priceCode: it.priceCode,
          productName: it.productName,
          manufacturer: it.manufacturer ?? "",
          spec: it.spec ?? null,
          basePrice: it.basePrice ?? null,
          unitPrice: it.unitPrice ?? null,
          quantity: Math.max(1, it.quantity ?? 1),
        })),
      },
    },
    include: { items: true },
  });

  // Telegram 알람 (best-effort)
  const itemLines = order.items
    .map((i) => `• ${i.productName}${i.spec ? ` (${i.spec})` : ""} × ${i.quantity}`)
    .join("\n");
  const msg =
    `📦 *원내거래 주문 요청*\n` +
    `\n거래처: ${order.clientName}${order.bizNumber ? ` (${order.bizNumber})` : ""}` +
    `\n담당자: ${user.name ?? user.email}` +
    `\n\n${itemLines}` +
    (order.note ? `\n\n📝 ${order.note}` : "") +
    `\n\n⏰ ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`;
  await sendTelegramMessage(msg).catch(() => {});

  return NextResponse.json({ order });
}

export async function GET(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  const url = req.nextUrl;
  const status = url.searchParams.get("status") ?? undefined;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "100"), 200);

  const isStaff = user.role === "BIZ" || user.role === "ADMIN";
  const where = {
    ...(isStaff ? {} : { userId: user.id }),
    ...(status ? { status: status as never } : {}),
  };

  const orders = await prisma.inhouseOrder.findMany({
    where,
    include: {
      items: true,
      user: { select: { id: true, name: true, email: true, salesCode: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ orders });
}
