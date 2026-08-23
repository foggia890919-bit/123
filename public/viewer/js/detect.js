// 파일 형식 감지 — 확장자는 힌트, 매직 바이트가 우선.
// (안드로이드 공유로 들어온 파일은 이름 없는 blob 인 경우가 많다)
import { loadScript } from "./util.js";

const EXT_MAP = {
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  xlsm: "xlsx",
  csv: "csv",
  pptx: "pptx",
  hwp: "hwp",
  hwpx: "hwpx",
  txt: "txt",
  log: "txt",
  md: "md",
  markdown: "md",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  svg: "image",
};

const LEGACY_EXTS = new Set(["doc", "xls", "ppt"]);

function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || "");
  return m ? m[1].toLowerCase() : "";
}

function bytesStartWith(bytes, sig, offset = 0) {
  return sig.every((b, i) => bytes[offset + i] === b);
}

function findAscii(bytes, text) {
  const target = [...text].map((c) => c.charCodeAt(0));
  outer: for (let i = 0; i <= bytes.length - target.length; i++) {
    for (let j = 0; j < target.length; j++) {
      if (bytes[i + j] !== target[j]) continue outer;
    }
    return true;
  }
  return false;
}

async function detectZip(file, ext) {
  await loadScript("lib/jszip.min.js");
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    return null;
  }
  const names = Object.keys(zip.files);
  const has = (n) => names.includes(n);
  if (has("word/document.xml")) return "docx";
  if (has("xl/workbook.xml")) return "xlsx";
  if (has("ppt/presentation.xml")) return "pptx";
  if (has("Contents/content.hpf") || names.some((n) => n.startsWith("Contents/section"))) return "hwpx";
  if (has("mimetype")) {
    const mime = await zip.file("mimetype").async("string");
    if (mime.includes("hwp")) return "hwpx";
  }
  return EXT_MAP[ext] || null;
}

/**
 * @returns {Promise<{format: string}|{error: string}>}
 */
export async function detectFormat(file) {
  const ext = extOf(file.name);
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());

  // PDF
  if (bytesStartWith(head, [0x25, 0x50, 0x44, 0x46])) return { format: "pdf" };

  // ZIP 컨테이너 (docx/xlsx/pptx/hwpx)
  if (bytesStartWith(head, [0x50, 0x4b, 0x03, 0x04]) || bytesStartWith(head, [0x50, 0x4b, 0x05, 0x06])) {
    const fmt = await detectZip(file, ext);
    if (fmt) return { format: fmt };
    return { error: "알 수 없는 ZIP 기반 문서입니다." };
  }

  // CFB 컨테이너 (hwp 5.0 / 레거시 doc·xls·ppt)
  if (bytesStartWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (findAscii(bytes, "HWP Document File")) return { format: "hwp" };
    return {
      error:
        "구버전 오피스 형식(doc/xls/ppt)은 지원되지 않습니다. docx/xlsx/pptx 로 변환 후 열어주세요.",
    };
  }

  // 이미지
  if (bytesStartWith(head, [0x89, 0x50, 0x4e, 0x47])) return { format: "image" };
  if (bytesStartWith(head, [0xff, 0xd8, 0xff])) return { format: "image" };
  if (bytesStartWith(head, [0x47, 0x49, 0x46, 0x38])) return { format: "image" };
  if (bytesStartWith(head, [0x42, 0x4d])) return { format: "image" };
  if (
    bytesStartWith(head, [0x52, 0x49, 0x46, 0x46]) &&
    bytesStartWith(head, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return { format: "image" };
  }

  if (LEGACY_EXTS.has(ext)) {
    return {
      error:
        "구버전 오피스 형식(doc/xls/ppt)은 지원되지 않습니다. docx/xlsx/pptx 로 변환 후 열어주세요.",
    };
  }

  // 확장자 힌트 (텍스트 계열·csv·svg 등 매직 없는 형식)
  if (EXT_MAP[ext]) return { format: EXT_MAP[ext] };

  // 텍스트 휴리스틱: UTF-8 시도 후 EUC-KR
  const sample = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  if (sample.length === 0) return { error: "빈 파일입니다." };
  for (const enc of ["utf-8", "euc-kr"]) {
    try {
      const text = new TextDecoder(enc, { fatal: true }).decode(sample);
      const printable = [...text].filter((c) => c >= " " || c === "\n" || c === "\r" || c === "\t");
      if (printable.length / text.length > 0.97) return { format: "txt" };
    } catch {
      /* 다음 인코딩 시도 */
    }
  }

  return { error: "지원하지 않는 파일 형식입니다." };
}

export const FORMAT_LABELS = {
  pdf: "PDF",
  docx: "워드",
  xlsx: "엑셀",
  csv: "CSV",
  pptx: "파워포인트",
  hwp: "한글",
  hwpx: "한글",
  txt: "텍스트",
  md: "마크다운",
  image: "이미지",
};
