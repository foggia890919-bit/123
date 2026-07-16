// 네이버 클로바 General OCR 클라이언트 — 처방통계 사진의 제2 판독 엔진 겸 좌표 소스.
//
// 역할: 사진을 단어(field) 단위로 인식해 "텍스트 + 픽셀 boundingPoly" 목록을 돌려준다.
//   Gemini 단독 판독의 숫자 오류(>5%)를 교차검증으로 잡고, Gemini 가 부정확하게 내는
//   bbox 대신 클로바의 실제 픽셀 좌표를 행/수량 하이라이트 기준으로 쓰기 위함.
//
// 안전 폴백: env 미설정·호출 실패·타임아웃·인식 실패 → null 반환. 호출부는 null 이면
//   기존 Gemini 단독 결과를 그대로 쓴다 (파이프라인 전체가 절대 죽지 않음).
//
// 환경변수 (Vercel production 에 존재 확인됨):
//   CLOVA_OCR_INVOKE_URL   — General OCR APIGW invoke URL
//   CLOVA_OCR_SECRET_KEY   — X-OCR-SECRET 헤더 값

export interface ClovaVertex {
  x: number;
  y: number;
}

// 인식된 단어 하나. 좌표는 원본 이미지의 픽셀 단위.
export interface ClovaWord {
  text: string;
  confidence: number; // 0~1
  vertices: ClovaVertex[]; // 4점 (top-left, top-right, bottom-right, bottom-left)
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  xCenter: number;
  yCenter: number;
  height: number;
}

export interface ClovaOcrResult {
  words: ClovaWord[];
  imageWidth: number; // 정규화(0~1) 기준. 헤더 파싱 실패 시 단어 좌표 최대값으로 근사.
  imageHeight: number;
  durationMs: number;
}

// CLOVA V2 응답의 field 원형 (필요한 것만).
interface ClovaField {
  inferText: string;
  inferConfidence: number;
  boundingPoly?: { vertices: { x: number; y: number }[] };
}

export function isClovaConfigured(): boolean {
  return !!(process.env.CLOVA_OCR_INVOKE_URL && process.env.CLOVA_OCR_SECRET_KEY);
}

function mimeToFormat(mimeType: string): string {
  const m = (mimeType || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("gif")) return "gif";
  if (m.includes("bmp")) return "bmp";
  if (m.includes("tif")) return "tiff";
  if (m.includes("webp")) return "webp"; // CLOVA 미지원일 수 있으나 그대로 시도
  return "jpg";
}

// 이미지 헤더에서 픽셀 크기 추출 (JPEG/PNG/GIF/BMP). 실패하면 null → 좌표 최대값으로 근사.
function readImageSize(buf: Buffer): { w: number; h: number } | null {
  try {
    // PNG: 8B signature + IHDR(len4+"IHDR"4) → width@16, height@20 (big-endian)
    if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      if (w > 0 && h > 0) return { w, h };
    }
    // GIF: "GIF8" → width@6, height@8 (little-endian)
    if (buf.length >= 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
      const w = buf.readUInt16LE(6);
      const h = buf.readUInt16LE(8);
      if (w > 0 && h > 0) return { w, h };
    }
    // BMP: "BM" → width@18, height@22 (little-endian int32)
    if (buf.length >= 26 && buf[0] === 0x42 && buf[1] === 0x4d) {
      const w = buf.readInt32LE(18);
      const h = Math.abs(buf.readInt32LE(22));
      if (w > 0 && h > 0) return { w, h };
    }
    // JPEG: 0xFFD8 로 시작. SOF0~SOF15 마커(0xC0..0xCF, C4/C8/CC 제외)에서 height@+5, width@+7.
    if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let off = 2;
      while (off + 9 < buf.length) {
        if (buf[off] !== 0xff) {
          off++;
          continue;
        }
        const marker = buf[off + 1];
        // 스탠드얼론 마커(패딩/RSTn) skip
        if (marker === 0xff) {
          off++;
          continue;
        }
        const segLen = buf.readUInt16BE(off + 2);
        const isSOF =
          marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSOF) {
          const h = buf.readUInt16BE(off + 5);
          const w = buf.readUInt16BE(off + 7);
          if (w > 0 && h > 0) return { w, h };
          break;
        }
        if (segLen < 2) break;
        off += 2 + segLen;
      }
    }
  } catch {
    /* 파싱 실패 → 근사로 폴백 */
  }
  return null;
}

// 실패 시 안전 폴백: 절대 throw 하지 않고 null.
export async function readWithClova(base64: string, mimeType: string): Promise<ClovaOcrResult | null> {
  const url = process.env.CLOVA_OCR_INVOKE_URL;
  const secret = process.env.CLOVA_OCR_SECRET_KEY;
  if (!url || !secret) return null;
  if (!base64) return null;

  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-OCR-SECRET": secret },
      body: JSON.stringify({
        version: "V2",
        requestId: crypto.randomUUID(),
        timestamp: Date.now(),
        lang: "ko",
        images: [{ format: mimeToFormat(mimeType), name: "rx", data: base64 }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn("[clova-ocr] HTTP", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const data = (await res.json()) as { images?: { inferResult?: string; message?: string; fields?: ClovaField[] }[] };
    const image = data.images?.[0];
    if (!image || image.inferResult !== "SUCCESS") {
      console.warn("[clova-ocr] inferResult", image?.inferResult, image?.message);
      return null;
    }

    const fields = image.fields ?? [];
    const words: ClovaWord[] = [];
    for (const f of fields) {
      const vs = f.boundingPoly?.vertices;
      if (!vs || vs.length < 3) continue;
      const xs = vs.map((v) => Number(v.x) || 0);
      const ys = vs.map((v) => Number(v.y) || 0);
      const xMin = Math.min(...xs);
      const xMax = Math.max(...xs);
      const yMin = Math.min(...ys);
      const yMax = Math.max(...ys);
      words.push({
        text: String(f.inferText ?? ""),
        confidence: Number(f.inferConfidence) || 0,
        vertices: vs.map((v) => ({ x: Number(v.x) || 0, y: Number(v.y) || 0 })),
        xMin,
        xMax,
        yMin,
        yMax,
        xCenter: (xMin + xMax) / 2,
        yCenter: (yMin + yMax) / 2,
        height: yMax - yMin,
      });
    }
    if (words.length === 0) return null;

    // 이미지 크기: 헤더 파싱 우선, 실패하면 단어 좌표 최대값으로 근사.
    const parsed = readImageSize(Buffer.from(base64, "base64"));
    const imageWidth = parsed?.w || Math.max(1, ...words.map((w) => w.xMax));
    const imageHeight = parsed?.h || Math.max(1, ...words.map((w) => w.yMax));

    return { words, imageWidth, imageHeight, durationMs: Date.now() - t0 };
  } catch (e) {
    console.warn("[clova-ocr] 호출 실패", String(e).slice(0, 200));
    return null;
  } finally {
    clearTimeout(timer);
  }
}
