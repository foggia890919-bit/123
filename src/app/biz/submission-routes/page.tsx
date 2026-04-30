"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { BizLayout } from "@/app/biz/page";
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  ToggleLeft,
  ToggleRight,
  Loader2,
  X,
  Upload,
  Download,
  CheckCircle,
  AlertCircle,
  FileArchive,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Calendar,
  CheckSquare,
  Square,
  Mail,
} from "lucide-react";
import * as XLSX from "xlsx";

interface SubmissionRoute {
  id: string;
  clientName: string;
  companyName: string;
  submissionEntity: string;
  submissionEmail: string | null;
  requestType: string; // "신규" | "이관"
  memo: string | null;
  active: boolean;
  createdAt: string;
}

const EMPTY_FORM = {
  clientName: "",
  companyName: "",
  submissionEntity: "",
  submissionEmail: "",
  requestType: "신규" as "신규" | "이관",
  memo: "",
};

type FormState = typeof EMPTY_FORM;

// ── 헬퍼 컴포넌트 ─────────────────────────────────────────────

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
      {children}
    </th>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-gray-600">{label}</label>
      {children}
    </div>
  );
}

// ── 엑셀 다운로드 ──────────────────────────────────────────────

function downloadXlsx(routes: SubmissionRoute[]) {
  const header = ["거래처", "제약사", "제출처", "이메일", "구분(신규/이관)", "메모"];
  const rows = routes.map((r) => [
    r.clientName,
    r.companyName,
    r.submissionEntity,
    r.submissionEmail ?? "",
    r.requestType ?? "신규",
    r.memo ?? "",
  ]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws["!cols"] = [18, 18, 18, 24, 14, 30].map((w) => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "통계제출처");
  XLSX.writeFile(wb, "통계제출처_목록.xlsx");
}

// ── 메인 컨텐츠 (탭 임베드용 named export) ───────────────────

export function SubmissionRoutesContent() {
  const [routes, setRoutes] = useState<SubmissionRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [editTarget, setEditTarget] = useState<SubmissionRoute | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkResult, setBulkResult] = useState<{
    created: number;
    errors: string[];
  } | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  // ── 데이터 로드 ───────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (!showInactive) params.set("active", "true");
      const res = await fetch(`/api/submission-routes?${params}`);
      const data = await res.json();
      setRoutes(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [showInactive]);

  useEffect(() => {
    load();
  }, [load]);

  // ── 검색 필터링 ────────────────────────────────────────────

  const filtered = routes.filter((r) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      r.clientName.toLowerCase().includes(q) ||
      r.companyName.toLowerCase().includes(q) ||
      r.submissionEntity.toLowerCase().includes(q)
    );
  });

  // ── 엑셀 다운로드 ─────────────────────────────────────────

  async function handleDownload() {
    setDownloading(true);
    try {
      // 전체 목록 조회 (비활성 포함)
      const res = await fetch("/api/submission-routes");
      const data = await res.json();
      const all: SubmissionRoute[] = Array.isArray(data) ? data : [];
      downloadXlsx(all);
    } finally {
      setDownloading(false);
    }
  }

  // ── 엑셀 업로드 ───────────────────────────────────────────

  async function handleBulkUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setBulkUploading(true);
    setBulkResult(null);

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: string[][] = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        defval: "",
      });
      const [, ...dataRows] = raw; // 헤더행 skip

      // A=거래처, B=제약사, C=제출처, D=이메일, E=구분(신규/이관), F=메모
      const rows = dataRows
        .filter(
          (r) =>
            String(r[0] ?? "").trim() &&
            String(r[1] ?? "").trim() &&
            String(r[2] ?? "").trim()
        )
        .map((r) => {
          const rtRaw = String(r[4] ?? "").trim();
          const requestType = rtRaw === "이관" ? "이관" : "신규";
          return {
            clientName: String(r[0]).trim(),
            companyName: String(r[1]).trim(),
            submissionEntity: String(r[2]).trim(),
            submissionEmail: String(r[3] ?? "").trim() || null,
            requestType,
            memo: String(r[5] ?? "").trim() || null,
          };
        });

      if (rows.length === 0) {
        alert(
          "유효한 행이 없어요. A(거래처), B(제약사), C(제출처) 열을 확인해주세요."
        );
        return;
      }

      let created = 0;
      const errors: string[] = [];

      for (const row of rows) {
        try {
          const res = await fetch("/api/submission-routes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(row),
          });
          if (res.ok) {
            created++;
          } else {
            const d = await res.json();
            errors.push(
              `${row.clientName}×${row.companyName}: ${d.error ?? "등록 실패"}`
            );
          }
        } catch {
          errors.push(`${row.clientName}×${row.companyName}: 네트워크 오류`);
        }
      }

      setBulkResult({ created, errors });
      load();
    } finally {
      setBulkUploading(false);
    }
  }

  // ── 모달 열기 ────────────────────────────────────────────

  function openAdd() {
    setForm(EMPTY_FORM);
    setEditTarget(null);
    setError(null);
    setModal("add");
  }

  function openEdit(r: SubmissionRoute) {
    setForm({
      clientName: r.clientName,
      companyName: r.companyName,
      submissionEntity: r.submissionEntity,
      submissionEmail: r.submissionEmail ?? "",
      requestType: r.requestType === "이관" ? "이관" : "신규",
      memo: r.memo ?? "",
    });
    setEditTarget(r);
    setError(null);
    setModal("edit");
  }

  // ── 저장 ─────────────────────────────────────────────────

  async function handleSave() {
    setError(null);
    if (!form.clientName || !form.companyName || !form.submissionEntity) {
      setError("거래처명, 제약사명, 제출처는 필수입니다.");
      return;
    }

    setSaving(true);
    try {
      const method = modal === "edit" ? "PATCH" : "POST";
      const body =
        modal === "edit"
          ? {
              id: editTarget!.id,
              submissionEntity: form.submissionEntity,
              submissionEmail: form.submissionEmail || null,
              requestType: form.requestType,
              memo: form.memo || null,
            }
          : {
              clientName: form.clientName,
              companyName: form.companyName,
              submissionEntity: form.submissionEntity,
              submissionEmail: form.submissionEmail || null,
              requestType: form.requestType,
              memo: form.memo || null,
            };

      const res = await fetch("/api/submission-routes", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error || "저장에 실패했습니다.");
        return;
      }
      setModal(null);
      load();
    } finally {
      setSaving(false);
    }
  }

  // ── 활성/비활성 토글 ──────────────────────────────────────

  async function handleToggleActive(r: SubmissionRoute) {
    await fetch("/api/submission-routes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: r.id, active: !r.active }),
    });
    load();
  }

  // ── 삭제 ─────────────────────────────────────────────────

  async function handleDelete(r: SubmissionRoute) {
    if (
      !confirm(
        `"${r.clientName} × ${r.companyName}" 제출처 설정을 삭제할까요?`
      )
    )
      return;
    await fetch(`/api/submission-routes?id=${r.id}`, { method: "DELETE" });
    load();
  }

  // ── 렌더 ─────────────────────────────────────────────────

  return (
    <>
      <div className="space-y-5">
        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              통계 제출처 관리
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              거래처×제약사별 통계 제출처 및 담당 이메일 설정
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={uploadRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleBulkUpload}
            />
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {downloading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              엑셀 다운로드
            </button>
            <button
              onClick={() => uploadRef.current?.click()}
              disabled={bulkUploading}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {bulkUploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              엑셀 업로드
            </button>
            <button
              onClick={openAdd}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              추가
            </button>
          </div>
        </div>

        {/* 업로드 결과 배너 */}
        {bulkResult && (
          <div
            className={`flex items-start gap-2 text-sm rounded-lg px-4 py-3 ${
              bulkResult.errors.length > 0
                ? "bg-yellow-50 border border-yellow-200"
                : "bg-green-50 border border-green-200"
            }`}
          >
            {bulkResult.errors.length === 0 ? (
              <CheckCircle className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-yellow-600 shrink-0 mt-0.5" />
            )}
            <div>
              <p className="font-medium text-gray-800">
                신규 {bulkResult.created}건 등록
              </p>
              {bulkResult.errors.map((e, i) => (
                <p key={i} className="text-xs text-red-600 mt-0.5">
                  {e}
                </p>
              ))}
            </div>
            <button
              onClick={() => setBulkResult(null)}
              className="ml-auto text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 검색 + 비활성 토글 */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="거래처명, 제약사명, 제출처명 검색"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={() => setShowInactive(!showInactive)}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            {showInactive ? (
              <ToggleRight className="w-5 h-5 text-blue-600" />
            ) : (
              <ToggleLeft className="w-5 h-5 text-gray-400" />
            )}
            비활성 포함
          </button>
        </div>

        {/* 테이블 */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">
              {search ? "검색 결과가 없어요." : "등록된 제출처 설정이 없어요."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <Th>거래처</Th>
                    <Th>제약사</Th>
                    <Th>제출처(법인)</Th>
                    <Th>이메일</Th>
                    <Th>구분</Th>
                    <Th>메모</Th>
                    <Th>상태</Th>
                    <Th>관리</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((r) => (
                    <tr
                      key={r.id}
                      className={`hover:bg-gray-50 transition-colors ${
                        !r.active ? "opacity-50" : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {r.clientName}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {r.companyName}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {r.submissionEntity}
                      </td>
                      <td className="px-4 py-3 text-gray-600 font-mono text-xs">
                        {r.submissionEmail || "-"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            r.requestType === "이관"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-blue-50 text-blue-700"
                          }`}
                        >
                          {r.requestType === "이관" ? "이관" : "신규"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate">
                        {r.memo || "-"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            r.active
                              ? "bg-green-50 text-green-700"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {r.active ? "활성" : "비활성"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => openEdit(r)}
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="수정"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleToggleActive(r)}
                            className="p-1.5 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                            title={r.active ? "비활성화" : "활성화"}
                          >
                            {r.active ? (
                              <ToggleRight className="w-3.5 h-3.5" />
                            ) : (
                              <ToggleLeft className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            onClick={() => handleDelete(r)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="삭제"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!loading && (
          <p className="text-xs text-gray-400 text-right">
            총 {filtered.length}개 설정
          </p>
        )}
      </div>

      {/* 추가/수정 모달 */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">
                {modal === "add" ? "제출처 추가" : "제출처 수정"}
              </h2>
              <button
                onClick={() => setModal(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {error && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <Field label="거래처명 *">
                <input
                  value={form.clientName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, clientName: e.target.value }))
                  }
                  disabled={modal === "edit"}
                  placeholder="병의원명 입력"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
                />
              </Field>

              <Field label="제약사명 *">
                <input
                  value={form.companyName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, companyName: e.target.value }))
                  }
                  disabled={modal === "edit"}
                  placeholder="제약사명 입력"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
                />
              </Field>

              <Field label="제출처(법인) *">
                <input
                  value={form.submissionEntity}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, submissionEntity: e.target.value }))
                  }
                  placeholder="제출처 법인명 입력"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </Field>

              <Field label="이메일">
                <input
                  type="email"
                  value={form.submissionEmail}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      submissionEmail: e.target.value,
                    }))
                  }
                  placeholder="example@domain.com"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </Field>

              <Field label="구분 (정산 시 추가수수료 적용 여부)">
                <select
                  value={form.requestType}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      requestType: e.target.value === "이관" ? "이관" : "신규",
                    }))
                  }
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="신규">신규처 — 추가수수료 지급</option>
                  <option value="이관">이관처 — 추가수수료 미지급</option>
                </select>
              </Field>

              <Field label="메모">
                <textarea
                  value={form.memo}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, memo: e.target.value }))
                  }
                  rows={2}
                  placeholder="기타 참고사항"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </Field>
            </div>

            <div className="px-6 pb-5 flex gap-2 justify-end">
              <button
                onClick={() => setModal(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── 제출 현황 탭 ──────────────────────────────────────────────

interface EntityStatus {
  submissionEntity: string;
  companies: string[];
  total: number;
  matched: number;
  missingCount: number;
  missing: { clientName: string; companyName: string }[];
}

interface UnmappedItem {
  clientName: string;
  companyName: string;
}

function EntityStatusTab() {
  const [entities, setEntities] = useState<EntityStatus[]>([]);
  const [unmapped, setUnmapped] = useState<UnmappedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [zipLoading, setZipLoading] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [unmappedExpanded, setUnmappedExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/submission-routes/check");
      const data = await res.json();
      setEntities(Array.isArray(data?.entities) ? data.entities : []);
      setUnmapped(Array.isArray(data?.unmapped) ? data.unmapped : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function toggleExpand(entity: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(entity)) next.delete(entity);
      else next.add(entity);
      return next;
    });
  }

  async function downloadZip(submissionEntity: string) {
    setZipLoading(submissionEntity);
    try {
      const res = await fetch(
        `/api/submission-routes/download?submissionEntity=${encodeURIComponent(submissionEntity)}`
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: "다운로드 실패" }));
        alert(d.error || "다운로드 실패");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${submissionEntity}_사업자등록증.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setZipLoading(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">사업자등록증 현황</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            제출처별 매칭 현황 + ZIP 일괄 다운로드 + 제출처 미매핑 거래처
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          새로고침
        </button>
      </div>

      {!loading && unmapped.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl overflow-hidden">
          <button
            onClick={() => setUnmappedExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-4 hover:bg-orange-100/50 transition-colors text-left"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-orange-600" />
              <span className="font-semibold text-orange-800">
                제출처 미매핑 거래처 {unmapped.length}건
              </span>
              <span className="text-xs text-orange-600">
                (사업자등록증은 있지만 통계 제출처가 등록되지 않음)
              </span>
            </div>
            {unmappedExpanded ? (
              <ChevronUp className="w-4 h-4 text-orange-600" />
            ) : (
              <ChevronDown className="w-4 h-4 text-orange-600" />
            )}
          </button>
          {unmappedExpanded && (
            <ul className="px-5 pb-4 text-xs text-orange-900 max-h-80 overflow-y-auto divide-y divide-orange-100 bg-white/60">
              {unmapped.map((u, i) => (
                <li key={i} className="py-2">
                  <span className="font-medium">{u.clientName}</span>
                  <span className="text-orange-400"> × </span>
                  <span>{u.companyName}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 bg-white border border-gray-200 rounded-xl">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : entities.length === 0 ? (
        <div className="text-center py-16 bg-white border border-gray-200 rounded-xl text-gray-400 text-sm">
          등록된 제출처가 없어요.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {entities.map((e) => {
            const allMatched = e.missingCount === 0;
            const isExpanded = expanded.has(e.submissionEntity);
            return (
              <div
                key={e.submissionEntity}
                className={`bg-white border rounded-xl overflow-hidden ${
                  allMatched ? "border-green-200" : "border-yellow-200"
                }`}
              >
                <div
                  className={`px-5 py-4 border-b ${
                    allMatched
                      ? "bg-green-50 border-green-100"
                      : "bg-yellow-50 border-yellow-100"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-gray-900 truncate">
                        {e.submissionEntity}
                      </h3>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">
                        제약사 {e.companies.length}개:{" "}
                        {e.companies.slice(0, 3).join(", ")}
                        {e.companies.length > 3
                          ? ` 외 ${e.companies.length - 3}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-white text-gray-700 border border-gray-200">
                        {e.matched}/{e.total}
                      </span>
                      {e.missingCount > 0 && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                          누락 {e.missingCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="px-5 py-4 space-y-3">
                  {allMatched ? (
                    <div className="flex items-center gap-2 text-sm text-green-700">
                      <CheckCircle className="w-4 h-4" />
                      모든 사업자등록증이 매칭됐어요.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm text-yellow-700">
                        <AlertCircle className="w-4 h-4" />
                        {e.missingCount}건 누락 — 문서 필요
                      </div>
                      <button
                        onClick={() => toggleExpand(e.submissionEntity)}
                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp className="w-3.5 h-3.5" />
                            누락 목록 접기
                          </>
                        ) : (
                          <>
                            <ChevronDown className="w-3.5 h-3.5" />
                            누락 목록 펼치기
                          </>
                        )}
                      </button>
                      {isExpanded && (
                        <ul className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2 max-h-48 overflow-y-auto divide-y divide-gray-100">
                          {e.missing.map((m, i) => (
                            <li key={i} className="py-1.5 first:pt-0 last:pb-0">
                              <span className="font-medium text-gray-800">
                                {m.clientName}
                              </span>
                              <span className="text-gray-400"> × </span>
                              <span>{m.companyName}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  <button
                    onClick={() => downloadZip(e.submissionEntity)}
                    disabled={zipLoading === e.submissionEntity}
                    className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
                      allMatched
                        ? "bg-green-600 hover:bg-green-700 text-white"
                        : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {zipLoading === e.submissionEntity ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <FileArchive className="w-4 h-4" />
                    )}
                    ZIP 다운로드
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 월별 제출 체크리스트 탭 ──────────────────────────────────

interface MonthlyItem {
  id: string;
  clientName: string;
  companyName: string;
  submissionEmail: string | null;
  requestType: string;
  submitted: boolean;
  submittedAt: string | null;
  memo: string | null;
}

interface MonthlyGroup {
  submissionEntity: string;
  total: number;
  submitted: number;
  items: MonthlyItem[];
}

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftYearMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function MonthlyChecklistTab() {
  const [yearMonth, setYearMonth] = useState<string>(currentYearMonth());
  const [groups, setGroups] = useState<MonthlyGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showOnlyPending, setShowOnlyPending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/submission-routes/monthly?yearMonth=${yearMonth}`
      );
      const data = await res.json();
      setGroups(Array.isArray(data?.groups) ? data.groups : []);
    } finally {
      setLoading(false);
    }
  }, [yearMonth]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleItem(item: MonthlyItem) {
    setSavingId(item.id);
    try {
      const res = await fetch("/api/submission-routes/monthly", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          yearMonth,
          submissionRouteId: item.id,
          submitted: !item.submitted,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: "저장 실패" }));
        alert(d.error || "저장 실패");
        return;
      }
      load();
    } finally {
      setSavingId(null);
    }
  }

  async function bulkToggle(submissionEntity: string, submitted: boolean) {
    setBulkBusy(submissionEntity);
    try {
      const res = await fetch("/api/submission-routes/monthly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yearMonth, submissionEntity, submitted }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: "저장 실패" }));
        alert(d.error || "저장 실패");
        return;
      }
      load();
    } finally {
      setBulkBusy(null);
    }
  }

  function toggleCollapse(entity: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(entity)) next.delete(entity);
      else next.add(entity);
      return next;
    });
  }

  const totalRoutes = groups.reduce((s, g) => s + g.total, 0);
  const totalSubmitted = groups.reduce((s, g) => s + g.submitted, 0);
  const totalPending = totalRoutes - totalSubmitted;
  const allDone = totalRoutes > 0 && totalPending === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">월별 제출 체크</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            매달 통계 제출 여부를 제출처별로 체크. 미제출 0건 달성이 목표.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setYearMonth((ym) => shiftYearMonth(ym, -1))}
            className="px-2 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            aria-label="이전 달"
          >
            ◀
          </button>
          <div className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-gray-800 bg-white border border-gray-200 rounded-lg">
            <Calendar className="w-4 h-4 text-gray-400" />
            <input
              type="month"
              value={yearMonth}
              onChange={(e) =>
                setYearMonth(e.target.value || currentYearMonth())
              }
              className="bg-transparent focus:outline-none w-32"
            />
          </div>
          <button
            onClick={() => setYearMonth((ym) => shiftYearMonth(ym, 1))}
            className="px-2 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            aria-label="다음 달"
          >
            ▶
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            새로고침
          </button>
        </div>
      </div>

      {/* 진행률 요약 */}
      {!loading && totalRoutes > 0 && (
        <div
          className={`rounded-xl border px-5 py-4 ${
            allDone
              ? "bg-green-50 border-green-200"
              : totalPending > 0
              ? "bg-yellow-50 border-yellow-200"
              : "bg-gray-50 border-gray-200"
          }`}
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              {allDone ? (
                <CheckCircle className="w-5 h-5 text-green-600" />
              ) : (
                <AlertCircle className="w-5 h-5 text-yellow-600" />
              )}
              <span className="font-semibold text-gray-900">
                {yearMonth} —{" "}
                {allDone
                  ? "모든 제출처 제출 완료"
                  : `${totalPending}건 미제출 / 전체 ${totalRoutes}건`}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowOnlyPending((v) => !v)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  showOnlyPending
                    ? "bg-yellow-100 border-yellow-300 text-yellow-800"
                    : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {showOnlyPending ? "미제출만 보기 ON" : "미제출만 보기"}
              </button>
              <div className="text-sm font-mono text-gray-700">
                {totalSubmitted} / {totalRoutes}
              </div>
            </div>
          </div>
          <div className="mt-3 h-2 bg-white rounded-full overflow-hidden border border-gray-100">
            <div
              className={`h-full transition-all ${
                allDone ? "bg-green-500" : "bg-yellow-400"
              }`}
              style={{
                width: `${
                  totalRoutes === 0 ? 0 : (totalSubmitted / totalRoutes) * 100
                }%`,
              }}
            />
          </div>
        </div>
      )}

      {/* 제출처 그룹 */}
      {loading ? (
        <div className="flex items-center justify-center py-16 bg-white border border-gray-200 rounded-xl">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-16 bg-white border border-gray-200 rounded-xl text-gray-400 text-sm">
          등록된 제출처가 없어요. 먼저 &quot;제출처 목록&quot; 탭에서 추가해주세요.
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const allSubmitted = g.submitted === g.total;
            const isCollapsed = collapsed.has(g.submissionEntity);
            const visibleItems = showOnlyPending
              ? g.items.filter((i) => !i.submitted)
              : g.items;
            if (showOnlyPending && visibleItems.length === 0) return null;
            return (
              <div
                key={g.submissionEntity}
                className={`bg-white border rounded-xl overflow-hidden ${
                  allSubmitted ? "border-green-200" : "border-gray-200"
                }`}
              >
                <div
                  className={`flex items-center justify-between gap-3 px-5 py-3 ${
                    allSubmitted ? "bg-green-50" : "bg-gray-50"
                  } border-b ${
                    allSubmitted ? "border-green-100" : "border-gray-100"
                  }`}
                >
                  <button
                    onClick={() => toggleCollapse(g.submissionEntity)}
                    className="flex items-center gap-2 min-w-0 text-left"
                  >
                    {isCollapsed ? (
                      <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                    ) : (
                      <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
                    )}
                    <span className="font-semibold text-gray-900 truncate">
                      {g.submissionEntity}
                    </span>
                    <span
                      className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        allSubmitted
                          ? "bg-green-100 text-green-700"
                          : g.submitted > 0
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {g.submitted}/{g.total}
                    </span>
                  </button>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => bulkToggle(g.submissionEntity, true)}
                      disabled={bulkBusy === g.submissionEntity || allSubmitted}
                      className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      전체 제출완료
                    </button>
                    <button
                      onClick={() => bulkToggle(g.submissionEntity, false)}
                      disabled={
                        bulkBusy === g.submissionEntity || g.submitted === 0
                      }
                      className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      전체 해제
                    </button>
                  </div>
                </div>

                {!isCollapsed && (
                  <ul className="divide-y divide-gray-50">
                    {visibleItems.map((item) => (
                      <li
                        key={item.id}
                        className={`flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors ${
                          item.submitted ? "bg-green-50/30" : ""
                        }`}
                      >
                        <button
                          onClick={() => toggleItem(item)}
                          disabled={savingId === item.id}
                          className="shrink-0"
                          aria-label={item.submitted ? "제출 해제" : "제출 완료"}
                        >
                          {savingId === item.id ? (
                            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                          ) : item.submitted ? (
                            <CheckSquare className="w-5 h-5 text-green-600" />
                          ) : (
                            <Square className="w-5 h-5 text-gray-300 hover:text-gray-500" />
                          )}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-900 truncate">
                              {item.clientName}
                            </span>
                            <span className="text-xs text-gray-400">×</span>
                            <span className="text-sm text-gray-700 truncate">
                              {item.companyName}
                            </span>
                            <span
                              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                item.requestType === "이관"
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-blue-50 text-blue-700"
                              }`}
                            >
                              {item.requestType}
                            </span>
                          </div>
                          {item.submissionEmail && (
                            <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                              <Mail className="w-3 h-3" />
                              <span className="font-mono">
                                {item.submissionEmail}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="text-xs text-gray-400 shrink-0">
                          {item.submitted && item.submittedAt
                            ? new Date(item.submittedAt).toLocaleDateString(
                                "ko-KR"
                              )
                            : "—"}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 탭 래퍼 ───────────────────────────────────────────────────

type TabKey = "list" | "status" | "monthly";

function SubmissionRoutesTabs() {
  const [activeTab, setActiveTab] = useState<TabKey>("list");

  const tabs: { key: TabKey; label: string }[] = [
    { key: "list", label: "제출처 목록" },
    { key: "status", label: "사업자등록증 현황" },
    { key: "monthly", label: "월별 제출 체크" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-1 border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === t.key
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "list" && <SubmissionRoutesContent />}
      {activeTab === "status" && <EntityStatusTab />}
      {activeTab === "monthly" && <MonthlyChecklistTab />}
    </div>
  );
}

export default function SubmissionRoutesPage() {
  return (
    <BizLayout>
      <SubmissionRoutesTabs />
    </BizLayout>
  );
}
