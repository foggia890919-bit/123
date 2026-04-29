import { prisma } from "@/lib/prisma";
import type { RawAgent, RawListing } from "./types";

export interface UpsertResult {
  listingId: string;
  isNew: boolean;
}

/**
 * 매물 + 중개사를 upsert. 신규 매물 여부를 반환해서 알림 매칭 단계에서 활용한다.
 */
export async function upsertListing(raw: RawListing): Promise<UpsertResult> {
  let agentId: string | null = null;
  if (raw.agent) {
    const agent = await upsertAgent(raw.agent);
    agentId = agent.id;
  }

  const existing = await prisma.rEListing.findUnique({
    where: { externalId: raw.externalId },
    select: { id: true },
  });

  const data = {
    source: "naver",
    url: raw.url,
    tradeType: String(raw.tradeType),
    propertyType: String(raw.propertyType),
    title: raw.title,
    cortarNo: raw.cortarNo,
    address: raw.address,
    region: raw.region,
    latitude: raw.latitude,
    longitude: raw.longitude,
    priceSale: raw.priceSale,
    priceDeposit: raw.priceDeposit,
    priceMonthly: raw.priceMonthly,
    areaSupply: raw.areaSupply,
    areaExclusive: raw.areaExclusive,
    floor: raw.floor,
    description: raw.description,
    features: raw.features,
    raw: raw.raw as never,
    agentId,
    postedAt: raw.postedAt,
  };

  if (existing) {
    await prisma.rEListing.update({
      where: { id: existing.id },
      data: { ...data, lastSeenAt: new Date() },
    });
    return { listingId: existing.id, isNew: false };
  }
  const created = await prisma.rEListing.create({
    data: { externalId: raw.externalId, ...data },
    select: { id: true },
  });
  return { listingId: created.id, isNew: true };
}

export async function upsertAgent(raw: RawAgent): Promise<{ id: string }> {
  return prisma.rEAgent.upsert({
    where: { externalId: raw.externalId },
    create: {
      externalId: raw.externalId,
      name: raw.name,
      phone: raw.phone,
      address: raw.address,
      representative: raw.representative,
      registrationNo: raw.registrationNo,
    },
    update: {
      // 한 번이라도 더 풍부한 정보를 잡았다면 보존 (null 덮어쓰기 방지)
      name: raw.name,
      phone: raw.phone ?? undefined,
      address: raw.address ?? undefined,
      representative: raw.representative ?? undefined,
      registrationNo: raw.registrationNo ?? undefined,
      lastSeenAt: new Date(),
    },
    select: { id: true },
  });
}

/** 매물 종료(closedAt) 마킹 — 마지막 본 시점이 N일 이상 지났으면 종료로 본다. */
export async function markStaleClosed(staleDays = 14): Promise<number> {
  const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);
  const res = await prisma.rEListing.updateMany({
    where: { lastSeenAt: { lt: cutoff }, closedAt: null },
    data: { closedAt: new Date() },
  });
  return res.count;
}
