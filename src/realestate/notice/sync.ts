import { prisma } from "@/lib/prisma";
import { fetchAptNotices, type ApplyhomeNotice, type ApplyhomeQuery } from "./applyhome";
import { fetchLhNotices, type LhNotice } from "./lh";
import { geocodeJibun } from "../land/vworld";

export interface NoticeSyncSummary {
  source: string;
  fetched: number;
  upserted: number;
  geocoded: number;
  errors: { externalId: string; error: string }[];
}

export async function syncApplyhome(q: ApplyhomeQuery = {}): Promise<NoticeSyncSummary> {
  const items = await fetchAptNotices(q);
  return saveAll(items, "applyhome");
}

export async function syncLh(): Promise<NoticeSyncSummary> {
  const items = await fetchLhNotices();
  return saveAll(items, "lh");
}

async function saveAll(items: (ApplyhomeNotice | LhNotice)[], source: string): Promise<NoticeSyncSummary> {
  const summary: NoticeSyncSummary = { source, fetched: items.length, upserted: 0, geocoded: 0, errors: [] };

  for (const it of items) {
    try {
      // 좌표 보강 — 주소가 있으면 V월드로 geocode
      let lat: number | null = null;
      let lng: number | null = null;
      if (it.address) {
        try {
          const g = await geocodeJibun(it.address);
          if (g) {
            lat = g.lat; lng = g.lng;
            summary.geocoded++;
          }
        } catch {
          /* geocode 실패는 무시 */
        }
      }

      await prisma.apartmentNotice.upsert({
        where: { externalId: it.externalId },
        create: {
          externalId: it.externalId,
          source: it.source,
          noticeName: it.noticeName,
          houseType: it.houseType,
          totalHouseholds: it.totalHouseholds,
          generalHouseholds: "generalHouseholds" in it ? it.generalHouseholds : null,
          specialHouseholds: "specialHouseholds" in it ? it.specialHouseholds : null,
          region: it.region,
          cortarNo: "cortarNo" in it ? it.cortarNo : null,
          address: it.address,
          latitude: lat,
          longitude: lng,
          noticeAt: it.noticeAt,
          applyStartAt: it.applyStartAt,
          applyEndAt: it.applyEndAt,
          contractAt: "contractAt" in it ? it.contractAt : null,
          moveInAt: it.moveInAt,
          raw: it.raw as never,
        },
        update: {
          noticeName: it.noticeName,
          totalHouseholds: it.totalHouseholds ?? undefined,
          latitude: lat ?? undefined,
          longitude: lng ?? undefined,
          moveInAt: it.moveInAt ?? undefined,
          fetchedAt: new Date(),
        },
      });
      summary.upserted++;
    } catch (e) {
      summary.errors.push({ externalId: it.externalId, error: (e as Error).message });
    }
  }
  return summary;
}
