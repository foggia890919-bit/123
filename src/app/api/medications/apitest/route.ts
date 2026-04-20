import { NextRequest, NextResponse } from "next/server";

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
};

export async function GET(req: NextRequest) {
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
