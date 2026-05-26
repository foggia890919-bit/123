"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Search, Plus, Loader2, Upload, Download,
  X, AlertCircle, Hash, CheckCircle, Users,
  RefreshCw, KeyRound, CheckCircle2, XCircle,
  FileSpreadsheet, AlertTriangle,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import type { SalesRep, BulkRow, BulkResult } from "./types";
import { TEMPLATE_HEADER, TEMPLATE_EXAMPLE } from "./utils";
import { parsePastedData, isValidEmail, parseBizNumbers } from "./utils";

export default function SalesRepsTab() {
  const [reps, setReps] = useState<SalesRep[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [generating, setGenerating] = useState<string | null>(null);
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
  useEffect(() => { const t = setTimeout(() => load(search), 300); return () => clearTimeout(t); }, [search, load]);

  async function toggleApproved(rep: SalesRep) {
    const res = await fetch("/api/sales-reps", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: rep.id, approved: !rep.approved }),
    });
    if (res.ok) { const updated = await res.json(); setReps((p) => p.map((r) => r.id === rep.id ? { ...r, approved: updated.approved } : r)); }
  }

  async function generateCode(rep: SalesRep) {
    setGenerating(rep.id);
    try {
      const res = await fetch("/api/generate-code", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "sales", id: rep.id }),
      });
      const data = await res.json();
      if (res.ok) setReps((p) => p.map((r) => r.id === rep.id ? { ...r, salesCode: data.code } : r));
      else if (data.code) setReps((p) => p.map((r) => r.id === rep.id ? { ...r, salesCode: data.code } : r));
      else alert(data.error ?? "코드 생성 실패");
    } finally { setGenerating(null); }
  }

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
      if (!r.password) issues.push("비밀번호");
      else if (r.password.length < 4) issues.push("비밀번호 4자↑");
      const biz = parseBizNumbers(r.bizNumbersText);
      return { row: r, issues, bizNumbers: biz };
    });
  }, [parsedRows]);
  const okCount = validation.filter((v) => v.issues.length === 0).length;

  function copyTemplate() {
    navigator.clipboard.writeText(`${TEMPLATE_HEADER}\n${TEMPLATE_EXAMPLE}`);
    alert("양식이 클립보드에 복사되었습니다.");
  }

  async function submitBulk() {
    const okRows = validation.filter((v) => v.issues.length === 0).map((v) => ({
      name: v.row.name, email: v.row.email, phone: v.row.phone || undefined,
      password: v.row.password, bizNumbers: v.bizNumbers,
    }));
    if (okRows.length === 0) { alert("유효한 행이 없습니다."); return; }
    if (!confirm(`${okRows.length}명을 일괄 등록합니다. 진행할까요?`)) return;
    setBulkSubmitting(true);
    try {
      const res = await fetch("/api/sales-reps/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: okRows }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "등록 실패"); return; }
      setBulkResults(data.results); await load();
    } finally { setBulkSubmitting(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="이름, 이메일, 코드 검색"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => { setBulkText(""); setBulkResults(null); setBulkOpen(true); }}
            className="flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg">
            <Upload className="w-4 h-4" />대량등록
          </button>
          <div className="flex items-center gap-1.5 text-xs text-gray-500 bg-gray-100 px-3 py-2 rounded-lg">
            <Users className="w-3.5 h-3.5" />총 {reps.length}명
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
        ) : reps.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">{search ? "검색 결과가 없어요." : "등록된 영업사원이 없어요."}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {["이름", "이메일", "연락처", "영업사원 코드", "승인", "가입일"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {reps.map((rep) => (
                  <tr key={rep.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{rep.name ?? "-"}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{rep.email}</td>
                    <td className="px-4 py-3 text-gray-600">{rep.phone ?? "-"}</td>
                    <td className="px-4 py-3">
                      {rep.salesCode ? (
                        <span className="inline-flex items-center gap-1 text-xs font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                          <Hash className="w-3 h-3" />{rep.salesCode}
                        </span>
                      ) : (
                        <button onClick={() => generateCode(rep)} disabled={generating === rep.id}
                          className="flex items-center gap-1 text-xs px-2.5 py-1 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                          {generating === rep.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Hash className="w-3 h-3" />}코드 생성
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => toggleApproved(rep)}
                        className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${
                          rep.approved ? "bg-green-50 text-green-700 hover:bg-green-100" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                        }`}>
                        {rep.approved ? <><CheckCircle className="w-3 h-3" />승인</> : <><XCircle className="w-3 h-3" />미승인</>}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{new Date(rep.createdAt).toLocaleDateString("ko-KR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {bulkOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setBulkOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white z-10">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Upload className="w-5 h-5 text-amber-600" />영업사원 대량 등록
              </h2>
              <button onClick={() => setBulkOpen(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            {bulkResults ? (
              <div className="p-6 space-y-4">
                <div className="bg-gray-50 rounded-lg p-4 text-sm">
                  <div className="font-semibold mb-1">등록 결과</div>
                  <div className="text-gray-600">
                    총 {bulkResults.length}명 중{" "}
                    <span className="text-green-700 font-semibold">{bulkResults.filter((r) => r.status === "ok" && r.createdNew).length}명 신규</span>{" / "}
                    <span className="text-blue-700 font-semibold">{bulkResults.filter((r) => r.status === "ok" && !r.createdNew).length}명 매핑추가</span>{" / "}
                    <span className="text-red-700 font-semibold">{bulkResults.filter((r) => r.status === "error").length}명 실패</span>
                  </div>
                </div>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        {["#", "이메일", "결과", "상세"].map((h) => (
                          <th key={h} className="px-3 py-2 text-left text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {bulkResults.map((r) => (
                        <tr key={r.row}>
                          <td className="px-3 py-2 text-gray-400">{r.row + 1}</td>
                          <td className="px-3 py-2 font-mono">{r.email}</td>
                          <td className="px-3 py-2">
                            {r.status === "ok" ? (r.createdNew ? <span className="text-green-700">✨ 신규</span> : <span className="text-blue-700">🔗 매핑추가</span>) : <span className="text-red-700">❌ {r.error}</span>}
                          </td>
                          <td className="px-3 py-2 text-gray-600">
                            {r.status === "ok" && (
                              <>
                                {r.salesCode} · 거래처 {r.mappedClients}개 매핑
                                {r.unmappedBizNumbers && r.unmappedBizNumbers.length > 0 && (
                                  <span className="ml-2 text-amber-600">⚠ 미등록: {r.unmappedBizNumbers.join(", ")}</span>
                                )}
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => { setBulkResults(null); setBulkText(""); }}
                    className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">또 등록하기</button>
                  <button onClick={() => setBulkOpen(false)} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg">닫기</button>
                </div>
              </div>
            ) : (
              <div className="p-6 space-y-5">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900 space-y-1">
                  <div className="font-semibold">📋 양식 (탭 또는 콤마 구분)</div>
                  <div>이름 / 이메일 / 휴대폰 / 임시비밀번호 / 사업자번호(콤마 구분으로 여러 개)</div>
                  <button onClick={copyTemplate} className="mt-1 inline-flex items-center gap-1 px-2 py-1 bg-white border border-blue-300 rounded text-blue-700 hover:bg-blue-50">
                    <FileSpreadsheet className="w-3.5 h-3.5" />양식 클립보드 복사
                  </button>
                  <div className="text-[11px] text-blue-700 mt-1 space-y-0.5">
                    <div>💡 엑셀에서 작성 후 행 통째로 복사 → 아래 칸에 붙여넣으세요. 첫 헤더 행은 자동 무시.</div>
                    <div>💡 <b>이미 가입된 이메일</b>은 신규 생성 X — 거래처 매핑만 추가됩니다.</div>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">데이터 입력</label>
                  <textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)}
                    placeholder={`김딜러\tdealer1@kmd.com\t010-1111-1111\tabc12345\t2110948285,1234567890`}
                    rows={8} className="w-full px-3 py-2 text-sm font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 resize-y" />
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
                            {["#", "이름", "이메일", "휴대폰", "PW", "거래처", "상태"].map((h) => (
                              <th key={h} className="px-2 py-2 text-left text-gray-500">{h}</th>
                            ))}
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
                              <td className="px-2 py-1.5">{v.bizNumbers.length}개</td>
                              <td className="px-2 py-1.5">
                                {v.issues.length === 0
                                  ? <span className="text-green-700 inline-flex items-center gap-1"><CheckCircle className="w-3 h-3" />OK</span>
                                  : <span className="text-red-700 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{v.issues.join(", ")}</span>}
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
                <button onClick={() => setBulkOpen(false)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">취소</button>
                <button onClick={submitBulk} disabled={okCount === 0 || bulkSubmitting}
                  className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg disabled:opacity-40">
                  {bulkSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  <Plus className="w-4 h-4" />{okCount}명 일괄 생성
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
