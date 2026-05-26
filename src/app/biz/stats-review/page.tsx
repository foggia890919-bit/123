"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle, AlertTriangle, ExternalLink, Trash2, ChevronRight, ArrowLeft, BarChart3, Loader2, Plus, Save, ZoomIn, ZoomOut, Maximize2, Filter } from "lucide-react";
import { useRef } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";

// AI 처방통계 사진 검수 페이지. 관리자/BIZ 가 사용자들의 업로드를 거래처×월 단위로
// 그룹지어 검수, 사진 삭제, 제출완료 마킹.
//
// AI 정확도 지표 — 사용자가 사진 품질을 한눈에 판단:
// - 행 수 / 사진 수
// - 평균 정확도 (avgConfidence)
// - 마스터 매칭률 (보험코드 9자리로 마스터 DB 매칭된 비율)
// - 부분 추출 (Gemini summary.drugCount vs 실제 추출 행 수 다른 사진 수)
// - mismatch (보험코드↔이름 불일치 행 수)

interface Metrics {
  rowCount: number;
  photoCount: number;
  totalFee: number;
  avgConfidence: number;
  masterMatchRate: number;
  mismatchCount: number;
  partialExtractionCount: number;
  processingCount?: number;
  errorCount?: number;
  // 검증 강화 (A) 지표
  lowQualityRowCount?: number;
  priceMismatchCount?: number;
  revenueMismatchCount?: number;
  companyMismatchCount?: number;
  totalSumMismatchCount?: number;
  // Gemini 자가검증 — 마스터DB 가 못 잡은 행을 Gemini 텍스트로 cross-check 한 결과
  selfValidateMismatchCount?: number;
}

interface GroupListItem {
  clientId: string;
  clientName: string;
  year: number;
  month: number;
  submitted: boolean;
  latestAt: string;
  metrics: Metrics;
  // 사진을 올린 회원들 — 한 그룹에 여러 영업사원이 사진 올렸을 수 있어 배열.
  uploaders?: { name: string | null; email: string }[];
}

interface ReportRow {
  id: string;
  hospitalName: string | null;
  companyName: string | null;
  status: string;
  totalFee: number | null;
  createdAt: string;
  hasImage: boolean;
  ocrData: {
    finalDrugs?: Array<{
      insuranceCode?: string;
      companyName?: string;
      productName?: string;
      quantity?: string;
      unitPrice?: number;
      totalPrice?: number;
      matchedMedicationId?: string | null;
      mismatch?: unknown;
      companyNameMismatch?: { geminiCompanyName?: string; masterCompanyName?: string } | null;
      originalProductName?: string;
      nameAutoReplaced?: boolean;
      originalUnitPrice?: number | null;
      priceAutoReplaced?: boolean;
      finalConfidence?: number;
      // Gemini 자가검증 결과. "selfValidateMismatch" 면 노란 "검증대상" 마킹.
      reviewReason?: string | null;
      validation?: {
        source?: string;
        mismatchFields?: string[];
        suggestion?: {
          productName?: string;
          insuranceCode?: string;
          unitPrice?: number;
        };
      } | null;
      qualityChecks?: {
        masterMatch?: { applicable?: boolean; matched?: boolean; detail?: string };
        prefixMatch?: { applicable?: boolean; matched?: boolean; detail?: string };
        priceMatch?: { applicable?: boolean; matched?: boolean; detail?: string };
        revenueMatch?: { applicable?: boolean; matched?: boolean; detail?: string };
      };
      bbox?: [number, number, number, number];
    }>;
    avgConfidence?: number;
    sheetUrl?: string;
    totalSumCheck?: { applicable?: boolean; matched?: boolean; detail?: string };
    companiesInPhoto?: string[];
    geminiMeta?: {
      summary?: { drugCount?: number; totalAmountWon?: number };
    };
  };
}

interface GroupDetail {
  clientId: string;
  clientName: string;
  year: number;
  month: number;
  submitted: boolean;
  metrics: Metrics;
  reports: ReportRow[];
  duplicateCount?: number;
  duplicateBy?: Record<string, Array<{ reportId: string; similarity: number }>>;
}

function MetricBadge({ label, value, color = "gray" }: { label: string; value: string | number; color?: "gray" | "green" | "amber" | "red" | "blue" }) {
  const cls = {
    gray: "bg-gray-50 border-gray-200 text-gray-700",
    green: "bg-green-50 border-green-200 text-green-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    red: "bg-red-50 border-red-200 text-red-700",
    blue: "bg-blue-50 border-blue-200 text-blue-700",
  }[color];
  return (
    <div className={`px-2 py-1 rounded border ${cls}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-sm font-bold">{value}</div>
    </div>
  );
}

function confidenceColor(n: number): "green" | "amber" | "red" {
  if (n >= 90) return "green";
  if (n >= 75) return "amber";
  return "red";
}

// 행별 점수 dot — 보험코드 셀 옆 작은 컬러 동그라미.
function scoreDotClass(score: number): string {
  if (score === 0) return "bg-gray-300";
  if (score >= 90) return "bg-green-500";
  if (score >= 75) return "bg-amber-500";
  return "bg-red-500";
}

// 한 사진 안에 여러 제약사가 섞일 때 시각 그룹화용 — 제약사명 → 결정적 색상.
function companyColor(name: string): string {
  if (!name) return "bg-gray-400";
  const palette = [
    "bg-blue-500", "bg-green-500", "bg-purple-500", "bg-pink-500",
    "bg-orange-500", "bg-cyan-500", "bg-yellow-500", "bg-red-500",
    "bg-indigo-500", "bg-teal-500", "bg-rose-500", "bg-lime-500",
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}

export default function StatsReviewPage() {
  const [groups, setGroups] = useState<GroupListItem[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [selected, setSelected] = useState<{ clientId: string; year: number; month: number } | null>(null);
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // 자동 일괄 재시도 한 번만 실행하도록 group key 추적
  const [autoRetryDone, setAutoRetryDone] = useState<Set<string>>(new Set());
  // 그룹 목록에서 체크박스로 선택한 그룹 key 들 (외부 일괄 재시도용)
  const [selectedGroupKeys, setSelectedGroupKeys] = useState<Set<string>>(new Set());
  const [groupRetryBusy, setGroupRetryBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // 일괄 작업 진행 상태 — N/M 표시 + 완료 알림용
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [bulkSuccess, setBulkSuccess] = useState<string>("");
  // 사진별 선택 — 체크박스로 토글, "선택한 N장 제출완료" 일괄 적용
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 단가 0 행 (마스터 매칭 실패 = 직접 입력 필요) 만 보기 토글.
  // 검수자가 채워야 할 행만 빠르게 찾아 채우려는 용도.
  const [priceMissingOnly, setPriceMissingOnly] = useState(false);
  // Gemini 자가검증으로 잡힌 "검증대상" 행만 보기 토글. (priceMissingOnly 와 OR 결합)
  const [reviewOnly, setReviewOnly] = useState(false);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // 그룹 목록 조회
  function refreshGroups() {
    setGroupsLoading(true);
    fetch("/api/stats/submissions")
      .then((r) => r.ok ? r.json() : [])
      .then((data: GroupListItem[]) => setGroups(Array.isArray(data) ? data : []))
      .catch(() => setGroups([]))
      .finally(() => setGroupsLoading(false));
  }
  useEffect(() => { refreshGroups(); }, []);

  // 선택 그룹 상세 조회
  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    setDetailLoading(true);
    setError("");
    fetch(`/api/stats/submissions?clientId=${selected.clientId}&year=${selected.year}&month=${selected.month}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: GroupDetail | null) => setDetail(data))
      .catch(() => setError("그룹 상세 조회 실패"))
      .finally(() => setDetailLoading(false));
  }, [selected]);

  async function handleDelete(reportId: string) {
    if (!confirm("이 사진을 삭제하시겠습니까? 구글 시트 데이터는 자동 삭제되지 않으니 따로 정리 필요합니다.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/stats?id=${reportId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { setError(data.error || `삭제 실패: HTTP ${res.status}`); return; }
      // 상세 재조회
      if (selected) {
        const r = await fetch(`/api/stats/submissions?clientId=${selected.clientId}&year=${selected.year}&month=${selected.month}`);
        const d = await r.json();
        setDetail(d);
        if (!d.reports?.length) {
          // 그룹이 비었으면 목록으로 돌아감
          setSelected(null);
          refreshGroups();
        }
      }
    } catch (e) {
      setError(`삭제 실패: ${String(e).slice(0, 200)}`);
    } finally {
      setBusy(false);
    }
  }

  // 페이지 진입 시 ERROR 사진이 있고 자동 재시도 미실행 그룹이면 자동으로 일괄 재시도.
  // group key 별 1회만 실행 (autoRetryDone) — 같은 그룹 재진입해도 또 안 함.
  useEffect(() => {
    if (!detail || !selected) return;
    const groupKey = `${selected.clientId}|${selected.year}|${selected.month}`;
    if (autoRetryDone.has(groupKey)) return;
    const errorReports = detail.reports.filter((r) => r.status === "ERROR");
    if (errorReports.length === 0) return;
    // 즉시 자동 재시도 시작 — 사용자 클릭 불필요
    setAutoRetryDone((prev) => new Set(prev).add(groupKey));
    (async () => {
      const total = errorReports.length;
      setBulkProgress({ current: 0, total, label: "자동 재시도" });
      for (let i = 0; i < total; i++) {
        setBulkProgress({ current: i + 1, total, label: "자동 재시도" });
        try {
          await fetch("/api/stats/photo-retry", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reportId: errorReports[i].id }),
          });
        } catch { /* graceful — 다음 사진 진행 */ }
      }
      setBulkProgress(null);
      setBulkSuccess(`처리 실패 ${total}장 자동 재시도 요청 완료 — 잠시 후 결과 확인`);
      // 결과 자동 새로고침
      const r = await fetch(`/api/stats/submissions?clientId=${selected.clientId}&year=${selected.year}&month=${selected.month}`);
      if (r.ok) setDetail(await r.json());
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.reports, selected]);

  // 그룹 목록 화면에서 선택한 그룹들의 처리 실패 사진 일괄 재시도.
  // 그룹 안 진입 없이 외부에서 한 번에 처리.
  async function handleGroupBulkRetry() {
    if (selectedGroupKeys.size === 0) return;
    if (!confirm(`선택한 ${selectedGroupKeys.size}개 그룹의 처리 실패 사진을 모두 다시 분석할까요?`)) return;
    setGroupRetryBusy(true);
    let totalRetried = 0;
    let totalFailed = 0;
    try {
      for (const key of Array.from(selectedGroupKeys)) {
        const [clientId, yearStr, monthStr] = key.split("|");
        const res = await fetch(`/api/stats/submissions?clientId=${clientId}&year=${yearStr}&month=${monthStr}`);
        if (!res.ok) continue;
        const detail = await res.json() as { reports?: { id: string; status: string }[] };
        const errorReports = (detail.reports ?? []).filter((r) => r.status === "ERROR");
        for (const r of errorReports) {
          try {
            const rr = await fetch("/api/stats/photo-retry", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reportId: r.id }),
            });
            if (rr.ok) totalRetried++; else totalFailed++;
          } catch { totalFailed++; }
        }
      }
      alert(`재분석 요청 완료 — 성공 ${totalRetried}장${totalFailed > 0 ? ` / 실패 ${totalFailed}장` : ""}\n잠시 후 그룹별로 결과 확인 가능합니다.`);
      setSelectedGroupKeys(new Set());
      refreshGroups();
    } finally {
      setGroupRetryBusy(false);
    }
  }

  // 선택된 사진들 일괄 삭제 — 순차 DELETE (서버 부담 방지) + 진행 상태 + 완료 알림
  async function handleBulkRetry() {
    if (!detail) return;
    const errorReports = detail.reports.filter((r) => r.status === "ERROR");
    if (errorReports.length === 0) { setError("처리 실패한 사진이 없습니다"); return; }
    if (!confirm(`처리 실패한 ${errorReports.length}장을 모두 다시 분석할까요?`)) return;
    setBusy(true);
    setError("");
    setBulkSuccess("");
    const total = errorReports.length;
    setBulkProgress({ current: 0, total, label: "재분석 요청" });
    const failed: string[] = [];
    let succeeded = 0;
    for (let i = 0; i < errorReports.length; i++) {
      const r = errorReports[i];
      setBulkProgress({ current: i + 1, total, label: "재분석 요청" });
      try {
        const res = await fetch("/api/stats/photo-retry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reportId: r.id }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          failed.push(`${r.id.slice(0, 8)}: ${d.error || `HTTP ${res.status}`}`);
        } else {
          succeeded++;
        }
      } catch (e) {
        failed.push(`${r.id.slice(0, 8)}: ${String(e).slice(0, 100)}`);
      }
    }
    setBulkProgress(null);
    if (selected) {
      const r = await fetch(`/api/stats/submissions?clientId=${selected.clientId}&year=${selected.year}&month=${selected.month}`);
      setDetail(await r.json());
    }
    setBulkSuccess(`재분석 ${succeeded}장 요청 완료 — 잠시 후 새로고침하면 결과 확인 가능`);
    if (failed.length > 0) setError(`재분석 요청 실패 ${failed.length}장:\n${failed.slice(0, 5).join("\n")}`);
    setBusy(false);
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) { setError("선택된 사진이 없습니다"); return; }
    if (!confirm(`정말 선택한 ${selectedIds.size}장의 사진과 데이터를 모두 삭제하시겠습니까? Storage 파일도 함께 삭제됩니다.`)) return;
    setBusy(true);
    setError("");
    setBulkSuccess("");
    const ids = Array.from(selectedIds);
    const total = ids.length;
    setBulkProgress({ current: 0, total, label: "삭제" });
    const failed: string[] = [];
    let succeeded = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      setBulkProgress({ current: i + 1, total, label: "삭제" });
      try {
        const res = await fetch(`/api/stats?id=${id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          failed.push(`${id.slice(0, 8)}: ${data.error || `HTTP ${res.status}`}`);
        } else {
          succeeded++;
        }
      } catch (e) {
        failed.push(`${id.slice(0, 8)}: ${String(e).slice(0, 100)}`);
      }
    }
    setBulkProgress(null);
    // 상세 재조회
    if (selected) {
      const r = await fetch(`/api/stats/submissions?clientId=${selected.clientId}&year=${selected.year}&month=${selected.month}`);
      const d = await r.json();
      setDetail(d);
      if (!d.reports?.length) {
        setSelected(null);
        refreshGroups();
      }
    }
    setSelectedIds(new Set());
    if (failed.length > 0) {
      setError(`${succeeded}장 삭제 / ${failed.length}장 실패:\n${failed.join("\n")}`);
    } else {
      setBulkSuccess(`✅ ${succeeded}장 삭제 완료`);
      setTimeout(() => setBulkSuccess(""), 5000);
    }
    setBusy(false);
  }

  async function handleSubmit(action: "submit" | "reopen", scope: "all" | "selected") {
    if (!selected) return;
    const reportIds = scope === "selected" ? Array.from(selectedIds) : undefined;
    if (scope === "selected" && (!reportIds || reportIds.length === 0)) {
      setError("선택된 사진이 없습니다");
      return;
    }
    const label = action === "submit" ? "제출완료로 마킹" : "다시 검수 가능 상태로";
    const target = scope === "selected" ? `선택한 ${reportIds!.length}장을 ${label}` : `이 그룹 전체를 ${label}`;
    if (!confirm(`정말 ${target} 하시겠습니까?`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/stats", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...selected, action, reportIds }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || `상태 변경 실패: HTTP ${res.status}`); return; }
      // refresh
      const r = await fetch(`/api/stats/submissions?clientId=${selected.clientId}&year=${selected.year}&month=${selected.month}`);
      setDetail(await r.json());
      refreshGroups();
      setSelectedIds(new Set());   // 선택 해제
    } catch (e) {
      setError(`상태 변경 실패: ${String(e).slice(0, 200)}`);
    } finally {
      setBusy(false);
    }
  }

  const filteredGroups = useMemo(() => groups, [groups]);

  // 상세 화면 — 단가 0 (마스터 매칭 실패) 인 행 합계. 검수자가 채워야 할 행 수.
  const priceMissingCount = useMemo(() => {
    if (!detail) return 0;
    return detail.reports.reduce((acc, r) => {
      const drugs = r.ocrData?.finalDrugs ?? [];
      return acc + drugs.filter((d) => (d.unitPrice ?? 0) === 0).length;
    }, 0);
  }, [detail]);

  // ── 상세 화면 ──
  if (selected && detail) {
    return (
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <button onClick={() => setSelected(null)} className="text-sm text-gray-500 hover:text-gray-800 inline-flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> 목록으로
        </button>

        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-900">
            {detail.clientName} · {detail.year}년 {detail.month}월
          </h1>
          {detail.submitted ? (
            <span className="px-2 py-0.5 rounded bg-green-100 text-green-800 text-xs font-semibold border border-green-300">
              ✅ 제출완료
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-xs font-semibold border border-amber-300">
              검수 대기
            </span>
          )}
        </div>

        {/* 지표 */}
        <div className="grid grid-cols-6 gap-2">
          <MetricBadge label="사진" value={`${detail.metrics.photoCount}장`} />
          <MetricBadge label="약품 행" value={`${detail.metrics.rowCount}건`} />
          <MetricBadge label="총 매출" value={`${detail.metrics.totalFee.toLocaleString()}원`} color="blue" />
          <MetricBadge label="평균 정확도" value={`${detail.metrics.avgConfidence}%`} color={confidenceColor(detail.metrics.avgConfidence)} />
          <MetricBadge label="마스터 매칭률" value={`${detail.metrics.masterMatchRate}%`} color={confidenceColor(detail.metrics.masterMatchRate)} />
          <MetricBadge label="불일치 / 부분추출" value={`${detail.metrics.mismatchCount} / ${detail.metrics.partialExtractionCount}`}
            color={detail.metrics.mismatchCount + detail.metrics.partialExtractionCount > 0 ? "amber" : "gray"} />
        </div>
        {/* 검증 강화 (A) — 행 단위 품질 지표. 검수자가 우선 봐야 할 행 안내. */}
        <div className="grid grid-cols-6 gap-2">
          <MetricBadge label="낮은 점수 행"
            value={`${detail.metrics.lowQualityRowCount ?? 0}건`}
            color={(detail.metrics.lowQualityRowCount ?? 0) > 0 ? "red" : "gray"} />
          <MetricBadge label="단가 불일치"
            value={`${detail.metrics.priceMismatchCount ?? 0}건`}
            color={(detail.metrics.priceMismatchCount ?? 0) > 0 ? "amber" : "gray"} />
          <MetricBadge label="매출 불일치"
            value={`${detail.metrics.revenueMismatchCount ?? 0}건`}
            color={(detail.metrics.revenueMismatchCount ?? 0) > 0 ? "amber" : "gray"} />
          <MetricBadge label="제약사 불일치"
            value={`${detail.metrics.companyMismatchCount ?? 0}건`}
            color={(detail.metrics.companyMismatchCount ?? 0) > 0 ? "amber" : "gray"} />
          <MetricBadge label="합계 검증 실패"
            value={`${detail.metrics.totalSumMismatchCount ?? 0}장`}
            color={(detail.metrics.totalSumMismatchCount ?? 0) > 0 ? "amber" : "gray"} />
          <MetricBadge label="검증대상 (AI 재검)"
            value={`${detail.metrics.selfValidateMismatchCount ?? 0}건`}
            color={(detail.metrics.selfValidateMismatchCount ?? 0) > 0 ? "amber" : "gray"} />
        </div>

        {/* 중복 의심 알림 — 사진 hash 는 다른데 약품 데이터가 70%+ 일치 */}
        {(detail.duplicateCount ?? 0) > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded p-3 text-xs text-amber-900">
            <div className="font-semibold flex items-center gap-1 mb-1">
              <AlertTriangle className="w-4 h-4" />
              중복 의심 {detail.duplicateCount}장 — 약품 데이터가 다른 사진과 70%+ 일치
            </div>
            <div className="text-amber-800 text-[11px]">
              영업사원이 같은 처방통계를 다른 각도로 두 번 찍었거나 옛 데이터 중복일 가능성. 사진 카드의 "중복 의심" 배지 클릭해서 비교 후 불필요한 사진 삭제.
            </div>
          </div>
        )}

        {/* 액션 — 선택된 사진들 또는 그룹 전체 */}
        <div className="flex flex-wrap gap-2 items-center">
          <Button onClick={() => handleSubmit("submit", "selected")}
            disabled={busy || selectedIds.size === 0}
            className="bg-green-600 hover:bg-green-700">
            <CheckCircle className="w-4 h-4 mr-1" />
            선택한 {selectedIds.size}장 제출완료로 마킹
          </Button>
          <Button onClick={() => setSelectedIds(new Set(detail.reports.map((r) => r.id)))}
            disabled={busy} variant="outline" size="sm">
            전체 선택
          </Button>
          <Button onClick={() => setSelectedIds(new Set())}
            disabled={busy || selectedIds.size === 0} variant="outline" size="sm">
            선택 해제
          </Button>
          <Button onClick={handleBulkDelete}
            disabled={busy || selectedIds.size === 0}
            variant="outline" size="sm"
            className="text-red-600 border-red-300 hover:bg-red-50">
            <Trash2 className="w-3.5 h-3.5 mr-1" />
            {bulkProgress?.label === "삭제" ? `삭제 중... ${bulkProgress.current}/${bulkProgress.total}`
              : `선택한 ${selectedIds.size}장 삭제`}
          </Button>
          {/* 처리 실패한 모든 사진 일괄 재분석 — ERROR row 가 있을 때만 노출 */}
          {detail.reports.filter((r) => r.status === "ERROR").length > 0 && (
            <Button onClick={handleBulkRetry}
              disabled={busy}
              variant="outline" size="sm"
              className="text-blue-700 border-blue-300 hover:bg-blue-50">
              {bulkProgress?.label === "재분석 요청"
                ? `재분석 ${bulkProgress.current}/${bulkProgress.total}`
                : `처리 실패 ${detail.reports.filter((r) => r.status === "ERROR").length}장 모두 다시 분석`}
            </Button>
          )}
          {/* 단가 0 (마스터 매칭 실패) 행 필터 — 검수자가 채워야 할 행만 빠르게 본다.
              매칭 실패 0 건이면 버튼 자체 숨김 (불필요한 UI) */}
          {priceMissingCount > 0 && (
            <Button onClick={() => setPriceMissingOnly((v) => !v)} variant="outline" size="sm"
              className={priceMissingOnly
                ? "bg-yellow-100 border-yellow-400 text-yellow-900 hover:bg-yellow-200"
                : "border-yellow-300 text-yellow-800 hover:bg-yellow-50"}>
              <Filter className="w-3.5 h-3.5 mr-1" />
              {priceMissingOnly ? `매칭 실패만 ${priceMissingCount}건 표시 중 (전체 보기)` : `단가 미입력 ${priceMissingCount}건만 보기`}
            </Button>
          )}
          {/* 검증대상(AI 재검 불일치) 행 필터 — Gemini 텍스트 자가검증으로 잡힌 행. 0 건이면 숨김. */}
          {(detail.metrics.selfValidateMismatchCount ?? 0) > 0 && (
            <Button onClick={() => setReviewOnly((v) => !v)} variant="outline" size="sm"
              className={reviewOnly
                ? "bg-amber-100 border-amber-400 text-amber-900 hover:bg-amber-200"
                : "border-amber-300 text-amber-800 hover:bg-amber-50"}>
              <Filter className="w-3.5 h-3.5 mr-1" />
              {reviewOnly
                ? `검증대상만 ${detail.metrics.selfValidateMismatchCount}건 표시 중 (전체 보기)`
                : `검증대상 ${detail.metrics.selfValidateMismatchCount}건만 보기`}
            </Button>
          )}
          <span className="ml-auto flex gap-2">
            {!detail.submitted ? (
              <Button onClick={() => handleSubmit("submit", "all")} disabled={busy} variant="outline" size="sm">
                전체 그룹을 한 번에 제출완료
              </Button>
            ) : (
              <Button onClick={() => handleSubmit("reopen", "all")} disabled={busy} variant="outline" size="sm">
                전체 그룹을 다시 검수 가능 상태로
              </Button>
            )}
          </span>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700 whitespace-pre-wrap">{error}</div>
        )}
        {bulkSuccess && (
          <div className="bg-green-50 border border-green-200 rounded p-3 text-xs text-green-800 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span className="font-semibold">{bulkSuccess}</span>
          </div>
        )}
        {bulkProgress && (
          <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-800 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
            <span className="font-semibold">
              {bulkProgress.label} 중... {bulkProgress.current}/{bulkProgress.total}
            </span>
            <div className="flex-1 ml-2 bg-blue-100 rounded-full h-1.5 overflow-hidden">
              <div className="bg-blue-600 h-full transition-all"
                style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }} />
            </div>
            <span className="text-[10px] text-blue-600">페이지 닫지 마세요</span>
          </div>
        )}

        {/* 사진 카드 리스트 — 좌측 사진 / 우측 편집 가능 표 */}
        <div className="space-y-4">
          {detail.reports.map((r) => (
            <ReviewPhotoCard
              key={r.id}
              report={r}
              busy={busy}
              clientName={detail.clientName ?? ""}
              year={detail.year}
              month={detail.month}
              selected={selectedIds.has(r.id)}
              onToggleSelect={() => toggleSelect(r.id)}
              onDelete={() => handleDelete(r.id)}
              duplicateMatches={detail.duplicateBy?.[r.id] ?? []}
              allReports={detail.reports}
              priceMissingOnly={priceMissingOnly}
              reviewOnly={reviewOnly}
              onSaved={async () => {
                // 저장 후 상세 재조회 (지표 갱신)
                if (selected) {
                  const res = await fetch(`/api/stats/submissions?clientId=${selected.clientId}&year=${selected.year}&month=${selected.month}`);
                  setDetail(await res.json());
                }
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  // ── 목록 화면 ──
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-2">
        <BarChart3 className="w-5 h-5 text-orange-500" />
        <h1 className="text-2xl font-bold text-gray-900">AI 처방통계 검수</h1>
      </div>
      <p className="text-sm text-gray-500 -mt-2">
        영업사원이 사진 등록한 거래처×월 그룹 목록. 행 수/정확도/매칭률/부분추출 지표를 보고
        검수, 사진 삭제, 제출완료 마킹. 제출완료된 그룹은 같은 거래처×월에 추가 업로드 불가.
      </p>

      {groupsLoading ? (
        <div className="text-center py-12 text-gray-400 inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> 그룹 목록 로딩 중...
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="text-center py-12 text-gray-400">아직 등록된 처방통계 사진이 없습니다.</div>
      ) : (
        <div className="space-y-2">
          {/* 일괄 액션 — ERROR 가 있는 그룹 1개라도 선택돼 있으면 활성 */}
          {filteredGroups.some((g) => (g.metrics.errorCount ?? 0) > 0) && (
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg flex-wrap">
              <button onClick={() => {
                const allErrorKeys = filteredGroups
                  .filter((g) => (g.metrics.errorCount ?? 0) > 0)
                  .map((g) => `${g.clientId}|${g.year}|${g.month}`);
                setSelectedGroupKeys(new Set(allErrorKeys));
              }}
                className="text-xs px-2 py-1 bg-white border border-gray-300 rounded hover:bg-gray-100">
                실패 있는 그룹 전체 선택
              </button>
              <button onClick={() => setSelectedGroupKeys(new Set())}
                disabled={selectedGroupKeys.size === 0}
                className="text-xs px-2 py-1 bg-white border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-40">
                선택 해제
              </button>
              <Button onClick={handleGroupBulkRetry}
                disabled={selectedGroupKeys.size === 0 || groupRetryBusy}
                size="sm"
                className="ml-auto bg-blue-600 hover:bg-blue-700">
                {groupRetryBusy ? "재분석 요청 중..." : `선택 ${selectedGroupKeys.size}개 그룹의 처리 실패 다시 분석`}
              </Button>
            </div>
          )}
          {filteredGroups.map((g) => {
            const groupKey = `${g.clientId}|${g.year}|${g.month}`;
            const isChecked = selectedGroupKeys.has(groupKey);
            const hasError = (g.metrics.errorCount ?? 0) > 0;
            return (
            <div key={groupKey}
              className="w-full bg-white border border-gray-200 rounded-lg p-4 hover:border-orange-300 transition-colors flex gap-3">
              {/* 체크박스 — ERROR 있는 그룹만 활성 */}
              <div className="pt-1">
                <input type="checkbox"
                  checked={isChecked}
                  disabled={!hasError}
                  onChange={(e) => {
                    setSelectedGroupKeys((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(groupKey); else next.delete(groupKey);
                      return next;
                    });
                  }}
                  className="w-4 h-4 rounded border-gray-300 disabled:opacity-30" />
              </div>
              <button
                onClick={() => setSelected({ clientId: g.clientId, year: g.year, month: g.month })}
                className="flex-1 text-left">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <h3 className="text-sm font-bold text-gray-900">{g.clientName}</h3>
                <span className="text-xs text-gray-500">{g.year}년 {g.month}월</span>
                {g.submitted ? (
                  <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-[10px] font-semibold">제출완료</span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-semibold">검수 대기</span>
                )}
                {(g.metrics.processingCount ?? 0) > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-semibold">
                    처리중 {g.metrics.processingCount}장
                  </span>
                )}
                {(g.metrics.errorCount ?? 0) > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-semibold">
                    실패 {g.metrics.errorCount}장
                  </span>
                )}
                <ChevronRight className="w-4 h-4 text-gray-400 ml-auto" />
              </div>
              {/* 업로드한 회원 — 한 그룹에 여러 명일 수 있어 모두 표시. 이름 없으면 이메일. */}
              {g.uploaders && g.uploaders.length > 0 && (
                <div className="flex items-center gap-1.5 mb-2 flex-wrap text-[11px] text-gray-500">
                  <span className="text-gray-400">업로드:</span>
                  {g.uploaders.map((u, i) => (
                    <span key={u.email} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-50 border border-gray-200">
                      <span className="font-medium text-gray-700">{u.name || u.email.split("@")[0]}</span>
                      {u.name && <span className="text-gray-400">· {u.email}</span>}
                      {!u.name && i === 0 && <span className="text-gray-400">@{u.email.split("@")[1]}</span>}
                    </span>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-6 gap-2">
                <MetricBadge label="사진" value={`${g.metrics.photoCount}장`} />
                <MetricBadge label="행" value={`${g.metrics.rowCount}건`} />
                <MetricBadge label="매출" value={`${g.metrics.totalFee.toLocaleString()}`} color="blue" />
                <MetricBadge label="정확도" value={`${g.metrics.avgConfidence}%`} color={confidenceColor(g.metrics.avgConfidence)} />
                <MetricBadge label="매칭률" value={`${g.metrics.masterMatchRate}%`} color={confidenceColor(g.metrics.masterMatchRate)} />
                <MetricBadge label="이슈" value={`${g.metrics.mismatchCount + g.metrics.partialExtractionCount}건`}
                  color={g.metrics.mismatchCount + g.metrics.partialExtractionCount > 0 ? "amber" : "gray"} />
              </div>
              </button>
            </div>
            );
          })}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700">{error}</div>
      )}
      {detailLoading && <div className="text-center py-4 text-xs text-gray-400">상세 로딩...</div>}
    </div>
  );
}

// 사진별 검수 카드 — 좌측 원본 사진(sticky) / 우측 편집 가능한 추출 표.
// 수정 후 저장 = DB update + 구글 시트 갱신 (옛 batchId 행 삭제 + 새 batchId append).
interface EditableDrugRow {
  insuranceCode: string;
  companyName: string;
  productName: string;
  quantity: string;
  unitPrice: number;
  totalPrice: number;
  totalPriceManual: boolean;
  matched: boolean;
  hasMismatch: boolean;
  // 행 단위 검증 — 0~100 점수 + 4개 check 결과. 표에서 색상/툴팁 강조.
  finalConfidence: number;
  priceCheckBad: boolean;        // priceMatch applicable && !matched
  revenueCheckBad: boolean;
  prefixCheckBad: boolean;
  // Gemini 가 추출한 행별 제약사와 마스터 매칭 제약사가 다른 경우. 검수에서 사람이 결정.
  companyNameMismatch: { geminiCompanyName: string; masterCompanyName: string } | null;
  // Case B 자동 교체 — 사용자가 약품명 편집 안 했지만 매칭값과 OCR 원본이 다른 경우.
  originalProductName: string;
  nameAutoReplaced: boolean;
  originalUnitPrice: number | null;       // OCR 원본 약가 (사진에서 읽은 값)
  priceAutoReplaced: boolean;              // 마스터DB 약가로 자동 교체됨
  // Gemini 자가검증 결과. "selfValidateMismatch" 면 노란 "검증대상" 마킹.
  reviewReason: string;
  validation: {
    mismatchFields: string[];
    suggestion: { productName?: string; insuranceCode?: string; unitPrice?: number };
  } | null;
  bbox: [number, number, number, number];        // 사진 highlight overlay 좌표
}

function ReviewPhotoCard({
  report,
  busy,
  clientName,
  year,
  month,
  selected,
  onToggleSelect,
  onDelete,
  onSaved,
  duplicateMatches,
  allReports,
  priceMissingOnly,
  reviewOnly,
}: {
  report: ReportRow;
  busy: boolean;
  clientName: string;
  year: number;
  month: number;
  selected: boolean;
  onToggleSelect: () => void;
  onDelete: () => void;
  onSaved: () => void | Promise<void>;
  duplicateMatches: Array<{ reportId: string; similarity: number }>;
  allReports: ReportRow[];
  priceMissingOnly: boolean;
  reviewOnly: boolean;
}) {
  // ADMIN 만 호버 툴팁(브라우저 native title 박스) 노출 — 일반 유저 노이즈 제거
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "ADMIN";
  const titleIfAdmin = (s: string | undefined): string | undefined => (isAdmin ? s : undefined);

  const initialDrugs = report.ocrData?.finalDrugs ?? [];

  const [rows, setRows] = useState<EditableDrugRow[]>(() =>
    initialDrugs.map((d) => {
      const qty = parseFloat(d.quantity ?? "0") || 0;
      const unit = d.unitPrice ?? 0;
      const bbox: [number, number, number, number] = Array.isArray(d.bbox) && d.bbox.length === 4
        ? [d.bbox[0], d.bbox[1], d.bbox[2], d.bbox[3]]
        : [0, 0, 0, 0];
      const q = d.qualityChecks;
      return {
        insuranceCode: d.insuranceCode ?? "",
        companyName: d.companyName ?? "",
        productName: d.productName ?? "",
        quantity: d.quantity ?? "",
        unitPrice: unit,
        totalPrice: d.totalPrice ?? Math.round(qty * unit),
        totalPriceManual: false,
        matched: !!d.matchedMedicationId,
        hasMismatch: d.mismatch != null,
        finalConfidence: typeof d.finalConfidence === "number" ? d.finalConfidence : 0,
        priceCheckBad: !!(q?.priceMatch?.applicable && q.priceMatch.matched === false),
        revenueCheckBad: !!(q?.revenueMatch?.applicable && q.revenueMatch.matched === false),
        prefixCheckBad: !!(q?.prefixMatch?.applicable && q.prefixMatch.matched === false),
        companyNameMismatch: d.companyNameMismatch?.geminiCompanyName && d.companyNameMismatch?.masterCompanyName
          ? {
              geminiCompanyName: d.companyNameMismatch.geminiCompanyName,
              masterCompanyName: d.companyNameMismatch.masterCompanyName,
            }
          : null,
        originalProductName: d.originalProductName ?? "",
        nameAutoReplaced: !!d.nameAutoReplaced,
        originalUnitPrice: d.originalUnitPrice ?? null,
        priceAutoReplaced: !!d.priceAutoReplaced,
        reviewReason: typeof d.reviewReason === "string" ? d.reviewReason : "",
        validation: d.validation
          ? {
              mismatchFields: Array.isArray(d.validation.mismatchFields) ? d.validation.mismatchFields : [],
              suggestion: d.validation.suggestion ?? {},
            }
          : null,
        bbox,
      };
    })
  );

  const [imgData, setImgData] = useState<string | null>(null);
  const [imgLoading, setImgLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [dirty, setDirty] = useState(false);
  // 사진 zoom — 1.0(원본) ~ 3.0(3배). + / - 버튼 또는 Cmd/Ctrl+휠.
  const [zoom, setZoom] = useState(1.0);
  // 키보드 화살표 행 이동용 — input ref dict, focusedIdx
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  // 사진 영역 스크롤 컨테이너 + img 요소 ref — focus 행 bbox 로 자동 스크롤
  const imgScrollRef = useRef<HTMLDivElement | null>(null);
  const imgElRef = useRef<HTMLImageElement | null>(null);
  // 표 영역 스크롤 컨테이너 — 키보드 화살표로 행 이동 시 표 안에서만 scroll
  // (페이지 전체 scroll 막아서 위쪽 사진 영역이 안 가려지게).
  const tableScrollRef = useRef<HTMLDivElement | null>(null);

  // 마우스 드래그로 사진 영역 panning — 확대 후 다른 영역 빠르게 보기.
  // mousedown 위치 기억 → mousemove 차이만큼 scrollLeft/scrollTop 역방향 이동.
  const dragStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  function onPanStart(e: React.MouseEvent<HTMLDivElement>) {
    if (!imgScrollRef.current) return;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: imgScrollRef.current.scrollLeft,
      scrollTop: imgScrollRef.current.scrollTop,
    };
    setIsDragging(true);
  }
  function onPanMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!dragStartRef.current || !imgScrollRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    imgScrollRef.current.scrollLeft = dragStartRef.current.scrollLeft - dx;
    imgScrollRef.current.scrollTop = dragStartRef.current.scrollTop - dy;
  }
  function onPanEnd() {
    dragStartRef.current = null;
    setIsDragging(false);
  }

  // focusedIdx 가 바뀌면 사진의 해당 bbox 가 보이도록 자동 스크롤
  useEffect(() => {
    if (focusedIdx === null) return;
    const bbox = rows[focusedIdx]?.bbox;
    if (!bbox || !bbox.some((v) => v > 0)) return;
    const scroller = imgScrollRef.current;
    const img = imgElRef.current;
    if (!scroller || !img) return;
    const centerY = ((bbox[1] + bbox[3]) / 2) * img.clientHeight * zoom;
    const targetTop = Math.max(0, centerY - scroller.clientHeight / 2);
    scroller.scrollTo({ top: targetTop, behavior: "smooth" });
  }, [focusedIdx, rows, zoom]);

  // Ctrl/Cmd + 마우스 휠로 zoom 조절. React onWheel 은 passive 라 preventDefault
  // 안 됨 → native listener 로 등록 필요. 휠 위치를 중심으로 확대해야 자연스러움.
  useEffect(() => {
    const scroller = imgScrollRef.current;
    if (!scroller) return;
    function handleWheel(e: WheelEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;     // Ctrl(Windows) 또는 Cmd(Mac) 만
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      setZoom((z) => Math.max(0.5, Math.min(4.0, Math.round((z + delta) * 100) / 100)));
    }
    scroller.addEventListener("wheel", handleWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", handleWheel);
  }, []);

  // 최후 안전망 — 표 영역 안에서 화살표 키 누르면 window scroll 위치 즉시 원복.
  // input preventDefault / capture phase 가 작동 안 한 케이스에서도 페이지가 안 움직이게.
  useEffect(() => {
    function lockScrollOnTableArrow(e: KeyboardEvent) {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      const target = e.target as Node | null;
      if (!target || !tableScrollRef.current) return;
      if (!tableScrollRef.current.contains(target)) return;
      const savedX = window.scrollX;
      const savedY = window.scrollY;
      requestAnimationFrame(() => {
        if (window.scrollX !== savedX || window.scrollY !== savedY) {
          window.scrollTo(savedX, savedY);
        }
      });
    }
    window.addEventListener("keydown", lockScrollOnTableArrow, true);
    return () => window.removeEventListener("keydown", lockScrollOnTableArrow, true);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, idx: number, field: string) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown" && e.key !== "Enter") return;
    // 3중 차단 — React preventDefault + native preventDefault + stopPropagation
    // 페이지 window scroll 절대 안 일어나게.
    e.preventDefault();
    e.stopPropagation();
    e.nativeEvent.preventDefault();
    const dir = e.key === "ArrowUp" ? -1 : 1;
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= rows.length) return;
    const target = inputRefs.current[`${nextIdx}:${field}`];
    if (!target) return;
    // preventScroll: true — focus 호출 시 브라우저 native auto-scroll 차단.
    // 이걸 빼면 페이지 window 자체가 scroll 되어 상단 사진 영역이 위로 밀려남.
    target.focus({ preventScroll: true });
    target.select();
    // 표 wrapper 안에서만 scroll — 페이지 전체는 안 움직임 (사진 영역 가려짐 방지).
    // 다음 input 이 wrapper viewport 밖일 때만 scroll, 안에 있으면 그대로.
    const scroller = tableScrollRef.current;
    if (scroller) {
      const targetRect = target.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const visibleTop = targetRect.top >= scrollerRect.top + 24;            // 24px sticky header 여유
      const visibleBottom = targetRect.bottom <= scrollerRect.bottom - 8;
      if (!visibleTop || !visibleBottom) {
        const relativeY = targetRect.top - scrollerRect.top + scroller.scrollTop;
        const desiredTop = relativeY - scroller.clientHeight / 2 + target.clientHeight / 2;
        scroller.scrollTo({ top: Math.max(0, desiredTop), behavior: "smooth" });
      }
    }
    setFocusedIdx(nextIdx);
  }

  // 사진 로드 — submissions API 의 hasImage 가 imageKey 만 봐서 false negative 가능.
  // 무조건 fetch 시도 후 응답에서 판단 (imageData 가 null 이면 그제서야 "없음" 표시).
  useEffect(() => {
    setImgLoading(true);
    fetch(`/api/files/prescription-report/${report.id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d: { imageData?: string } | null) => setImgData(d?.imageData ?? null))
      .catch(() => setImgData(null))
      .finally(() => setImgLoading(false));
  }, [report.id]);

  const totalRevenue = rows.reduce((s, r) => s + (Number(r.totalPrice) || 0), 0);

  // 제약사별 매출 합계 (실시간)
  const byCompany = useMemo(() => {
    const m = new Map<string, { revenue: number; rowCount: number }>();
    for (const r of rows) {
      const name = (r.companyName || "(미분류)").trim();
      const prev = m.get(name) ?? { revenue: 0, rowCount: 0 };
      prev.revenue += Number(r.totalPrice) || 0;
      prev.rowCount += 1;
      m.set(name, prev);
    }
    return Array.from(m.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [rows]);

  function updateRow(i: number, patch: Partial<EditableDrugRow>) {
    setRows((prev) => prev.map((r, idx) => {
      if (idx !== i) return r;
      const next: EditableDrugRow = { ...r, ...patch };
      if (!next.totalPriceManual && (patch.quantity !== undefined || patch.unitPrice !== undefined)) {
        const qty = parseFloat(next.quantity) || 0;
        next.totalPrice = Math.round(qty * next.unitPrice);
      }
      // 검증대상으로 마킹됐던 행을 검수자가 보험코드/약품명/단가 중 하나라도 직접 편집하면
      // 그 신호 자체를 클리어 (서버 저장 시에도 finalDrugs 재구성으로 사라짐. UI 도 즉시 노란 제거).
      const userTouchedValidatedField =
        patch.insuranceCode !== undefined || patch.productName !== undefined || patch.unitPrice !== undefined;
      if (userTouchedValidatedField && r.reviewReason === "selfValidateMismatch") {
        next.reviewReason = "";
        next.validation = null;
      }
      return next;
    }));
    setDirty(true);
  }

  function addRow() {
    setRows((prev) => [...prev, {
      insuranceCode: "", companyName: "", productName: "", quantity: "0",
      unitPrice: 0, totalPrice: 0, totalPriceManual: false, matched: false, hasMismatch: false,
      finalConfidence: 0,
      priceCheckBad: false,
      revenueCheckBad: false,
      prefixCheckBad: false,
      companyNameMismatch: null,
      originalProductName: "",
      nameAutoReplaced: false,
      originalUnitPrice: null,
      priceAutoReplaced: false,
      reviewReason: "",
      validation: null,
      bbox: [0, 0, 0, 0],
    }]);
    setDirty(true);
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch("/api/stats/photo-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportId: report.id,
          rows: rows.map((r) => ({
            insuranceCode: r.insuranceCode,
            companyName: r.companyName,
            productName: r.productName,
            quantity: r.quantity,
            unitPrice: r.unitPrice,
            totalPrice: r.totalPrice,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error || `HTTP ${res.status}`);
        return;
      }
      setDirty(false);
      if (data.sheetWarning) {
        setSaveError(`저장됨 (DB ✅) — 시트 갱신은 실패: ${data.sheetWarning}`);
      }
      await onSaved();
    } catch (e) {
      setSaveError(`저장 실패: ${String(e).slice(0, 200)}`);
    } finally {
      setSaving(false);
    }
  }

  const detected = report.ocrData?.geminiMeta?.summary?.drugCount ?? 0;
  const partial = detected > 0 && detected !== rows.length;
  const mismatchCount = rows.filter((r) => r.hasMismatch).length;
  const matchedCount = rows.filter((r) => r.matched).length;
  // 단가 0 = 마스터 매칭 실패 OR 비급여 — 검수자가 직접 채워야 할 행
  const priceMissingCount = rows.filter((r) => r.unitPrice === 0).length;
  // 검증 강화 (A) — 행 단위 품질 지표
  const lowQualityCount = rows.filter((r) => r.finalConfidence > 0 && r.finalConfidence < 75).length;
  const priceMismatchCount = rows.filter((r) => r.priceCheckBad).length;
  const revenueMismatchCount = rows.filter((r) => r.revenueCheckBad).length;
  const companyMismatchCount = rows.filter((r) => r.companyNameMismatch != null).length;
  // 사진 단위 합계 검증
  const sumCheck = report.ocrData?.totalSumCheck;
  const sumCheckBad = !!(sumCheck?.applicable && sumCheck?.matched === false);

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      {/* 헤더 — 체크박스 + 거래처/월 + 메타 */}
      <div className="flex items-center gap-3 px-4 py-2 border-b bg-gray-50 flex-wrap">
        <input type="checkbox" checked={selected} onChange={onToggleSelect}
          className="w-4 h-4 accent-orange-600 cursor-pointer"
          title="선택해서 일괄 제출완료 마킹용" />
        <span className="text-xs font-bold text-gray-800">{clientName} · {year}년 {month}월</span>
        <span className="text-xs text-gray-400">|</span>
        <span className="text-xs text-gray-500">{new Date(report.createdAt).toLocaleString()}</span>
        <span className="text-xs font-semibold">{report.companyName || "(제약사 미상)"}</span>
        {(report.ocrData?.companiesInPhoto?.length ?? 0) > 1 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 border border-purple-300 font-semibold"
            title={titleIfAdmin(`행별 제약사: ${report.ocrData?.companiesInPhoto?.join(", ")}`)}>
            N제약사 {report.ocrData?.companiesInPhoto?.length}곳
          </span>
        )}
        <span className="text-xs text-gray-500">· {rows.length}건 · {totalRevenue.toLocaleString()}원</span>
        {report.status === "SUBMITTED" && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-300 font-semibold">
            제출완료
          </span>
        )}
        {report.status === "PROCESSING" && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 border border-blue-300 font-semibold flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />처리중
          </span>
        )}
        {report.status === "ERROR" && (
          <>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-300 font-semibold"
              title={titleIfAdmin((report.ocrData as { error?: string })?.error ?? "처리 실패")}>
              처리 실패 ⓘ
            </span>
            <button onClick={async () => {
              const res = await fetch("/api/stats/photo-retry", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reportId: report.id }),
              });
              if (res.ok) {
                alert("다시 분석을 시작했어요. 잠시 후 새로고침하면 결과를 볼 수 있어요.");
                onSaved();
              } else {
                const d = await res.json().catch(() => ({}));
                alert(`재분석 실패: ${d.error || res.status}`);
              }
            }}
              disabled={busy || saving}
              className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-300 font-semibold hover:bg-blue-100 disabled:opacity-50">
              다시 분석
            </button>
          </>
        )}
        {report.status === "PROCESSING" && (report.ocrData as { retryCount?: number })?.retryCount !== undefined && (
          <span className="text-[10px] text-amber-700">재분석 중...</span>
        )}
        {/* 중복 의심 — 같은 그룹 다른 사진과 약품 70%+ 일치 */}
        {duplicateMatches.length > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 font-semibold"
            title={titleIfAdmin(duplicateMatches.map((m) => {
              const other = allReports.find((rr) => rr.id === m.reportId);
              const otherIdx = allReports.findIndex((rr) => rr.id === m.reportId);
              const label = other ? `사진 #${otherIdx + 1} (${new Date(other.createdAt).toLocaleString()})` : m.reportId.slice(0, 8);
              return `${label} 와 ${m.similarity}% 일치`;
            }).join("\n"))}>
            ⚠ 중복 의심 {duplicateMatches[0].similarity}%
            {duplicateMatches.length > 1 && ` (+${duplicateMatches.length - 1})`}
          </span>
        )}
        {partial && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
            <AlertTriangle className="w-3 h-3 inline mr-0.5" />부분추출 {detected}→{rows.length}
          </span>
        )}
        {mismatchCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-300">
            불일치 {mismatchCount}
          </span>
        )}
        {priceMissingCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800 border border-yellow-400 font-semibold"
            title="단가 0 — 보험코드 마스터 매칭 실패 또는 비급여. 표에서 직접 단가 입력 필요.">
            💰 단가 미입력 {priceMissingCount}
          </span>
        )}
        {/* 검증 강화 (A) 배지 — 행별 검사 결과 요약 */}
        {lowQualityCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-300"
            title="finalConfidence < 75 (점수가 낮은 행). 표에서 ◯ 색상이 빨강인 행 확인.">
            낮은 점수 {lowQualityCount}
          </span>
        )}
        {(priceMismatchCount + revenueMismatchCount) > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300"
            title="단가/매출 검증 실패 행. 마스터 단가나 수량×단가=매출 등식이 안 맞음.">
            단가/매출 ❌ {priceMismatchCount + revenueMismatchCount}
          </span>
        )}
        {companyMismatchCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 border border-purple-300"
            title="Gemini 가 추출한 제약사와 마스터 매칭 제약사가 다른 행. 사진 보고 사람이 결정 필요.">
            제약사 불일치 {companyMismatchCount}
          </span>
        )}
        {sumCheckBad && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 border border-orange-300"
            title={titleIfAdmin(`사진 합계 검증 실패: ${sumCheck?.detail ?? ""}`)}>
            합계 ❌
          </span>
        )}
        <span className="text-[10px] text-gray-400 ml-auto">매칭 {matchedCount}/{rows.length}</span>
        {report.ocrData?.sheetUrl && (
          <a href={report.ocrData.sheetUrl} target="_blank" rel="noreferrer"
            className="text-[10px] text-blue-600 hover:underline inline-flex items-center gap-0.5">
            시트 <ExternalLink className="w-3 h-3" />
          </a>
        )}
        <button onClick={onDelete} disabled={busy || saving}
          className="text-red-400 hover:text-red-600" title="이 사진 + 추출 데이터 삭제 (Storage 파일 포함)">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 상하 분할 — 위에 사진 (45vh) / 아래에 편집 표 (45vh) — 한 viewport 안에 둘 다 보임 */}
      <div className="flex flex-col">
        {/* 위: 사진 + zoom 컨트롤 */}
        <div className="bg-gray-100 border-b border-gray-200">
          {/* zoom 컨트롤 바 */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-white">
            <button onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} disabled={!imgData}
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-30" title="축소">
              <ZoomOut className="w-4 h-4 text-gray-600" />
            </button>
            <span className="text-xs text-gray-600 font-mono w-12 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button onClick={() => setZoom((z) => Math.min(4.0, z + 0.25))} disabled={!imgData}
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-30" title="확대">
              <ZoomIn className="w-4 h-4 text-gray-600" />
            </button>
            <button onClick={() => setZoom(1.0)} disabled={!imgData || zoom === 1.0}
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-30" title="원본 크기">
              <Maximize2 className="w-4 h-4 text-gray-600" />
            </button>
            <span className="text-[10px] text-gray-400 ml-2">
              + / − 버튼, <kbd className="px-1 border border-gray-300 rounded text-[9px]">Ctrl</kbd>+휠 줌, 드래그 이동
            </span>
            {imgData && (
              <button onClick={async () => {
                // dataUri 가 크면 브라우저가 새 탭에서 직접 못 엶 → blob URL 변환
                try {
                  const blob = await (await fetch(imgData)).blob();
                  const url = URL.createObjectURL(blob);
                  window.open(url, "_blank");
                  setTimeout(() => URL.revokeObjectURL(url), 60_000);
                } catch (e) {
                  alert(`새 탭 열기 실패: ${String(e).slice(0, 200)}`);
                }
              }}
                className="ml-auto text-[11px] text-blue-600 hover:underline cursor-pointer">
                새 탭 확대
              </button>
            )}
          </div>

          {/* 사진 영역 — overflow scroll for zoom + drag panning + bbox highlight */}
          <div ref={imgScrollRef}
            onMouseDown={onPanStart}
            onMouseMove={onPanMove}
            onMouseUp={onPanEnd}
            onMouseLeave={onPanEnd}
            style={{ cursor: imgData ? (isDragging ? "grabbing" : "grab") : "default" }}
            className="p-3 overflow-auto max-h-[45vh] select-none">
            {imgLoading ? (
              <div className="aspect-[3/4] flex items-center justify-center text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : imgData ? (
              <div className="relative inline-block"
                style={{ transform: `scale(${zoom})`, transformOrigin: "top left", transition: "transform 0.15s" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img ref={imgElRef} src={imgData} alt="원본 사진"
                  draggable={false}
                  className="max-w-none rounded shadow block pointer-events-none" />
                {/* bbox highlight — focused row 의 좌표를 사진 위에 노란 박스로.
                    옛 데이터엔 bbox 없어서 [0,0,0,0] → 안 그림. 새 업로드부터 작동. */}
                {focusedIdx !== null && rows[focusedIdx]?.bbox && rows[focusedIdx].bbox.some((v) => v > 0) && (
                  <div
                    className="absolute border-2 border-yellow-400 bg-yellow-300/20 pointer-events-none transition-all duration-150"
                    style={{
                      left: `${rows[focusedIdx].bbox[0] * 100}%`,
                      top: `${rows[focusedIdx].bbox[1] * 100}%`,
                      width: `${(rows[focusedIdx].bbox[2] - rows[focusedIdx].bbox[0]) * 100}%`,
                      height: `${(rows[focusedIdx].bbox[3] - rows[focusedIdx].bbox[1]) * 100}%`,
                    }}
                  />
                )}
              </div>
            ) : (
              <div className="aspect-[3/4] flex items-center justify-center text-gray-400 text-xs">
                원본 사진 없음
              </div>
            )}
          </div>

          {/* bbox 없는 옛 데이터 안내 */}
          {imgData && focusedIdx !== null && rows[focusedIdx]?.bbox &&
           !rows[focusedIdx].bbox.some((v) => v > 0) && (
            <div className="bg-amber-50 border-t border-amber-200 px-3 py-1.5 text-[11px] text-amber-800">
              ⓘ 이 사진은 bbox(좌표 정보) 없이 저장된 옛 데이터라 사진 위 자동 강조 표시 안 됨. 새로 업로드한 사진부터 작동.
            </div>
          )}
        </div>

        {/* 아래: 편집 가능 표 — ref 잡아서 키보드 화살표 시 표 안에서만 scroll.
            onKeyDownCapture — capture phase 에서 한 번 더 ArrowUp/Down default 차단. */}
        <div ref={tableScrollRef} className="overflow-auto max-h-[45vh]"
          onKeyDownCapture={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
            }
          }}>
          <table className="w-full text-[10px] [&_input]:text-[10px] [&_input]:px-0.5 [&_input]:py-0 [&_input]:h-5 [&_input]:focus:outline-none [&_input]:focus:ring-1 [&_input]:focus:ring-orange-300 [&_td]:py-0 [&_th]:py-1">
            <thead className="bg-gray-50 text-gray-500 sticky top-0 z-10">
              <tr>
                <th className="text-left px-2 py-1.5 w-[110px]">보험코드</th>
                <th className="text-left px-2 py-1.5 w-[110px]">제약사</th>
                <th className="text-left px-2 py-1.5">제품명</th>
                <th className="text-right px-2 py-1.5 w-[72px]">수량</th>
                <th className="text-right px-2 py-1.5 w-[80px]">단가</th>
                <th className="text-right px-2 py-1.5 w-[100px]">매출</th>
                <th className="w-7"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d, i) => {
                // 강조 우선순위 (검증 강화 후):
                //   mismatch (코드↔이름) || companyName 불일치 → red (사람 확인 필요)
                //   focused                                      → orange
                //   selfValidateMismatch (AI 자가검증)            → amber (Gemini 텍스트가 OCR 과 다르다고 판단)
                //   price/revenue/prefix check 실패              → yellow (자동 검증 실패)
                //   단가 0 (마스터 미매칭)                       → yellow
                const qualityBad = d.priceCheckBad || d.revenueCheckBad || d.prefixCheckBad;
                const isSelfValidateMismatch = d.reviewReason === "selfValidateMismatch";
                const rowClass = (d.hasMismatch || d.companyNameMismatch != null)
                  ? "bg-red-50"
                  : focusedIdx === i
                  ? "bg-orange-50"
                  : isSelfValidateMismatch
                  ? "bg-amber-50 border-l-2 border-amber-400"
                  : qualityBad
                  ? "bg-yellow-50"
                  : d.unitPrice === 0
                  ? "bg-yellow-50"
                  : "";
                const tooltipParts: string[] = [];
                if (d.finalConfidence > 0) tooltipParts.push(`점수 ${d.finalConfidence}/100`);
                if (d.prefixCheckBad) tooltipParts.push("약품명 prefix 불일치");
                if (d.priceCheckBad) tooltipParts.push("단가 검증 실패");
                if (d.revenueCheckBad) tooltipParts.push("매출=수량×단가 검증 실패");
                if (d.companyNameMismatch) tooltipParts.push(`제약사 불일치: ${d.companyNameMismatch.geminiCompanyName} vs ${d.companyNameMismatch.masterCompanyName}`);
                if (isSelfValidateMismatch) tooltipParts.push("AI 자가검증 불일치 — 검수 필요");
                const scoreTooltip = tooltipParts.join(" · ") || "검증 데이터 없음";
                // 필터: priceMissingOnly + reviewOnly 두 토글 — 둘 다 활성화면 둘 중 하나라도 매칭되는 행만 표시 (OR).
                const matchesPriceFilter = !priceMissingOnly || d.unitPrice === 0;
                const matchesReviewFilter = !reviewOnly || isSelfValidateMismatch;
                const hiddenByFilter = !(matchesPriceFilter && matchesReviewFilter);
                return (
                  <tr key={i} className={`border-t ${rowClass} ${hiddenByFilter ? "hidden" : ""}`}>
                    <td className="px-1 py-0">
                      <div className="flex items-center gap-1">
                        <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${scoreDotClass(d.finalConfidence)}`}
                          title={titleIfAdmin(scoreTooltip)} />
                        <input ref={(el) => { inputRefs.current[`${i}:insuranceCode`] = el; }}
                          value={d.insuranceCode}
                          onChange={(e) => updateRow(i, { insuranceCode: e.target.value })}
                          onFocus={() => setFocusedIdx(i)}
                          onKeyDown={(e) => handleKeyDown(e, i, "insuranceCode")}
                          className="w-full px-1 py-0.5 border rounded text-[11px] font-mono"/>
                      </div>
                    </td>
                    <td className="px-1 py-0">
                      <div className="flex items-center gap-1">
                        <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${companyColor(d.companyName)}`}
                          title={titleIfAdmin(d.companyNameMismatch
                            ? `Gemini "${d.companyNameMismatch.geminiCompanyName}" vs 마스터 "${d.companyNameMismatch.masterCompanyName}"`
                            : (d.companyName || "(제약사 미상)"))} />
                        <input ref={(el) => { inputRefs.current[`${i}:companyName`] = el; }}
                          value={d.companyName}
                          onChange={(e) => updateRow(i, { companyName: e.target.value })}
                          onFocus={() => setFocusedIdx(i)}
                          onKeyDown={(e) => handleKeyDown(e, i, "companyName")}
                          className={`w-full px-1 py-0.5 border rounded text-[11px] ${d.companyNameMismatch ? "border-red-400 bg-red-50" : ""}`}/>
                      </div>
                    </td>
                    <td className="px-1 py-0">
                      <div className="relative">
                        {(() => {
                          // 우선순위: 파랑 (자동교체) > 노랑 (AI 검증대상) — User Advocate 색상 중첩 가드.
                          // hasMismatch 인 row 는 row 전체가 빨강이므로 셀 배지는 안 띄움.
                          const showAiBadge = d.nameAutoReplaced && d.originalProductName && d.originalProductName !== d.productName;
                          const showReviewBadge = !showAiBadge && isSelfValidateMismatch;
                          const sg = d.validation?.suggestion;
                          const mf = d.validation?.mismatchFields ?? [];
                          // 어긋난 필드만 호버에 노출 — suggestion 의 다른 필드가 PASS 였는데 같이 보이면 검수자 혼란 (QA E2 fix).
                          const reviewTooltip = showReviewBadge
                            ? [
                                "AI 자가검증 — 검증대상으로 마킹됨",
                                mf.includes("productName") && sg?.productName ? `제미나이 추정 약품명: ${sg.productName}` : null,
                                mf.includes("insuranceCode") && sg?.insuranceCode ? `제미나이 추정 보험코드: ${sg.insuranceCode}` : null,
                                mf.includes("unitPrice") && sg?.unitPrice ? `제미나이 추정 약가: ${sg.unitPrice.toLocaleString()}원` : null,
                                "셀을 수정하면 이 표시는 사라집니다.",
                              ].filter(Boolean).join("\n")
                            : undefined;
                          const autoReplaceTooltip = showAiBadge
                            ? `자동 교체됨\nOCR 원본: ${d.originalProductName}\n→ 마스터: ${d.productName}\n(보험코드 매칭으로 교정)`
                            : undefined;
                          return (
                            <>
                              <input ref={(el) => { inputRefs.current[`${i}:productName`] = el; }}
                                value={d.productName}
                                onChange={(e) => updateRow(i, { productName: e.target.value, nameAutoReplaced: false })}
                                onFocus={() => setFocusedIdx(i)}
                                onKeyDown={(e) => handleKeyDown(e, i, "productName")}
                                title={titleIfAdmin(autoReplaceTooltip ?? reviewTooltip)}
                                className={`w-full px-1 py-0.5 border rounded text-[11px] ${
                                  showAiBadge ? "pr-7 bg-blue-50 border-blue-300"
                                  : showReviewBadge ? "pr-12 bg-amber-50 border-amber-400"
                                  : ""
                                }`}/>
                              {showAiBadge && (
                                <span className="absolute right-0.5 top-1/2 -translate-y-1/2 text-[8px] font-bold text-blue-700 bg-blue-100 px-1 py-0.5 rounded pointer-events-none">AI</span>
                              )}
                              {showReviewBadge && (
                                <span className="absolute right-0.5 top-1/2 -translate-y-1/2 text-[8px] font-bold text-amber-800 bg-amber-200 px-1 py-0.5 rounded pointer-events-none">검증대상</span>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="px-1 py-0">
                      <input ref={(el) => { inputRefs.current[`${i}:quantity`] = el; }}
                        type="number" step="0.1" value={d.quantity}
                        onChange={(e) => updateRow(i, { quantity: e.target.value })}
                        onFocus={() => setFocusedIdx(i)}
                        onKeyDown={(e) => handleKeyDown(e, i, "quantity")}
                        className="w-full px-1 py-0.5 border rounded text-[11px] text-right"/>
                    </td>
                    <td className="px-1 py-0">
                      <div className="flex items-center gap-1">
                        {(() => {
                          // 단가 신호등 dot:
                          //   회색 — OCR 그대로 (수정 안 됨)
                          //   파란 — 마스터DB 약가로 자동 교체됨 (priceAutoReplaced)
                          //   주황 — 검수자가 수동 수정 (현재 값이 OCR 원본 및 마스터 둘 다와 다름)
                          const ocr = d.originalUnitPrice;
                          const cur = d.unitPrice;
                          const dotColor = ocr === null || ocr === cur
                            ? "bg-gray-300"
                            : d.priceAutoReplaced && cur !== ocr && !d.totalPriceManual
                              ? "bg-blue-500"
                              : "bg-amber-500";
                          const dotTitle = ocr === null || ocr === cur
                            ? "수정 없음"
                            : d.priceAutoReplaced
                              ? `자동 교체: OCR ${ocr} → 마스터 ${cur}`
                              : `수정됨: OCR ${ocr} → 현재 ${cur}`;
                          return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${dotColor}`}
                            title={titleIfAdmin(dotTitle)} />;
                        })()}
                        <input ref={(el) => { inputRefs.current[`${i}:unitPrice`] = el; }}
                          type="number" value={d.unitPrice}
                          onChange={(e) => updateRow(i, { unitPrice: Number(e.target.value) })}
                          onFocus={() => setFocusedIdx(i)}
                          onKeyDown={(e) => handleKeyDown(e, i, "unitPrice")}
                          className="w-full px-1 py-0.5 border rounded text-[11px] text-right"/>
                      </div>
                    </td>
                    <td className="px-1 py-0">
                      <input ref={(el) => { inputRefs.current[`${i}:totalPrice`] = el; }}
                        type="number" value={d.totalPrice}
                        onChange={(e) => updateRow(i, { totalPrice: Number(e.target.value), totalPriceManual: true })}
                        onFocus={() => setFocusedIdx(i)}
                        onKeyDown={(e) => handleKeyDown(e, i, "totalPrice")}
                        className="w-full px-1 py-0.5 border rounded text-[11px] text-right"/>
                    </td>
                    <td className="px-1 py-0.5 text-center">
                      <button onClick={() => removeRow(i)} className="text-gray-300 hover:text-red-500" title="행 삭제">
                        <Trash2 className="w-3 h-3"/>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 하단: 제약사별 합계 + 저장 */}
      <div className="border-t bg-gray-50 px-4 py-3 space-y-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={addRow} className="text-xs" disabled={saving}>
            <Plus className="w-3.5 h-3.5 mr-1"/>행 추가
          </Button>
          <span className="text-[10px] text-gray-400">매출 = 수량 × 단가 자동. 직접 수정 가능.</span>
          <Button onClick={handleSave} disabled={saving || !dirty} className="ml-auto bg-orange-600 hover:bg-orange-700">
            <Save className="w-3.5 h-3.5 mr-1"/>
            {saving ? "저장 중..." : dirty ? "저장 (DB + 시트)" : "변경 없음"}
          </Button>
        </div>

        {/* 제약사별 합계 */}
        <div className="flex flex-wrap gap-2 text-[11px]">
          {byCompany.map((c) => (
            <span key={c.name} className="px-2 py-0.5 bg-white border border-gray-200 rounded">
              <span className="text-gray-700">{c.name}</span>
              <span className="text-gray-400 ml-1">{c.rowCount}건</span>
              <span className="text-gray-800 font-semibold ml-1">{c.revenue.toLocaleString()}원</span>
            </span>
          ))}
          <span className="ml-auto px-2 py-0.5 bg-orange-100 text-orange-900 font-bold rounded">
            총 {totalRevenue.toLocaleString()}원
          </span>
        </div>

        {saveError && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">
            {saveError}
          </div>
        )}
      </div>
    </div>
  );
}
