import { NextRequest, NextResponse } from "next/server";
import { parseFileBuffer, pick, toInt } from "@/lib/parse-excel";
import { HEADER } from "@/lib/naver/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DetailRow {
  date: string;
  store: string;
  productName: string;
  optionName: string;
  quantity: number;
  unitPrice: number;
  salesAmount: number;
  payCommission: number;
  channelCommission: number;
  status: string;
  channelName: string;
}

interface AggregateRow {
  key: string;
  quantity: number;
  salesAmount: number;
  totalCommission: number;
  orderIds: Set<string>;
}

function parseDate(s: string): string {
  if (!s) return "";
  const cleaned = s.replace(/\./g, "-").replace("오전", "AM").replace("오후", "PM").trim();
  const d = new Date(cleaned);
  if (isNaN(d.getTime())) return s.slice(0, 10);
  // KST 기준 날짜
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
  const storeName = String(form.get("storeName") ?? "");

  const buf = await file.arrayBuffer();
  const { rows: rawRows } = parseFileBuffer(buf);

  const details: DetailRow[] = [];
  for (const r of rawRows) {
    const productOrderId = pick(r, HEADER.productOrderId);
    if (!productOrderId) continue;
    const productName = pick(r, HEADER.productName);
    if (!productName) continue;

    const orderId = pick(r, HEADER.orderId) || productOrderId;
    const optionName = pick(r, HEADER.optionName);
    const quantity = toInt(pick(r, HEADER.quantity));
    const unitPrice = toInt(pick(r, HEADER.unitPrice));
    const salesAmount = toInt(pick(r, HEADER.salesAmount));
    const payCommission = toInt(pick(r, HEADER.payCommission));
    const channelCommission = toInt(pick(r, HEADER.channelCommission));
    const status = pick(r, HEADER.detailStatus) || pick(r, HEADER.status);
    const channelName = pick(r, HEADER.channelName);
    const dateStr = parseDate(pick(r, HEADER.paymentDate) || pick(r, HEADER.orderedAt));

    details.push({
      date: dateStr,
      store: storeName || channelName || "스토어",
      productName,
      optionName,
      quantity,
      unitPrice,
      salesAmount,
      payCommission,
      channelCommission,
      status,
      channelName,
    });
    // orderId 도 부분 집계에 활용
    void orderId;
  }

  // 집계 — 여러 차원으로
  const aggregate = (keyFn: (d: DetailRow) => string, includeOption = false) => {
    const map = new Map<string, AggregateRow & { date?: string; store?: string; productName?: string; optionName?: string }>();
    for (const d of details) {
      const k = keyFn(d);
      const cur = map.get(k);
      if (cur) {
        cur.quantity += d.quantity;
        cur.salesAmount += d.salesAmount;
        cur.totalCommission += d.payCommission + d.channelCommission;
      } else {
        map.set(k, {
          key: k,
          quantity: d.quantity,
          salesAmount: d.salesAmount,
          totalCommission: d.payCommission + d.channelCommission,
          orderIds: new Set(),
          date: d.date,
          store: d.store,
          productName: d.productName,
          optionName: includeOption ? d.optionName : undefined,
        });
      }
    }
    return Array.from(map.values());
  };

  const byDate = aggregate((d) => d.date)
    .map((r) => ({ date: r.date!, quantity: r.quantity, salesAmount: r.salesAmount }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const byOption = aggregate((d) => `${d.productName}::${d.optionName}`, true)
    .map((r) => ({
      productName: r.productName!,
      optionName: r.optionName!,
      quantity: r.quantity,
      salesAmount: r.salesAmount,
      totalCommission: r.totalCommission,
    }))
    .sort((a, b) => b.salesAmount - a.salesAmount);

  const byProduct = aggregate((d) => d.productName)
    .map((r) => ({
      productName: r.productName!,
      quantity: r.quantity,
      salesAmount: r.salesAmount,
      totalCommission: r.totalCommission,
    }))
    .sort((a, b) => b.salesAmount - a.salesAmount);

  const byDateOption = aggregate((d) => `${d.date}::${d.productName}::${d.optionName}`, true)
    .map((r) => ({
      date: r.date!,
      productName: r.productName!,
      optionName: r.optionName!,
      quantity: r.quantity,
      salesAmount: r.salesAmount,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || b.salesAmount - a.salesAmount);

  const totals = {
    rows: details.length,
    quantity: details.reduce((a, d) => a + d.quantity, 0),
    salesAmount: details.reduce((a, d) => a + d.salesAmount, 0),
    totalCommission: details.reduce((a, d) => a + d.payCommission + d.channelCommission, 0),
  };

  return NextResponse.json({ ok: true, totals, byDate, byOption, byProduct, byDateOption });
}
