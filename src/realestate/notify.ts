import { prisma } from "@/lib/prisma";
import { sendSms } from "@/lib/coolsms";
import type { REListing, REWatch } from "@prisma/client";

export interface NotifyResult {
  channel: "sms" | "telegram" | "log";
  ok: boolean;
  error?: string;
}

export function formatListingMessage(watch: REWatch, listing: REListing): string {
  const parts: string[] = [];
  parts.push(`[부동산 알림: ${watch.name}]`);
  parts.push(`${listing.tradeType} · ${listing.propertyType}`);
  if (listing.title) parts.push(listing.title);
  if (listing.address) parts.push(listing.address);
  parts.push(formatPrice(listing));
  if (listing.areaSupply || listing.areaExclusive) {
    parts.push(`면적 ${listing.areaExclusive ?? listing.areaSupply}㎡`);
  }
  if (listing.floor) parts.push(`층 ${listing.floor}`);
  if (listing.url) parts.push(listing.url);
  return parts.join("\n");
}

function formatPrice(l: REListing): string {
  if (l.priceSale != null) return `매매 ${manwon(l.priceSale)}`;
  if (l.priceDeposit != null && l.priceMonthly != null) {
    return `월세 ${manwon(l.priceDeposit)}/${l.priceMonthly}`;
  }
  if (l.priceDeposit != null) return `전세 ${manwon(l.priceDeposit)}`;
  return "가격 정보 없음";
}

function manwon(v: number): string {
  if (v >= 10_000) {
    const eok = Math.floor(v / 10_000);
    const rem = v % 10_000;
    return rem ? `${eok}억 ${rem.toLocaleString()}만` : `${eok}억`;
  }
  return `${v.toLocaleString()}만`;
}

async function dispatch(watch: REWatch, listing: REListing): Promise<NotifyResult[]> {
  const text = formatListingMessage(watch, listing);
  const results: NotifyResult[] = [];

  if (watch.notifySms && watch.smsTo) {
    try {
      await sendSms(watch.smsTo, text);
      results.push({ channel: "sms", ok: true });
    } catch (e) {
      results.push({ channel: "sms", ok: false, error: (e as Error).message });
    }
  }

  if (watch.notifyTelegram && watch.telegramChatId) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      results.push({ channel: "telegram", ok: false, error: "TELEGRAM_BOT_TOKEN missing" });
    } else {
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: watch.telegramChatId,
            text,
            disable_web_page_preview: false,
          }),
        });
        if (!res.ok) throw new Error(`telegram ${res.status}: ${await res.text()}`);
        results.push({ channel: "telegram", ok: true });
      } catch (e) {
        results.push({ channel: "telegram", ok: false, error: (e as Error).message });
      }
    }
  }

  if (results.length === 0) {
    console.log(`[re-alert][${watch.name}] ${text}`);
    results.push({ channel: "log", ok: true });
  }
  return results;
}

/**
 * 신규 매물 한 건에 대해 모든 활성 워치를 평가하고, 매칭되는 워치마다 알림을 보낸다.
 * 같은 (watch, listing) 조합은 중복 발송하지 않는다.
 */
export async function evaluateAndNotify(listingId: string): Promise<number> {
  const listing = await prisma.rEListing.findUnique({ where: { id: listingId } });
  if (!listing) return 0;
  const watches = await prisma.rEWatch.findMany({ where: { enabled: true } });
  const { matchListing } = await import("./match");

  let sent = 0;
  for (const watch of watches) {
    if (!matchListing(listing, watch)) continue;
    const dup = await prisma.rEAlert.findUnique({
      where: { watchId_listingId: { watchId: watch.id, listingId: listing.id } },
    });
    if (dup) continue;

    const results = await dispatch(watch, listing);
    for (const r of results) {
      await prisma.rEAlert.create({
        data: {
          watchId: watch.id,
          listingId: listing.id,
          channel: r.channel,
          status: r.ok ? "SENT" : "FAILED",
          error: r.error,
          sentAt: r.ok ? new Date() : null,
        },
      }).catch(() => {});
      if (r.ok) sent++;
    }
  }
  return sent;
}
