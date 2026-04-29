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
} from "lucide-react";
import * as XLSX from "xlsx";

interface SubmissionRoute {
  id: string;
  clientName: string;
  companyName: string;
  submissionEntity: string;
  submissionEmail: string | null;
  memo: string | null;
  active: boolean;
  createdAt: string;
}

const EMPTY_FORM = {
  clientName: "",
  companyName: "",
  submissionEntity: "",
  submissionEmail: "",
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
  const header = ["거래처", "제약사", "제출처", "이메일", "메모"];
  const rows = routes.map((r) => [
    r.clientName,
    r.companyName,
    r.submissionEntity,
    r.submissionEmail ?? "",
    r.memo ?? "",
  ]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws["!cols"] = [18, 18, 18, 24, 30].map((w) => ({ wch: w }));
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

      // A=거래처, B=제약사, C=제출처, D=이메일, E=메모
      const rows = dataRows
        .filter(
          (r) =>
            String(r[0] ?? "").trim() &&
            String(r[1] ?? "").trim() &&
            String(r[2] ?? "").trim()
        )
        .map((r) => ({
          clientName: String(r[0]).trim(),
          companyName: String(r[1]).trim(),
          submissionEntity: String(r[2]).trim(),
          submissionEmail: String(r[3] ?? "").trim() || null,
          memo: String(r[4] ?? "").trim() || null,
        }));

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
              memo: form.memo || null,
            }
          : {
              clientName: form.clientName,
              companyName: form.companyName,
              submissionEntity: form.submissionEntity,
              submissionEmail: form.submissionEmail || null,
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

function EntityStatusTab() {
  const [entities, setEntities] = useState<EntityStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [zipLoading, setZipLoading] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/submission-routes/check");
      const data = await res.json();
      setEntities(Array.isArray(data?.entities) ? data.entities : []);
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
          <h1 className="text-xl font-bold text-gray-900">제출 현황</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            제출처별 사업자등록증 매칭 현황 및 ZIP 일괄 다운로드
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

// ── 탭 래퍼 ───────────────────────────────────────────────────

function SubmissionRoutesTabs() {
  const [activeTab, setActiveTab] = useState<"list" | "status">("list");

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-1 border-b border-gray-200">
        <button
          onClick={() => setActiveTab("list")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === "list"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          제출처 목록
        </button>
        <button
          onClick={() => setActiveTab("status")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === "status"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          제출 현황
        </button>
      </div>

      {activeTab === "list" ? <SubmissionRoutesContent /> : <EntityStatusTab />}
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
