import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";

const API_KEY = process.env.PUBLIC_DATA_API_KEY!;

const ENDPOINTS: Record<string, { url: string; useJson: boolean }> = {
  hira_dgamt:      { url: "https://apis.data.go.kr/B551182/dgamtCrtrInfoService1.2/getDgamtList", useJson: false },
  mfds_bundle:     { url: "https://apis.data.go.kr/1471000/DrbBundleInfoService02/getDrbBundleList02", useJson: true },
  mfds_permit:     { url: "https://apis.data.go.kr/1471000/DrugPrdtPrmsnInfoService07/getDrugPrdtPrmsnInq07", useJson: true },
  // HIRA 약가마스터 후보들
  hira_msupply:    { url: "https://apis.data.go.kr/B551182/msupplyDtlService/getMsupplyDtlService", useJson: true },
  hira_msupply_ingd: { url: "https://apis.data.go.kr/B551182/msupplyIngdDtlService/getMsupplyIngdDtlService", useJson: true },
  hira_cmpn:       { url: "https://apis.data.go.kr/B551182/msupCmpnMeftInfoService/getMajorCmpnNmCdList", useJson: true },
  hira_msupply_xml: { url: "https://apis.data.go.kr/B551182/msupplyDtlService/getMsupplyDtlService", useJson: false },
  // odcloud ATC 주성분코드 — UDDI 두 버전 테스트용
  odcloud_6753:    { url: "https://api.odcloud.kr/api/15118958/v1/uddi:6753c7f1-65ed-4bbe-9e98-cd6b7b156a92", useJson: true },
  odcloud_1d0f:    { url: "https://api.odcloud.kr/api/15118958/v1/uddi:1d0f74ec-fc9e-4386-9f67-9b1295b4c149", useJson: true },
};

export async function GET(req: NextRequest) {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;
  const target = req.nextUrl.searchParams.get("target") || "hira_msupply";
  const endpoint = ENDPOINTS[target];
  if (!endpoint) return NextResponse.json({ error: "알 수 없는 target", available: Object.keys(ENDPOINTS) });

  const apiUrl = new URL(endpoint.url);
  apiUrl.searchParams.set("serviceKey", API_KEY);
  apiUrl.searchParams.set("pageNo", "1");
  apiUrl.searchParams.set("numOfRows", "3");
  if (endpoint.useJson) apiUrl.searchParams.set("type", "json");

  try {
    const res = await fetch(apiUrl.toString(), { cache: "no-store" });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = null; }

    return NextResponse.json({
      target,
      url: apiUrl.toString().replace(API_KEY, "***KEY***"),
      status: res.status,
      rawText: text.slice(0, 3000),
      parsed: json,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err), url: apiUrl.toString().replace(API_KEY, "***KEY***") });
  }
}
