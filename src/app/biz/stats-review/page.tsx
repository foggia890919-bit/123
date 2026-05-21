"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle, AlertTriangle, ExternalLink, Trash2, ChevronRight, ArrowLeft, BarChart3, Loader2, Plus, Save, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { useRef } from "react";
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
}

interface GroupListItem {
  clientId: string;
  clientName: string;
  year: number;
  month: number;
  submitted: boolean;
  latestAt: string;
  metrics: Metrics;
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
      matchedMedicationId?: string | null;
      mismatch?: unknown;
      bbox?: [number, number, number, number];
    }>;
    avgConfidence?: number;
    sheetUrl?: string;
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

export default function StatsReviewPage() {
  const [groups, setGroups] = useState<GroupListItem[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [selected, setSelected] = useState<{ clientId: string; year: number; month: number } | null>(null);
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // 사진별 선택 — 체크박스로 토글, "선택한 N장 제출완료" 일괄 적용
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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
          <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700">{error}</div>
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
          {filteredGroups.map((g) => (
            <button key={`${g.clientId}|${g.year}|${g.month}`}
              onClick={() => setSelected({ clientId: g.clientId, year: g.year, month: g.month })}
              className="w-full bg-white border border-gray-200 rounded-lg p-4 text-left hover:border-orange-300 transition-colors">
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
          ))}
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
}) {
  const initialDrugs = report.ocrData?.finalDrugs ?? [];

  const [rows, setRows] = useState<EditableDrugRow[]>(() =>
    initialDrugs.map((d) => {
      const qty = parseFloat(d.quantity ?? "0") || 0;
      const unit = d.unitPrice ?? 0;
      const bbox: [number, number, number, number] = Array.isArray(d.bbox) && d.bbox.length === 4
        ? [d.bbox[0], d.bbox[1], d.bbox[2], d.bbox[3]]
        : [0, 0, 0, 0];
      return {
        insuranceCode: d.insuranceCode ?? "",
        companyName: d.companyName ?? "",
        productName: d.productName ?? "",
        quantity: d.quantity ?? "",
        unitPrice: unit,
        totalPrice: Math.round(qty * unit),
        totalPriceManual: false,
        matched: !!d.matchedMedicationId,
        hasMismatch: d.mismatch != null,
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
    // bbox 의 중심 Y 비율 × 사진 픽셀 높이 × zoom = 스크롤 목표 위치
    const centerY = ((bbox[1] + bbox[3]) / 2) * img.clientHeight * zoom;
    const targetTop = Math.max(0, centerY - scroller.clientHeight / 2);
    scroller.scrollTo({ top: targetTop, behavior: "smooth" });
  }, [focusedIdx, rows, zoom]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, idx: number, field: string) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown" && e.key !== "Enter") return;
    e.preventDefault();
    const dir = e.key === "ArrowUp" ? -1 : 1;
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= rows.length) return;
    const target = inputRefs.current[`${nextIdx}:${field}`];
    target?.focus();
    target?.select();
    if (target) {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
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
      return next;
    }));
    setDirty(true);
  }

  function addRow() {
    setRows((prev) => [...prev, {
      insuranceCode: "", companyName: "", productName: "", quantity: "0",
      unitPrice: 0, totalPrice: 0, totalPriceManual: false, matched: false, hasMismatch: false,
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
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-300 font-semibold"
            title={(report.ocrData as { error?: string })?.error ?? "처리 실패"}>
            처리 실패 ⓘ
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

      {/* 상하 분할 — 위에 사진 (60vh) / 아래에 편집 표 (스크롤) */}
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
              + / − 줌, 확대 후 사진 드래그로 이동
            </span>
            {imgData && (
              <a href={imgData} target="_blank" rel="noreferrer"
                className="ml-auto text-[11px] text-blue-600 hover:underline">
                새 탭 확대
              </a>
            )}
          </div>

          {/* 사진 영역 — overflow scroll for zoom + drag panning + bbox highlight */}
          <div ref={imgScrollRef}
            onMouseDown={onPanStart}
            onMouseMove={onPanMove}
            onMouseUp={onPanEnd}
            onMouseLeave={onPanEnd}
            style={{ cursor: imgData ? (isDragging ? "grabbing" : "grab") : "default" }}
            className="p-3 overflow-auto max-h-[60vh] select-none">
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

        {/* 아래: 편집 가능 표 */}
        <div className="overflow-auto max-h-[55vh]">
          <table className="w-full text-xs">
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
                const rowClass = d.hasMismatch
                  ? "bg-red-50"
                  : focusedIdx === i
                  ? "bg-orange-50"
                  : "";
                return (
                  <tr key={i} className={`border-t ${rowClass}`}>
                    <td className="px-1 py-0.5">
                      <input ref={(el) => { inputRefs.current[`${i}:insuranceCode`] = el; }}
                        value={d.insuranceCode}
                        onChange={(e) => updateRow(i, { insuranceCode: e.target.value })}
                        onFocus={() => setFocusedIdx(i)}
                        onKeyDown={(e) => handleKeyDown(e, i, "insuranceCode")}
                        className="w-full px-1 py-0.5 border rounded text-[11px] font-mono"/>
                    </td>
                    <td className="px-1 py-0.5">
                      <input ref={(el) => { inputRefs.current[`${i}:companyName`] = el; }}
                        value={d.companyName}
                        onChange={(e) => updateRow(i, { companyName: e.target.value })}
                        onFocus={() => setFocusedIdx(i)}
                        onKeyDown={(e) => handleKeyDown(e, i, "companyName")}
                        className="w-full px-1 py-0.5 border rounded text-[11px]"/>
                    </td>
                    <td className="px-1 py-0.5">
                      <input ref={(el) => { inputRefs.current[`${i}:productName`] = el; }}
                        value={d.productName}
                        onChange={(e) => updateRow(i, { productName: e.target.value })}
                        onFocus={() => setFocusedIdx(i)}
                        onKeyDown={(e) => handleKeyDown(e, i, "productName")}
                        className="w-full px-1 py-0.5 border rounded text-[11px]"/>
                    </td>
                    <td className="px-1 py-0.5">
                      <input ref={(el) => { inputRefs.current[`${i}:quantity`] = el; }}
                        type="number" step="0.1" value={d.quantity}
                        onChange={(e) => updateRow(i, { quantity: e.target.value })}
                        onFocus={() => setFocusedIdx(i)}
                        onKeyDown={(e) => handleKeyDown(e, i, "quantity")}
                        className="w-full px-1 py-0.5 border rounded text-[11px] text-right"/>
                    </td>
                    <td className="px-1 py-0.5">
                      <input ref={(el) => { inputRefs.current[`${i}:unitPrice`] = el; }}
                        type="number" value={d.unitPrice}
                        onChange={(e) => updateRow(i, { unitPrice: Number(e.target.value) })}
                        onFocus={() => setFocusedIdx(i)}
                        onKeyDown={(e) => handleKeyDown(e, i, "unitPrice")}
                        className="w-full px-1 py-0.5 border rounded text-[11px] text-right"/>
                    </td>
                    <td className="px-1 py-0.5">
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
