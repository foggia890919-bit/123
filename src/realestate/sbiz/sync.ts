import { prisma } from "@/lib/prisma";
import { fetchStoresByDong, filterMedical } from "./client";

/**
 * 행정동(cortarNo)별로 점포 수와 의료기관 수를 집계해서 SbizMarketArea 한 행으로 저장.
 * trarNo는 행정동을 임시 키로 사용 ("dong:<cortarNo>").
 */
export async function snapshotDong(cortarNo: string): Promise<{
  total: number;
  medical: number;
}> {
  const stores = await fetchStoresByDong({ cortarNo });
  const medical = filterMedical(stores);
  const sample = stores[0];
  await prisma.sbizMarketArea.upsert({
    where: { trarNo: `dong:${cortarNo}` },
    create: {
      trarNo: `dong:${cortarNo}`,
      trarName: sample?.dong ?? cortarNo,
      cortarNo,
      sido: null,
      sigungu: sample?.sigungu ?? null,
      storeCount: stores.length,
      medicalClinic: medical.length,
      populationDay: null,
      populationNight: null,
      estimatedRentPerM2: null,
      raw: { sampleSize: stores.length } as never,
    },
    update: {
      trarName: sample?.dong ?? cortarNo,
      sigungu: sample?.sigungu ?? null,
      storeCount: stores.length,
      medicalClinic: medical.length,
      fetchedAt: new Date(),
    },
  });
  return { total: stores.length, medical: medical.length };
}
