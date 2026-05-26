import { NextRequest, NextResponse } from "next/server";
import { requireSession, isNextResponse } from "@/lib/auth-guard";

export async function POST(req: NextRequest) {
  const user = await requireSession();
  if (isNextResponse(user)) return user;

  const { bizNumber } = await req.json();
  if (!bizNumber) return NextResponse.json({ error: "bizNumber required" }, { status: 400 });

  const digits = String(bizNumber).replace(/\D/g, "");
  if (digits.length !== 10) return NextResponse.json({ error: "invalid length" }, { status: 400 });

  const apiKey = process.env.PUBLIC_DATA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ valid: null, error: "API key not configured" }, { status: 503 });
  }

  try {
    const url = `https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${encodeURIComponent(apiKey)}&returnType=JSON`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ b_no: [digits] }),
    });

    if (!res.ok) {
      // 401/403 = 키 잘못됨/만료. 사용자에게는 검증을 우회하도록 안내 (자체 형식 검증으로 통과).
      if (res.status === 401 || res.status === 403) {
        return NextResponse.json({ valid: null, error: "국세청 조회 키가 유효하지 않아요. 형식 검증만 적용됩니다." }, { status: 503 });
      }
      return NextResponse.json({ valid: null, error: `국세청 조회 일시 오류 (${res.status})` }, { status: 502 });
    }

    const data = await res.json();
    const item = data?.data?.[0];
    if (!item) {
      return NextResponse.json({ valid: false, error: "No result from NTS" }, { status: 502 });
    }

    // b_stt_cd: "01" = 계속사업자, "02" = 휴업자, "03" = 폐업자
    const valid = item.b_stt_cd === "01";
    const closed = item.b_stt_cd === "03";
    // tax_type_cd: "3" = 면세사업자 (medical institutions are typically tax-exempt)
    const isMedicalLikely = item.tax_type_cd === "3";

    return NextResponse.json({
      valid,
      closed,
      statusText: item.b_stt ?? "",
      taxType: item.tax_type ?? "",
      taxTypeCd: item.tax_type_cd ?? "",
      isMedicalLikely,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ valid: null, error: msg }, { status: 502 });
  }
}
