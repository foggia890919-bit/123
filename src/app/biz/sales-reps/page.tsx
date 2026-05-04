"use client";

import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import { BizLayout } from "@/app/biz/page";
import {
  Search, Loader2, CheckCircle, XCircle, Hash, Users,
  Upload, FileSpreadsheet, X, AlertTriangle, Plus,
  ChevronDown, ChevronUp,
} from "lucide-react";

interface SalesRep {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  approved: boolean;
  salesCode: string | null;
  createdAt: string;
  userClients?: { id: string; clientName: string; bizNumber: string }[];
}

interface BulkRow {
  name: string;
  email: string;
  phone: string;
  password: string;
  bizNumbersText: string; // 콤마/공백 구분
}

interface BulkResult {
  row: number;
  status: "ok" | "error";
  createdNew?: boolean;
  generatedPassword?: string;
  email?: string;
  salesCode?: string;
  mappedClients?: number;
  unmappedBizNumbers?: string[];
  error?: string;
}

const TEMPLATE_HEADER = "이름\t이메일\t휴대폰\t임시비밀번호\t사업자번호(콤마구분)";
const TEMPLATE_EXAMPLE = "김딜러\tdealer1@kmd.com\t010-1111-1111\tabc12345\t2110948285,1234567890";

function parsePastedData(text: string): BulkRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("이름\t") && !l.startsWith("# "));

  return lines.map((line) => {
    // tab 우선, 없으면 콤마 구분 (Excel paste vs CSV paste)
    const cols = line.includes("\t") ? line.split("\t") : line.split(/,(?![^"]*")/);
    const [name = "", email = "", phone = "", password = "", bizNumbersText = ""] = cols.map((c) => c.trim());
    return { name, email, phone, password, bizNumbersText };
  });
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
function normalizeBiz(s: string): string {
  return s.replace(/[^0-9]/g, "");
}
function parseBizNumbers(text: string): string[] {
  return Array.from(
    new Set(
      text.split(/[,\s/;]+/)
        .map(normalizeBiz)
        .filter((b) => b.length >= 9 && b.length <= 12)
    )
  );
}

export default function SalesRepsPage() {
  const [reps, setReps] = useState<SalesRep[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [generating, setGenerating] = useState<string | null>(null);
  const [expandedRepId, setExpandedRepId] = useState<string | null>(null);

  // 대량등록 모달 상태
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkResults, setBulkResults] = useState<BulkResult[] | null>(null);

  const load = useCallback(async (q = "") => {
    setLoading(true);
    const res = await fetch(`/api/sales-reps?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setReps(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const t = setTimeout(() => load(search), 300);
    return () => clearTimeout(t);
  }, [search, load]);

  async function toggleApproved(rep: SalesRep) {
    const res = await fetch("/api/sales-reps", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: rep.id, approved: !rep.approved }),
    });
    if (res.ok) {
      const updated = await res.json();
      setReps((p) => p.map((r) => r.id === rep.id ? { ...r, approved: updated.approved } : r));
    }
  }

  async function generateCode(rep: SalesRep) {
    setGenerating(rep.id);
    try {
      const res = await fetch("/api/generate-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "sales", id: rep.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setReps((p) => p.map((r) => r.id === rep.id ? { ...r, salesCode: data.code } : r));
      } else {
        if (data.code) setReps((p) => p.map((r) => r.id === rep.id ? { ...r, salesCode: data.code } : r));
        else alert(data.error ?? "코드 생성 실패");
      }
    } finally {
      setGenerating(null);
    }
  }

  // ============ 대량등록 ============
  const parsedRows = useMemo(() => parsePastedData(bulkText), [bulkText]);
  const validation = useMemo(() => {
    const seenEmails = new Set<string>();
    return parsedRows.map((r) => {
      const issues: string[] = [];
      if (!r.name) issues.push("이름");
      if (!r.email) issues.push("이메일");
      else if (!isValidEmail(r.email)) issues.push("이메일 형식");
      else if (seenEmails.has(r.email.toLowerCase())) issues.push("입력 내 이메일 중복");
      if (r.email) seenEmails.add(r.email.toLowerCase());
      // 비밀번호: 비워두면 자동생성 (issue X), 적었으면 4자 이상
      if (r.password && r.password.length < 4) issues.push("비밀번호 4자↑");
      const biz = parseBizNumbers(r.bizNumbersText);
      return { row: r, issues, bizNumbers: biz };
    });
  }, [parsedRows]);
  const okCount = validation.filter((v) => v.issues.length === 0).length;

  function openBulk() {
    setBulkText("");
    setBulkResults(null);
    setBulkOpen(true);
  }

  function copyTemplate() {
    const text = `${TEMPLATE_HEADER}\n${TEMPLATE_EXAMPLE}`;
    navigator.clipboard.writeText(text);
    alert("양식이 클립보드에 복사되었습니다. 엑셀에 붙여넣으세요.");
  }

  async function submitBulk() {
    const okRows = validation
      .filter((v) => v.issues.length === 0)
      .map((v) => ({
        name: v.row.name,
        email: v.row.email,
        phone: v.row.phone || undefined,
        password: v.row.password,
        bizNumbers: v.bizNumbers,
      }));
    if (okRows.length === 0) { alert("유효한 행이 없습니다."); return; }
    if (!confirm(`${okRows.length}명을 일괄 등록합니다. 진행할까요?`)) return;

    setBulkSubmitting(true);
    try {
      const res = await fetch("/api/sales-reps/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: okRows }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "등록 실패"); return; }
      setBulkResults(data.results);
      await load();
    } finally {
      setBulkSubmitting(false);
    }
  }

  return (
    <BizLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">영업사원 관리</h1>
            <p className="text-sm text-gray-500 mt-0.5">영업사원 승인 및 코드 관리</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={openBulk}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg"
            >
              <Upload className="w-4 h-4" /> 대량등록
            </button>
            <div className="flex items-center gap-1.5 text-xs text-gray-500 bg-gray-100 px-3 py-1.5 rounded-full">
              <Users className="w-3.5 h-3.5" />
              총 {reps.length}명
            </div>
          </div>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름, 이메일, 코드 검색"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : reps.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">
              {search ? "검색 결과가 없어요." : "등록된 영업사원이 없어요."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <Th>이름</Th>
                    <Th>이메일</Th>
                    <Th>연락처</Th>
                    <Th>영업사원 코드</Th>
                    <Th>담당 거래처</Th>
                    <Th>승인</Th>
                    <Th>가입일</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {reps.map((rep) => {
                    const isExpanded = expandedRepId === rep.id;
                    const clientCount = rep.userClients?.length ?? 0;
                    return (
                    <Fragment key={rep.id}>
                    <tr className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">{rep.name ?? "-"}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{rep.email}</td>
                      <td className="px-4 py-3 text-gray-600">{rep.phone ?? "-"}</td>
                      <td className="px-4 py-3">
                        {rep.salesCode ? (
                          <span className="inline-flex items-center gap-1 text-xs font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                            <Hash className="w-3 h-3" />{rep.salesCode}
                          </span>
                        ) : (
                          <button
                            onClick={() => generateCode(rep)}
                            disabled={generating === rep.id}
                            className="flex items-center gap-1 text-xs px-2.5 py-1 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                          >
                            {generating === rep.id
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Hash className="w-3 h-3" />}
                            코드 생성
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setExpandedRepId(isExpanded ? null : rep.id)}
                          disabled={clientCount === 0}
                          className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg transition-colors ${
                            clientCount > 0
                              ? "bg-amber-50 text-amber-700 hover:bg-amber-100"
                              : "bg-gray-50 text-gray-400 cursor-default"
                          }`}
                        >
                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          {clientCount}곳
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleApproved(rep)}
                          className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${
                            rep.approved
                              ? "bg-green-50 text-green-700 hover:bg-green-100"
                              : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                          }`}
                        >
                          {rep.approved
                            ? <><CheckCircle className="w-3 h-3" />승인</>
                            : <><XCircle className="w-3 h-3" />미승인</>}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">
                        {new Date(rep.createdAt).toLocaleDateString("ko-KR")}
                      </td>
                    </tr>
                    {isExpanded && clientCount > 0 && (
                      <tr className="bg-amber-50/40">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="text-xs font-semibold text-amber-800 mb-1.5">
                            담당 거래처 ({clientCount}곳)
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1.5">
                            {rep.userClients!.map((c) => (
                              <div key={c.id} className="bg-white border border-amber-200 rounded px-2 py-1 text-xs">
                                <div className="font-medium text-gray-900 truncate">{c.clientName}</div>
                                <div className="text-gray-400 font-mono text-[11px]">{c.bizNumber}</div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ===== 대량등록 모달 ===== */}
      {bulkOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setBulkOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white z-10">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Upload className="w-5 h-5 text-amber-600" /> 영업사원 대량 등록
              </h2>
              <button onClick={() => setBulkOpen(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>

            {bulkResults ? (
              // ===== 결과 화면 =====
              <div className="p-6 space-y-4">
                <div className="bg-gray-50 rounded-lg p-4 text-sm">
                  <div className="font-semibold mb-1">등록 결과</div>
                  <div className="text-gray-600">
                    총 {bulkResults.length}명 중{" "}
                    <span className="text-green-700 font-semibold">
                      {bulkResults.filter(r => r.status === "ok" && r.createdNew).length}명 신규
                    </span>{" / "}
                    <span className="text-blue-700 font-semibold">
                      {bulkResults.filter(r => r.status === "ok" && !r.createdNew).length}명 매핑추가
                    </span>{" / "}
                    <span className="text-red-700 font-semibold">
                      {bulkResults.filter(r => r.status === "error").length}명 실패
                    </span>
                  </div>
                </div>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-gray-500">#</th>
                        <th className="px-3 py-2 text-left text-gray-500">이메일</th>
                        <th className="px-3 py-2 text-left text-gray-500">결과</th>
                        <th className="px-3 py-2 text-left text-gray-500">상세</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {bulkResults.map((r) => (
                        <tr key={r.row}>
                          <td className="px-3 py-2 text-gray-400">{r.row + 1}</td>
                          <td className="px-3 py-2 font-mono">{r.email}</td>
                          <td className="px-3 py-2">
                            {r.status === "ok"
                              ? r.createdNew
                                ? <span className="text-green-700">✨ 신규</span>
                                : <span className="text-blue-700">🔗 매핑추가</span>
                              : <span className="text-red-700">❌ {r.error}</span>}
                          </td>
                          <td className="px-3 py-2 text-gray-600">
                            {r.status === "ok" && (
                              <div className="space-y-0.5">
                                <div>
                                  {r.salesCode} · 거래처 {r.mappedClients}개 매핑
                                </div>
                                {r.generatedPassword && (
                                  <div className="text-amber-700 font-medium">
                                    🔑 자동생성 PW: <code className="bg-amber-50 px-1.5 py-0.5 rounded font-mono">{r.generatedPassword}</code>
                                    <span className="text-gray-400 ml-1 text-[10px]">(영업사원에게 전달)</span>
                                  </div>
                                )}
                                {r.unmappedBizNumbers && r.unmappedBizNumbers.length > 0 && (
                                  <div className="text-amber-600">
                                    ⚠ 미등록 거래처: {r.unmappedBizNumbers.join(", ")}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => { setBulkResults(null); setBulkText(""); }}
                    className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
                    또 등록하기
                  </button>
                  <button onClick={() => setBulkOpen(false)}
                    className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
                    닫기
                  </button>
                </div>
              </div>
            ) : (
              // ===== 입력/미리보기 화면 =====
              <div className="p-6 space-y-5">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900 space-y-1">
                  <div className="font-semibold">📋 양식 (탭 또는 콤마 구분)</div>
                  <div>이름 / 이메일 / 휴대폰 / <b>임시비밀번호 (비워두면 자동생성)</b> / 사업자번호(콤마 구분)</div>
                  <button onClick={copyTemplate} className="mt-1 inline-flex items-center gap-1 px-2 py-1 bg-white border border-blue-300 rounded text-blue-700 hover:bg-blue-50">
                    <FileSpreadsheet className="w-3.5 h-3.5" /> 양식 클립보드 복사
                  </button>
                  <div className="text-[11px] text-blue-700 mt-1 space-y-0.5">
                    <div>💡 엑셀에서 작성 후 행 통째로 복사 → 아래 칸에 붙여넣으세요. 첫 헤더 행은 자동 무시.</div>
                    <div>💡 <b>이미 가입된 이메일</b>은 신규 생성 X — 거래처 매핑만 추가됩니다 (비밀번호·이름은 기존 유지).</div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">데이터 입력</label>
                  <textarea
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    placeholder="김딜러	dealer1@kmd.com	010-1111-1111	abc12345	2110948285,1234567890&#10;박딜러	dealer2@kmd.com	010-2222-2222	xyz67890	3214567890"
                    rows={8}
                    className="w-full px-3 py-2 text-sm font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 resize-y"
                  />
                </div>

                {parsedRows.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-semibold text-gray-700">미리보기 ({parsedRows.length}행)</label>
                      <span className="text-xs">
                        <span className="text-green-700 font-semibold">{okCount}명</span>
                        <span className="text-gray-400"> / {parsedRows.length}명 등록 가능</span>
                      </span>
                    </div>
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <table className="min-w-full text-xs">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="px-2 py-2 text-left text-gray-500 w-8">#</th>
                            <th className="px-2 py-2 text-left text-gray-500">이름</th>
                            <th className="px-2 py-2 text-left text-gray-500">이메일</th>
                            <th className="px-2 py-2 text-left text-gray-500">휴대폰</th>
                            <th className="px-2 py-2 text-left text-gray-500">PW</th>
                            <th className="px-2 py-2 text-left text-gray-500">거래처</th>
                            <th className="px-2 py-2 text-left text-gray-500">상태</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {validation.map((v, i) => (
                            <tr key={i} className={v.issues.length === 0 ? "" : "bg-red-50"}>
                              <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                              <td className="px-2 py-1.5">{v.row.name || "—"}</td>
                              <td className="px-2 py-1.5 font-mono">{v.row.email || "—"}</td>
                              <td className="px-2 py-1.5">{v.row.phone || "—"}</td>
                              <td className="px-2 py-1.5">{v.row.password ? "•".repeat(Math.min(v.row.password.length, 8)) : "—"}</td>
                              <td className="px-2 py-1.5">{v.bizNumbers.length}개 ({v.bizNumbers.join(", ") || "없음"})</td>
                              <td className="px-2 py-1.5">
                                {v.issues.length === 0
                                  ? <span className="text-green-700 inline-flex items-center gap-1"><CheckCircle className="w-3 h-3" /> OK</span>
                                  : <span className="text-red-700 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {v.issues.join(", ")}</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!bulkResults && (
              <div className="flex justify-end gap-2 px-6 pb-5 sticky bottom-0 bg-white border-t pt-4">
                <button onClick={() => setBulkOpen(false)}
                  className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
                  취소
                </button>
                <button
                  onClick={submitBulk}
                  disabled={okCount === 0 || bulkSubmitting}
                  className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg disabled:opacity-40"
                >
                  {bulkSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  <Plus className="w-4 h-4" /> {okCount}명 일괄 생성
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </BizLayout>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">{children}</th>;
}
