// 일일 다이제스트 — 매일 아침 사업주에게 한 번에 보낼 요약.
//
// 포함 내용:
//   1) 점수 Top N 후보지 (LocationScore 최신 compositeScore 순)
//   2) 어제 신규로 등장한 매물 (REListing.firstSeenAt)
//   3) 어제 신규로 등장한 분양 공고 (ApartmentNotice.fetchedAt)
//
// 채널: SMS (Coolsms) / 텔레그램 / 콘솔 로그.

import { prisma } from "@/lib/prisma";
import { sendSms } from "@/lib/coolsms";

export interface DailyReportOptions {
  topN?: number;
  channel?: "sms" | "telegram" | "log";
  recipient?: string;
}

export interface DailyReportData {
  reportDate: Date;
  topPicks: TopPick[];
  newListings: NewListing[];
  newNotices: NewNotice[];
}

interface TopPick {
  parcelId: string;
  jibun: string | null;
  sigungu: string | null;
  landUse: string | null;
  compositeScore: number;
  prescriptionScore: number | null;
  trafficFlow: number | null;
  supplyAdvantage: number | null;
  recommendedSpecialties: string[];
}
interface NewListing {
  id: string;
  url: string | null;
  title: string | null;
  address: string | null;
  tradeType: string;
  propertyType: string;
  priceSale: number | null;
  priceDeposit: number | null;
  priceMonthly: number | null;
}
interface NewNotice {
  id: string;
  noticeName: string;
  region: string | null;
  totalHouseholds: number | null;
  moveInAt: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function buildDailyReport(opts: DailyReportOptions = {}): Promise<DailyReportData> {
  const topN = opts.topN ?? 5;
  const today = startOfDay(new Date());
  const yesterday = new Date(today.getTime() - DAY_MS);

  const [scores, parcels, listings, notices] = await Promise.all([
    prisma.locationScore.findMany({
      where: { compositeScore: { not: null } },
      orderBy: { compositeScore: "desc" },
      take: topN,
    }),
    // 점수 행에 매핑할 parcel은 별도 fetch
    Promise.resolve(null),
    prisma.rEListing.findMany({
      where: { firstSeenAt: { gte: yesterday, lt: today }, closedAt: null },
      orderBy: { firstSeenAt: "desc" },
      take: 10,
      select: {
        id: true, url: true, title: true, address: true,
        tradeType: true, propertyType: true,
        priceSale: true, priceDeposit: true, priceMonthly: true,
      },
    }),
    prisma.apartmentNotice.findMany({
      where: { fetchedAt: { gte: yesterday, lt: today } },
      orderBy: { fetchedAt: "desc" },
      take: 10,
      select: { id: true, noticeName: true, region: true, totalHouseholds: true, moveInAt: true },
    }),
  ]);

  const parcelIds = scores.map(s => s.parcelId);
  const parcelMap = new Map(
    (await prisma.parcel.findMany({
      where: { id: { in: parcelIds } },
      select: { id: true, jibun: true, sigungu: true, landUse: true },
    })).map(p => [p.id, p])
  );

  const topPicks: TopPick[] = scores.map(s => {
    const p = parcelMap.get(s.parcelId);
    return {
      parcelId: s.parcelId,
      jibun: p?.jibun ?? null,
      sigungu: p?.sigungu ?? null,
      landUse: p?.landUse ?? null,
      compositeScore: s.compositeScore ?? 0,
      prescriptionScore: s.prescriptionScore,
      trafficFlow: s.trafficFlow,
      supplyAdvantage: s.supplyAdvantage,
      recommendedSpecialties: s.recommendedSpecialties,
    };
  });

  return {
    reportDate: today,
    topPicks,
    newListings: listings,
    newNotices: notices.map(n => ({
      id: n.id,
      noticeName: n.noticeName,
      region: n.region,
      totalHouseholds: n.totalHouseholds,
      moveInAt: n.moveInAt,
    })),
  };
}

export function formatReportText(d: DailyReportData): string {
  const lines: string[] = [];
  const dateStr = `${d.reportDate.getFullYear()}-${String(d.reportDate.getMonth()+1).padStart(2,"0")}-${String(d.reportDate.getDate()).padStart(2,"0")}`;
  lines.push(`[메디컬 입지 다이제스트 ${dateStr}]`);

  if (d.topPicks.length > 0) {
    lines.push("");
    lines.push(`▣ 점수 Top ${d.topPicks.length}`);
    d.topPicks.forEach((t, i) => {
      lines.push(`${i+1}. ${t.jibun ?? t.parcelId.slice(0,8)} (${t.sigungu ?? "-"}) · ${t.compositeScore.toFixed(1)}점 · ${t.landUse ?? "-"}`);
      const tags = [
        t.prescriptionScore != null ? `처방${t.prescriptionScore.toFixed(0)}` : null,
        t.trafficFlow != null ? `교통${t.trafficFlow.toFixed(0)}` : null,
        t.supplyAdvantage != null ? `공급${t.supplyAdvantage.toFixed(0)}` : null,
      ].filter(Boolean).join(" / ");
      if (tags) lines.push(`   ${tags}`);
      if (t.recommendedSpecialties.length > 0) lines.push(`   추천: ${t.recommendedSpecialties.slice(0,3).join(", ")}`);
    });
  }

  if (d.newListings.length > 0) {
    lines.push("");
    lines.push(`▣ 신규 매물 ${d.newListings.length}건`);
    d.newListings.slice(0, 5).forEach(l => {
      const price = l.priceSale != null
        ? `매매 ${manwon(l.priceSale)}`
        : l.priceMonthly != null && l.priceDeposit != null
          ? `${manwon(l.priceDeposit)}/${l.priceMonthly}만`
          : l.priceDeposit != null ? `전세 ${manwon(l.priceDeposit)}` : "-";
      lines.push(`- ${l.title ?? l.address ?? l.id.slice(0,8)} · ${l.tradeType} ${l.propertyType} · ${price}`);
    });
  }

  if (d.newNotices.length > 0) {
    lines.push("");
    lines.push(`▣ 신규 분양 ${d.newNotices.length}건`);
    d.newNotices.slice(0, 5).forEach(n => {
      const move = n.moveInAt ? `입주 ${n.moveInAt.getFullYear()}.${String(n.moveInAt.getMonth()+1).padStart(2,"0")}` : "";
      lines.push(`- ${n.noticeName} · ${n.region ?? "-"} · ${n.totalHouseholds?.toLocaleString() ?? "-"}세대 · ${move}`);
    });
  }

  if (d.topPicks.length === 0 && d.newListings.length === 0 && d.newNotices.length === 0) {
    lines.push("");
    lines.push("(어제는 새 항목이 없습니다.)");
  }

  return lines.join("\n");
}

function manwon(v: number): string {
  if (v >= 10_000) {
    const eok = Math.floor(v / 10_000);
    const rem = v % 10_000;
    return rem ? `${eok}억${rem.toLocaleString()}` : `${eok}억`;
  }
  return `${v.toLocaleString()}만`;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** 보고서를 생성·저장·발송. 같은 날·scope는 멱등(이미 있으면 갱신만). */
export async function runDailyReport(opts: DailyReportOptions = {}): Promise<{
  reportId: string;
  channel: string;
  status: "SENT" | "FAILED" | "PENDING";
  text: string;
}> {
  const channel = opts.channel ?? (process.env.DAILY_REPORT_CHANNEL as "sms" | "telegram" | "log" | undefined) ?? "log";
  const recipient = opts.recipient ?? process.env.DAILY_REPORT_RECIPIENT ?? null;
  const data = await buildDailyReport(opts);
  const text = formatReportText(data);

  const existing = await prisma.dailyReport.findUnique({
    where: { reportDate_scope: { reportDate: data.reportDate, scope: "global" } },
  });
  const baseData = {
    reportDate: data.reportDate,
    scope: "global",
    topPicks: data.topPicks as never,
    newListings: data.newListings as never,
    newNotices: data.newNotices as never,
    summaryText: text,
    channel,
    recipient,
  };

  let status: "SENT" | "FAILED" | "PENDING" = "PENDING";
  let error: string | null = null;
  try {
    if (channel === "sms" && recipient) {
      await sendSms(recipient, text);
      status = "SENT";
    } else if (channel === "telegram" && recipient) {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token) throw new Error("TELEGRAM_BOT_TOKEN missing");
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: recipient, text, disable_web_page_preview: true }),
      });
      if (!r.ok) throw new Error(`telegram ${r.status}`);
      status = "SENT";
    } else {
      console.log(text);
      status = "SENT"; // log 채널도 성공으로 간주
    }
  } catch (e) {
    status = "FAILED";
    error = (e as Error).message;
  }

  const saved = existing
    ? await prisma.dailyReport.update({
        where: { id: existing.id },
        data: { ...baseData, status, error, sentAt: status === "SENT" ? new Date() : null },
      })
    : await prisma.dailyReport.create({
        data: { ...baseData, status, error, sentAt: status === "SENT" ? new Date() : null },
      });

  return { reportId: saved.id, channel, status, text };
}
