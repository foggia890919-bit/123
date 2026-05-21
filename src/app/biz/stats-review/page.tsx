"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle, AlertTriangle, ExternalLink, Trash2, ChevronRight, ArrowLeft, BarChart3, Loader2 } from "lucide-react";
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

  async function handleSubmit(action: "submit" | "reopen") {
    if (!selected) return;
    const label = action === "submit" ? "제출완료로 마킹" : "다시 검수 가능 상태로";
    if (!confirm(`정말 ${label} 하시겠습니까?`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/stats", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...selected, action }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || `상태 변경 실패: HTTP ${res.status}`); return; }
      // refresh
      const r = await fetch(`/api/stats/submissions?clientId=${selected.clientId}&year=${selected.year}&month=${selected.month}`);
      setDetail(await r.json());
      refreshGroups();
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

        {/* 액션 */}
        <div className="flex gap-2">
          {!detail.submitted ? (
            <Button onClick={() => handleSubmit("submit")} disabled={busy} className="bg-green-600 hover:bg-green-700">
              <CheckCircle className="w-4 h-4 mr-1" />제출완료로 마킹
            </Button>
          ) : (
            <Button onClick={() => handleSubmit("reopen")} disabled={busy} variant="outline">
              다시 검수 가능 상태로
            </Button>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700">{error}</div>
        )}

        {/* 사진 카드 리스트 */}
        <div className="space-y-3">
          {detail.reports.map((r) => {
            const drugs = r.ocrData?.finalDrugs ?? [];
            const detected = r.ocrData?.geminiMeta?.summary?.drugCount ?? 0;
            const partial = detected > 0 && detected !== drugs.length;
            const matchedCount = drugs.filter((d) => d.matchedMedicationId).length;
            const mismatchCount = drugs.filter((d) => d.mismatch != null).length;
            return (
              <div key={r.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-2 border-b bg-gray-50">
                  <span className="text-xs text-gray-500">{new Date(r.createdAt).toLocaleString()}</span>
                  <span className="text-xs font-semibold">{r.companyName || "(제약사 미상)"}</span>
                  <span className="text-xs text-gray-500">· {drugs.length}건 · {r.totalFee?.toLocaleString() ?? 0}원</span>
                  {partial && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
                      <AlertTriangle className="w-3 h-3 inline mr-0.5" />부분추출 {detected}→{drugs.length}
                    </span>
                  )}
                  {mismatchCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-300">
                      불일치 {mismatchCount}
                    </span>
                  )}
                  <span className="text-[10px] text-gray-400 ml-auto">매칭 {matchedCount}/{drugs.length}</span>
                  {r.ocrData?.sheetUrl && (
                    <a href={r.ocrData.sheetUrl} target="_blank" rel="noreferrer" className="text-[10px] text-blue-600 hover:underline inline-flex items-center gap-0.5">
                      시트 <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  {r.hasImage && (
                    <a href={`/api/files/prescription-report/${r.id}`} target="_blank" rel="noreferrer" className="text-[10px] text-blue-600 hover:underline">
                      원본사진
                    </a>
                  )}
                  <button onClick={() => handleDelete(r.id)} disabled={busy}
                    className="ml-2 text-red-400 hover:text-red-600" title="이 사진과 추출 데이터 삭제 (Storage 파일도 함께 삭제)">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>
                        <th className="text-left px-3 py-1.5">보험코드</th>
                        <th className="text-left px-3 py-1.5">제약사</th>
                        <th className="text-left px-3 py-1.5">제품명</th>
                        <th className="text-right px-3 py-1.5">수량</th>
                        <th className="text-right px-3 py-1.5">단가</th>
                        <th className="text-right px-3 py-1.5">매출</th>
                        <th className="text-center px-3 py-1.5 w-12">상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drugs.map((d, i) => {
                        const qty = parseFloat(d.quantity ?? "0") || 0;
                        const unit = d.unitPrice ?? 0;
                        return (
                          <tr key={i} className={`border-t ${d.mismatch ? "bg-red-50" : ""}`}>
                            <td className="px-3 py-1 font-mono">{d.insuranceCode || "-"}</td>
                            <td className="px-3 py-1 truncate max-w-[120px]">{d.companyName || "-"}</td>
                            <td className="px-3 py-1 truncate max-w-[240px]">{d.productName || "-"}</td>
                            <td className="px-3 py-1 text-right">{qty.toLocaleString()}</td>
                            <td className="px-3 py-1 text-right text-gray-500">{unit ? unit.toLocaleString() : "-"}</td>
                            <td className="px-3 py-1 text-right font-mono">{(qty * unit).toLocaleString()}</td>
                            <td className="px-3 py-1 text-center">
                              {d.matchedMedicationId
                                ? <span className="text-green-600" title="마스터 매칭">●</span>
                                : <span className="text-gray-300" title="매칭 안됨">●</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
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
              <div className="flex items-center gap-3 mb-2">
                <h3 className="text-sm font-bold text-gray-900">{g.clientName}</h3>
                <span className="text-xs text-gray-500">{g.year}년 {g.month}월</span>
                {g.submitted ? (
                  <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-[10px] font-semibold">제출완료</span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-semibold">검수 대기</span>
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
