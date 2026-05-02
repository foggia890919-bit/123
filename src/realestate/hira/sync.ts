import { prisma } from "@/lib/prisma";
import { fetchFacilities, fetchSpecialties, fetchEquipment, type HiraQuery } from "./facilities";

export interface HiraSyncSummary {
  fetched: number;
  upserted: number;
  enriched: number;
  errors: { ykiho: string; error: string }[];
}

/**
 * 시군구 단위로 의료기관 기본정보 + (옵션) 진료과목·장비까지 동기화.
 * enrich=true면 ykiho마다 추가 호출이라 시간이 오래 걸린다 (수백 ykiho × 2호출).
 */
export async function syncHira(opts: HiraQuery & { enrich?: boolean; maxPages?: number }): Promise<HiraSyncSummary> {
  const summary: HiraSyncSummary = { fetched: 0, upserted: 0, enriched: 0, errors: [] };
  const maxPages = opts.maxPages ?? 5;

  for (let page = 1; page <= maxPages; page++) {
    const items = await fetchFacilities({ ...opts, pageNo: page });
    if (items.length === 0) break;
    summary.fetched += items.length;

    for (const it of items) {
      try {
        // 진료과목 + 장비 보강
        let specialties: string[] = [];
        let equipment: string[] = [];
        if (opts.enrich) {
          const [specs, eqs] = await Promise.all([
            fetchSpecialties(it.ykiho).catch(() => []),
            fetchEquipment(it.ykiho).catch(() => []),
          ]);
          specialties = specs.map(s => s.name);
          equipment = eqs.map(e => e.name);
          summary.enriched++;
        }

        await prisma.medicalFacility.upsert({
          where: { ykiho: it.ykiho },
          create: {
            ykiho: it.ykiho,
            name: it.name,
            facilityType: it.facilityType,
            specialties,
            bedCount: it.bedCount,
            doctorCount: it.doctorCount,
            equipment,
            address: it.address,
            cortarNo: it.cortarNo,
            sigungu: it.sigungu,
            latitude: it.latitude,
            longitude: it.longitude,
            openedAt: it.openedAt,
            status: "OPEN",
            raw: it.raw as never,
          },
          update: {
            name: it.name,
            facilityType: it.facilityType ?? undefined,
            specialties: opts.enrich ? specialties : undefined,
            equipment: opts.enrich ? equipment : undefined,
            bedCount: it.bedCount ?? undefined,
            doctorCount: it.doctorCount ?? undefined,
            address: it.address ?? undefined,
            sigungu: it.sigungu ?? undefined,
            latitude: it.latitude ?? undefined,
            longitude: it.longitude ?? undefined,
            fetchedAt: new Date(),
          },
        });
        summary.upserted++;
      } catch (e) {
        summary.errors.push({ ykiho: it.ykiho, error: (e as Error).message });
      }
    }
    if (items.length < (opts.numOfRows ?? 100)) break; // 마지막 페이지
  }
  return summary;
}
