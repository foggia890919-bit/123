import { NextRequest, NextResponse } from "next/server";

const API_KEY = process.env.PUBLIC_DATA_API_KEY!;

// 테스트할 후보 엔드포인트들
const ENDPOINTS = {
  hira_yakga: "https://apis.data.go.kr/B551182/MdcinGrnIdntfcInfoService01/getMdcinGrnIdntfcInfoList01",
  hira_presc: "https://apis.data.go.kr/B551182/prescDrugInfo1/getPrescDrugInfo1",
  mfds_permit: "https://apis.data.go.kr/1471000/DrugInfoService/getDrugObjectList",
  mfds_bundle: "https://apis.data.go.kr/1471000/MdcinGrnIdntfcInfoService/getMdcinGrnIdntfcInfoList",
};

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("target") || "hira_yakga";
  const url = ENDPOINTS[target as keyof typeof ENDPOINTS];
  if (!url) return NextResponse.json({ error: "알 수 없는 target", available: Object.keys(ENDPOINTS) });

  const apiUrl = new URL(url);
  apiUrl.searchParams.set("serviceKey", API_KEY);
  apiUrl.searchParams.set("pageNo", "1");
  apiUrl.searchParams.set("numOfRows", "3");
  apiUrl.searchParams.set("type", "json");

  try {
    const res = await fetch(apiUrl.toString(), { cache: "no-store" });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = null; }

    return NextResponse.json({
      target,
      url: apiUrl.toString().replace(API_KEY, "***KEY***"),
      status: res.status,
      rawText: text.slice(0, 2000),
      parsed: json,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err), url: apiUrl.toString().replace(API_KEY, "***KEY***") });
  }
}
