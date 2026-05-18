"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as XLSX from "xlsx";
import { Loader2, FileSpreadsheet, ArrowRight, RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BizLayout } from "../../page";

// ─── 우리 양식 — 정산내역서 12개 표준 컬럼 (기존 /biz/settlement/upload 와 동일) ───
const CANONICAL_COLS = [
  "사업자등록번호", "담당자명", "병의원명", "제약사명",
  "품목명", "보험코드", "약가", "수량",
  "매출금액", "정산서요율(%)", "처방월", "비고",
] as const;
type CanonicalCol = typeof CANONICAL_COLS[number];

// 자동 감지용 — 표준 컬럼명과 매칭되는 원본 컬럼명 후보 (공백/대소문자 무시).
const AUTO_HINTS: Record<CanonicalCol, string[]> = {
  "사업자등록번호": ["사업자등록번호", "사업자번호", "biznumber", "businessnumber"],
  "담당자명":       ["담당자명", "담당자", "manager"],
  "병의원명":       ["병의원명", "병원명", "거래처명", "hospitalname"],
  "제약사명":       ["제약사명", "제약사", "공급사", "company"],
  "품목명":         ["품목명", "상품명", "제품명", "itemname"],
  "보험코드":       ["보험코드", "주성분코드", "insurancecode"],
  "약가":           ["약가", "단가", "price"],
  "수량":           ["수량", "qty", "quantity"],
  "매출금액":       ["매출금액", "공급가액", "금액", "amount", "total"],
  "정산서요율(%)":  ["정산서요율(%)", "정산서요율", "요율", "rate"],
  "처방월":         ["처방월", "처방년월", "월", "yearmonth"],
  "비고":           ["비고", "메모", "note", "remark"],
};

const norm = (s: string) => String(s ?? "").replace(/\s+/g, "").toLowerCase();

interface Dealer {
  id: string;
  clientName: string;
  bizNumber: string;
  dealerType: string | null;
  isSettlementTarget: boolean;
}

interface Template {
  id: string;
  corpName: string;
  columnMap: Record<string, string>; // { 원본컬럼명: 표준컬럼명 }
}

// ─── helpers ──────────────────────────────────────────────────────────────
function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function readWorkbook(buf: ArrayBuffer): { headers: string[]; rows: Record<string, string>[] } {
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { headers: [], rows: [] };
  const json = XLSX.utils.sheet_to_json<Record<string, string | number>>(ws, { defval: "" });
  if (json.length === 0) return { headers: [], rows: [] };
  const headers = Object.keys(json[0]);
  const rows = json.map((r) => {
    const out: Record<string, string> = {};
    for (const k of headers) out[k] = String(r[k] ?? "").trim();
    return out;
  });
  return { headers, rows };
}

// 원본 헤더 배열에서 표준 컬럼별 매칭되는 원본 컬럼명 자동 감지
function autoDetect(headers: string[]): Record<CanonicalCol, string | null> {
  const headerByNorm = new Map<string, string>();
  for (const h of headers) headerByNorm.set(norm(h), h);
  const out = {} as Record<CanonicalCol, string | null>;
  for (const canon of CANONICAL_COLS) {
    out[canon] = null;
    for (const hint of AUTO_HINTS[canon]) {
      const hit = headerByNorm.get(norm(hint));
      if (hit) { out[canon] = hit; break; }
    }
  }
  return out;
}

// SettlementTemplate.columnMap ({원본:표준}) → 표준→원본 역매핑
function invertTemplateMap(m: Record<string, string>): Record<CanonicalCol, string | null> {
  const out = {} as Record<CanonicalCol, string | null>;
  for (const canon of CANONICAL_COLS) out[canon] = null;
  for (const [src, canon] of Object.entries(m)) {
    if (CANONICAL_COLS.includes(canon as CanonicalCol)) {
      out[canon as CanonicalCol] = src;
    }
  }
  return out;
}

function toNumber(s: string): number {
  if (!s) return 0;
  const n = Number(String(s).replace(/[, ₩원%]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

interface ConvertedRow {
  cells: Record<CanonicalCol, string>;
  amount: number;
  qty: number;
}

function applyMapping(
  raw: Record<string, string>[],
  mapping: Record<CanonicalCol, string | null>
): ConvertedRow[] {
  return raw
    .map((r) => {
      const cells = {} as Record<CanonicalCol, string>;
      for (const canon of CANONICAL_COLS) {
        const src = mapping[canon];
        cells[canon] = src ? String(r[src] ?? "").trim() : "";
      }
      return {
        cells,
        amount: toNumber(cells["매출금액"]),
        qty: toNumber(cells["수량"]),
      };
    })
    .filter((row) => row.cells["품목명"] || row.cells["사업자등록번호"] || row.cells["병의원명"]);
}

// ─── diff ──────────────────────────────────────────────────────────────────
type DiffStatus = "NEW" | "REMOVED" | "CHANGED" | "UNCHANGED";
const DIFF_FIELDS: CanonicalCol[] = ["약가", "수량", "매출금액", "정산서요율(%)", "처방월", "담당자명", "비고"];

interface DiffRow {
  key: string;
  label: string;
  status: DiffStatus;
  base?: ConvertedRow;
  updated?: ConvertedRow;
  changes?: { field: CanonicalCol; from: string; to: string }[];
}

function keyOf(r: ConvertedRow): string {
  // 사업자등록번호 + 보험코드 + 품목명. 빈 부분은 무시.
  return [r.cells["사업자등록번호"], r.cells["보험코드"], r.cells["품목명"]]
    .filter((x) => x)
    .join("|");
}

function labelOf(r: ConvertedRow): string {
  return [r.cells["병의원명"], r.cells["품목명"]].filter((x) => x).join(" · ") || "(이름 없음)";
}

function diffRows(base: ConvertedRow[], updated: ConvertedRow[]): DiffRow[] {
  const baseMap = new Map<string, ConvertedRow>();
  for (const r of base) { const k = keyOf(r); if (k) baseMap.set(k, r); }
  const updatedMap = new Map<string, ConvertedRow>();
  for (const r of updated) { const k = keyOf(r); if (k) updatedMap.set(k, r); }

  const keys = new Set<string>([...baseMap.keys(), ...updatedMap.keys()]);
  const out: DiffRow[] = [];
  for (const k of keys) {
    const b = baseMap.get(k);
    const u = updatedMap.get(k);
    if (b && !u) { out.push({ key: k, label: labelOf(b), status: "REMOVED", base: b }); continue; }
    if (!b && u) { out.push({ key: k, label: labelOf(u), status: "NEW", updated: u }); continue; }
    if (b && u) {
      const changes: DiffRow["changes"] = [];
      for (const f of DIFF_FIELDS) {
        if (b.cells[f] !== u.cells[f]) changes.push({ field: f, from: b.cells[f], to: u.cells[f] });
      }
      out.push({ key: k, label: labelOf(u), status: changes.length ? "CHANGED" : "UNCHANGED", base: b, updated: u, changes });
    }
  }
  const order: Record<DiffStatus, number> = { CHANGED: 0, NEW: 1, REMOVED: 2, UNCHANGED: 3 };
  out.sort((a, b) => order[a.status] - order[b.status] || a.label.localeCompare(b.label));
  return out;
}

const won = (n: number) => n.toLocaleString("ko-KR");

// ─── component ─────────────────────────────────────────────────────────────
export default function SettlementConvertPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  const [corpName, setCorpName] = useState<string>("");
  const [yearMonth, setYearMonth] = useState<string>(currentYearMonth());

  // 업로드된 정산서 (변환 대상)
  const [updName, setUpdName] = useState("");
  const [updHeaders, setUpdHeaders] = useState<string[]>([]);
  const [updRaw, setUpdRaw] = useState<Record<string, string>[]>([]);
  const [updMapping, setUpdMapping] = useState<Record<CanonicalCol, string | null> | null>(null);

  // 기준 내역서 (우리 양식 — 표준 컬럼 그대로라고 가정, 다르면 자동감지)
  const [baseName, setBaseName] = useState("");
  const [baseHeaders, setBaseHeaders] = useState<string[]>([]);
  const [baseRaw, setBaseRaw] = useState<Record<string, string>[]>([]);
  const [baseMapping, setBaseMapping] = useState<Record<CanonicalCol, string | null> | null>(null);

  const [dropUpd, setDropUpd] = useState(false);
  const [dropBase, setDropBase] = useState(false);
  const [err, setErr] = useState("");

  const updRef = useRef<HTMLInputElement>(null);
  const baseRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) { router.push("/login"); return; }
    const role = session.user.role;
    if (role !== "BIZ" && role !== "ADMIN") { router.push("/"); return; }
    Promise.all([
      fetch("/api/dealer?isSettlementTarget=true").then((r) => r.json()),
      fetch("/api/settlement/templates").then((r) => r.json()),
    ])
      .then(([d, t]) => {
        setDealers(Array.isArray(d) ? d : []);
        setTemplates(Array.isArray(t) ? t : []);
      })
      .finally(() => setLoading(false));
  }, [session, status, router]);

  const templateByCorp = useMemo(() => {
    const m: Record<string, Template> = {};
    for (const t of templates) m[t.corpName] = t;
    return m;
  }, [templates]);

  // corpName 또는 업로드 헤더가 바뀌면 매핑 재계산: 템플릿 우선, 없으면 자동감지
  useEffect(() => {
    if (updHeaders.length === 0) return;
    const tmpl = corpName ? templateByCorp[corpName] : null;
    const mapping = tmpl ? invertTemplateMap(tmpl.columnMap) : autoDetect(updHeaders);
    setUpdMapping(mapping);
  }, [corpName, updHeaders, templateByCorp]);

  async function handleFile(f: File, target: "upd" | "base") {
    setErr("");
    try {
      const buf = await f.arrayBuffer();
      const { headers, rows } = readWorkbook(buf);
      if (headers.length === 0) { setErr("빈 파일이거나 시트를 읽을 수 없습니다."); return; }
      if (target === "upd") {
        setUpdName(f.name);
        setUpdHeaders(headers);
        setUpdRaw(rows);
      } else {
        setBaseName(f.name);
        setBaseHeaders(headers);
        setBaseRaw(rows);
        setBaseMapping(autoDetect(headers));
      }
    } catch (e) {
      setErr(`파일 읽기 실패: ${(e as Error).message}`);
    }
  }

  function onDrop(e: React.DragEvent, target: "upd" | "base") {
    e.preventDefault();
    if (target === "upd") setDropUpd(false); else setDropBase(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f, target);
  }

  const updatedRows = useMemo(
    () => (updMapping ? applyMapping(updRaw, updMapping) : []),
    [updRaw, updMapping]
  );
  const baseRows = useMemo(
    () => (baseMapping ? applyMapping(baseRaw, baseMapping) : []),
    [baseRaw, baseMapping]
  );
  const diff = useMemo(() => diffRows(baseRows, updatedRows), [baseRows, updatedRows]);

  const counts = useMemo(() => {
    const c = { NEW: 0, REMOVED: 0, CHANGED: 0, UNCHANGED: 0 };
    for (const d of diff) c[d.status]++;
    return c;
  }, [diff]);

  const updTotals = useMemo(() => {
    let amount = 0, qty = 0;
    for (const r of updatedRows) { amount += r.amount; qty += r.qty; }
    return { amount, qty, rows: updatedRows.length };
  }, [updatedRows]);

  const hasTemplate = !!(corpName && templateByCorp[corpName]);
  const mappingMissing = updRaw.length > 0 && updMapping &&
    CANONICAL_COLS.every((c) => !updMapping[c]);

  const refresh = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/dealer?isSettlementTarget=true").then((r) => r.json()),
      fetch("/api/settlement/templates").then((r) => r.json()),
    ])
      .then(([d, t]) => {
        setDealers(Array.isArray(d) ? d : []);
        setTemplates(Array.isArray(t) ? t : []);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <BizLayout>
        <div className="flex justify-center py-20">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      </BizLayout>
    );
  }

  return (
    <BizLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">정산내역서 변환</h1>
            <p className="text-sm text-gray-500 mt-1">
              상위법인이 보낸 정산서를 우리 양식으로 변환하고, 기준 내역서와 비교합니다.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> 새로고침
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
          {/* ─── 좌측: 입력 + 변환 결과 ─── */}
          <div className="space-y-4">
            {/* 입력 박스 */}
            <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-semibold text-gray-600">상위법인</span>
                  <select
                    value={corpName}
                    onChange={(e) => setCorpName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white"
                  >
                    <option value="">상위법인을 선택하세요</option>
                    {dealers.map((d) => (
                      <option key={d.id} value={d.clientName}>
                        {d.clientName}{d.dealerType === "UPPER_CORP" ? " (상위법인)" : ""}
                      </option>
                    ))}
                  </select>
                  {dealers.length === 0 && (
                    <span className="text-xs text-amber-700 mt-1 block">
                      정산 대상으로 등록된 거래처가 없습니다. <Link href="/biz/dealers" className="underline">거래처 관리</Link>에서 isSettlementTarget을 켜세요.
                    </span>
                  )}
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-gray-600">대상월</span>
                  <input
                    type="month"
                    value={yearMonth}
                    onChange={(e) => setYearMonth(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white"
                  />
                </label>
              </div>

              {/* 드롭존 */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDropUpd(true); }}
                onDragLeave={() => setDropUpd(false)}
                onDrop={(e) => onDrop(e, "upd")}
                onClick={() => updRef.current?.click()}
                className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center text-sm transition ${
                  dropUpd ? "border-blue-500 bg-blue-50" : "border-gray-300 bg-gray-50 hover:bg-gray-100"
                }`}
              >
                <FileSpreadsheet className="w-6 h-6 mx-auto text-gray-400" />
                <div className="text-base font-medium mt-1">정산서를 여기에 드롭하세요</div>
                <div className="text-xs text-gray-500 mt-0.5">.xlsx, .xls 지원 · 클릭해서 선택할 수도 있습니다</div>
                {updName && (
                  <div className="text-xs text-blue-700 mt-2">선택됨: <b>{updName}</b> · {updRaw.length}행</div>
                )}
                <input
                  ref={updRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f, "upd");
                    e.target.value = "";
                  }}
                />
              </div>

              {/* 상태 표시 */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  {corpName && (
                    <span className="px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-700">{corpName}</span>
                  )}
                  {corpName && (
                    hasTemplate
                      ? <span className="px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">매핑 완료</span>
                      : <span className="px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700">매핑 없음 (자동감지 사용)</span>
                  )}
                </div>
                {corpName && !hasTemplate && (
                  <Link href="/biz/settlement/upload" className="text-blue-600 hover:underline">
                    매핑 등록하러 가기 →
                  </Link>
                )}
              </div>

              {err && (
                <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{err}</span>
                </div>
              )}
            </section>

            {/* 변환 결과 — 우리 양식 */}
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                  <ArrowRight className="w-4 h-4 text-blue-500" />
                  변환 결과 (우리 양식)
                </h2>
                {updatedRows.length > 0 && (
                  <div className="text-xs text-gray-500 flex gap-3">
                    <span>{updTotals.rows}행</span>
                    <span>수량 {won(updTotals.qty)}</span>
                    <span>매출 {won(updTotals.amount)}원</span>
                  </div>
                )}
              </div>

              {mappingMissing && (
                <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mb-2">
                  매칭되는 컬럼을 찾지 못했습니다. 상위법인을 선택하거나 <Link href="/biz/settlement/upload" className="underline">컬럼 매핑</Link>을 등록하세요.
                </div>
              )}

              {updatedRows.length === 0 ? (
                <div className="text-sm text-gray-500 py-10 text-center border border-dashed border-gray-200 rounded-lg">
                  정산서를 업로드하면 변환 결과가 표시됩니다.
                </div>
              ) : (
                <>
                  {updMapping && (
                    <MappingPanel headers={updHeaders} mapping={updMapping} onChange={(f, h) => setUpdMapping({ ...updMapping, [f]: h })} />
                  )}
                  <div className="overflow-x-auto mt-2 max-h-[520px] overflow-y-auto border border-gray-100 rounded">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-gray-600 sticky top-0">
                        <tr>
                          {CANONICAL_COLS.map((c) => (
                            <th key={c} className="px-2 py-1.5 text-left whitespace-nowrap font-semibold">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {updatedRows.slice(0, 300).map((r, i) => (
                          <tr key={i} className="border-t border-gray-100">
                            {CANONICAL_COLS.map((c) => (
                              <td key={c} className="px-2 py-1 whitespace-nowrap text-gray-800">{r.cells[c]}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {updatedRows.length > 300 && (
                      <div className="text-xs text-gray-500 px-2 py-1 border-t bg-gray-50">… 처음 300행만 표시 (총 {updatedRows.length}행)</div>
                    )}
                  </div>
                </>
              )}
            </section>
          </div>

          {/* ─── 우측: 기준 vs 업데이트 diff ─── */}
          <aside className="space-y-4">
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="font-semibold text-gray-900 mb-2">업데이트 현황</h2>
              <div className="grid grid-cols-2 gap-2">
                <DiffBadge label="변경" value={counts.CHANGED} tone="amber" />
                <DiffBadge label="신규" value={counts.NEW} tone="emerald" />
                <DiffBadge label="삭제" value={counts.REMOVED} tone="red" />
                <DiffBadge label="동일" value={counts.UNCHANGED} tone="gray" />
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-2">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">기준 내역서 (우리)</h3>
                <p className="text-xs text-gray-500">우리 양식 파일을 드롭하면 자동으로 비교됩니다.</p>
              </div>
              <div
                onDragOver={(e) => { e.preventDefault(); setDropBase(true); }}
                onDragLeave={() => setDropBase(false)}
                onDrop={(e) => onDrop(e, "base")}
                onClick={() => baseRef.current?.click()}
                className={`cursor-pointer rounded-lg border-2 border-dashed p-3 text-center text-xs transition ${
                  dropBase ? "border-blue-500 bg-blue-50" : "border-gray-300 bg-gray-50 hover:bg-gray-100"
                }`}
              >
                {baseName ? (
                  <span className="text-blue-700"><b>{baseName}</b> · {baseRaw.length}행</span>
                ) : (
                  <span className="text-gray-500">기준 파일 드롭 또는 클릭</span>
                )}
                <input
                  ref={baseRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f, "base");
                    e.target.value = "";
                  }}
                />
              </div>
              {baseHeaders.length > 0 && baseMapping && (
                <MappingPanel headers={baseHeaders} mapping={baseMapping} onChange={(f, h) => setBaseMapping({ ...baseMapping, [f]: h })} compact />
              )}
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">변동 상세</h3>
              {diff.length === 0 ? (
                <div className="text-xs text-gray-500 py-6 text-center">
                  기준 내역서와 업로드 파일을 모두 올리면 변동 상세가 표시됩니다.
                </div>
              ) : (
                <ul className="space-y-1.5 max-h-[440px] overflow-y-auto">
                  {diff.filter((d) => d.status !== "UNCHANGED").slice(0, 200).map((d) => (
                    <DiffItem key={d.key} d={d} />
                  ))}
                  {diff.filter((d) => d.status !== "UNCHANGED").length === 0 && (
                    <li className="text-xs text-gray-500 py-2 text-center">변동 없음 — 모든 행이 동일합니다.</li>
                  )}
                </ul>
              )}
            </section>
          </aside>
        </div>
      </div>
    </BizLayout>
  );
}

function MappingPanel({
  headers,
  mapping,
  onChange,
  compact = false,
}: {
  headers: string[];
  mapping: Record<CanonicalCol, string | null>;
  onChange: (field: CanonicalCol, header: string | null) => void;
  compact?: boolean;
}) {
  return (
    <details className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5">
      <summary className="text-xs text-gray-600 cursor-pointer select-none">
        컬럼 매핑 — 자동 감지됨 (클릭해서 수정)
      </summary>
      <div className={`grid ${compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-3"} gap-2 mt-2`}>
        {CANONICAL_COLS.map((f) => (
          <label key={f} className="text-[11px]">
            <span className="text-gray-500">{f}</span>
            <select
              value={mapping[f] ?? ""}
              onChange={(e) => onChange(f, e.target.value || null)}
              className="mt-0.5 w-full rounded border border-gray-200 px-1.5 py-1 bg-white text-xs"
            >
              <option value="">(없음)</option>
              {headers.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
        ))}
      </div>
    </details>
  );
}

function DiffBadge({ label, value, tone }: { label: string; value: number; tone: "amber" | "emerald" | "red" | "gray" }) {
  const cls = {
    amber:   "bg-amber-50 border-amber-200 text-amber-900",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-900",
    red:     "bg-red-50 border-red-200 text-red-900",
    gray:    "bg-gray-50 border-gray-200 text-gray-700",
  }[tone];
  return (
    <div className={`rounded-lg px-2 py-1.5 border ${cls}`}>
      <div className="text-[10px]">{label}</div>
      <div className="text-lg font-semibold leading-tight">{value}</div>
    </div>
  );
}

function DiffItem({ d }: { d: DiffRow }) {
  const tone = d.status === "NEW" ? "border-emerald-200 bg-emerald-50"
    : d.status === "REMOVED" ? "border-red-200 bg-red-50"
    : d.status === "CHANGED" ? "border-amber-200 bg-amber-50"
    : "border-gray-200 bg-gray-50";
  const label = d.status === "NEW" ? "신규" : d.status === "REMOVED" ? "삭제" : d.status === "CHANGED" ? "변경" : "동일";
  return (
    <li className={`rounded border px-2 py-1.5 text-xs ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium truncate text-[11px]" title={d.label}>{d.label}</div>
        <span className="text-[10px] font-semibold shrink-0">{label}</span>
      </div>
      {d.changes && d.changes.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {d.changes.map((c) => (
            <li key={c.field} className="text-[11px]">
              <span className="text-gray-500">{c.field}:</span> {c.from || "(빈값)"} → <b>{c.to || "(빈값)"}</b>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
