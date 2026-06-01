"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Loader2, ChevronUp, ChevronDown, RefreshCw } from "lucide-react";

interface DealerClient {
  id: string;
  clientName: string;
  bizNumber: string;
  corpClassification: string | null;
  partnerGrade: string | null;
  promotionBaseDate: string | null;
}

interface PromotionItem {
  submissionRouteId: string;
  clientName: string;
  companyName: string;
  submissionEntity: string;
  requestType: string;
  routeCreatedAt: string;
  isPromotionEligible: boolean;
  promotionExpiresAt: string | null;
  promotionRemainingDays: number | null;
  baseAdditionalRate: number;
  finalRate: number;
  currentMonthSubmitted: boolean;
  status: string;
}

interface CorpSummary {
  id: string;
  clientName: string;
  corpClassification: string | null;
  partnerGrade: string | null;
  promotionBaseDate: string | null;
}

const STATUS_BADGE: Record<string, { bg: string; text: string }> = {
  "적용중": { bg: "bg-green-50 border-green-200", text: "text-green-700" },
  "미제출": { bg: "bg-yellow-50 border-yellow-200", text: "text-yellow-700" },
  "마감초과": { bg: "bg-orange-50 border-orange-200", text: "text-orange-700" },
  "미적용": { bg: "bg-gray-50 border-gray-200", text: "text-gray-500" },
  "미적용(이관)": { bg: "bg-gray-50 border-gray-200", text: "text-gray-500" },
  "만료": { bg: "bg-red-50 border-red-200", text: "text-red-600" },
};

const GRADE_LABEL: Record<string, string> = { A: "A등급 (-0.5%)", B: "B등급 (-1%)", C: "C등급 (-2%)" };

export default function PromotionPage() {
  const { data: session } = useSession();
  const [dealers, setDealers] = useState<DealerClient[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<PromotionItem[]>([]);
  const [corp, setCorp] = useState<CorpSummary | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filterStatus, setFilterStatus] = useState<string>("전체");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const isAdmin = session?.user?.role === "ADMIN";

  useEffect(() => {
    fetch("/api/dealer")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setDealers(data.filter((d: DealerClient) => d.corpClassification === "PARTNER"));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    fetch(`/api/dealer/${selectedId}/promotion-routes?sort=${sortDir}`)
      .then((r) => r.json())
      .then((data) => {
        setCorp(data.corp ?? null);
        setItems(data.items ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedId, sortDir]);

  const filtered = filterStatus === "전체" ? items : items.filter((i) => i.status === filterStatus);
  const statuses = ["전체", ...new Set(items.map((i) => i.status))];

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-gray-900">협력법인 프로모션 관리</h1>
        {isAdmin && (
          <button
            onClick={async () => {
              setSyncing(true);
              setSyncResult(null);
              try {
                const r = await fetch("/api/admin/sync-yk-rates", { method: "POST" });
                const data = await r.json();
                if (!r.ok || data.error) {
                  setSyncResult(`실패: ${data.error ?? `HTTP ${r.status}`}`);
                } else {
                  setSyncResult(`✓ ${data.upserted}건 동기화 (스킵 ${data.skipped}, 에러 ${data.errors?.length ?? 0})`);
                }
              } catch (e) {
                setSyncResult(`네트워크 오류: ${String(e)}`);
              } finally {
                setSyncing(false);
              }
            }}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "동기화 중..." : "구글시트 → DB 동기화"}
          </button>
        )}
      </div>
      {syncResult && (
        <div className={`text-xs px-3 py-2 rounded-lg border ${
          syncResult.startsWith("✓")
            ? "text-green-700 bg-green-50 border-green-200"
            : "text-red-700 bg-red-50 border-red-200"
        }`}>
          {syncResult}
        </div>
      )}

      {/* 법인 선택 */}
      <div className="flex items-center gap-4 flex-wrap">
        <label className="text-sm font-medium text-gray-600">협력법인 선택</label>
        <select
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(e.target.value || null)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[200px]"
        >
          <option value="">선택하세요</option>
          {dealers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.clientName} ({d.bizNumber}) — {d.partnerGrade ?? "등급없음"}
            </option>
          ))}
        </select>
        {dealers.length === 0 && (
          <span className="text-xs text-gray-400">협력법인으로 등록된 거래처가 없습니다</span>
        )}
      </div>

      {/* 법인 요약 카드 */}
      {corp && (
        <div className="bg-white border rounded-lg p-4 flex items-center gap-6 flex-wrap text-sm">
          <div>
            <span className="text-gray-400">법인명</span>
            <p className="font-semibold text-gray-900">{corp.clientName}</p>
          </div>
          <div>
            <span className="text-gray-400">등급</span>
            <p className="font-semibold">
              {corp.partnerGrade ? (
                <span className="px-2 py-0.5 rounded-full text-xs border bg-amber-50 border-amber-200 text-amber-700">
                  {GRADE_LABEL[corp.partnerGrade] ?? corp.partnerGrade}
                </span>
              ) : "-"}
            </p>
          </div>
          <div>
            <span className="text-gray-400">프로모션 기준일</span>
            <p className="font-semibold text-gray-900">
              {corp.promotionBaseDate ? new Date(corp.promotionBaseDate).toLocaleDateString("ko-KR") : "미설정"}
            </p>
          </div>
          <div>
            <span className="text-gray-400">적용중</span>
            <p className="font-semibold text-green-700">
              {items.filter((i) => i.status === "적용중").length}건
            </p>
          </div>
          <div>
            <span className="text-gray-400">미제출</span>
            <p className="font-semibold text-yellow-700">
              {items.filter((i) => i.status === "미제출").length}건
            </p>
          </div>
        </div>
      )}

      {/* 필터 + 정렬 */}
      {selectedId && (
        <div className="flex items-center gap-3 flex-wrap">
          {statuses.map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                filterStatus === s
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {s} {s !== "전체" && `(${items.filter((i) => i.status === s).length})`}
            </button>
          ))}
          <button
            onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
            className="text-xs px-3 py-1.5 rounded-full border border-gray-200 bg-white hover:bg-gray-50 flex items-center gap-1"
          >
            등록일 {sortDir === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
          </button>
        </div>
      )}

      {/* 로딩 */}
      {loading && (
        <div className="flex justify-center py-12 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />조회 중...
        </div>
      )}

      {/* 테이블 */}
      {!loading && selectedId && filtered.length > 0 && (
        <div className="overflow-x-auto border rounded-lg bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr className="text-xs text-gray-500">
                <th className="text-left px-4 py-3">거래처</th>
                <th className="text-left px-3 py-3">제약사</th>
                <th className="text-center px-3 py-3">구분</th>
                <th className="text-center px-3 py-3">등록일</th>
                <th className="text-right px-3 py-3">기본수수료</th>
                <th className="text-right px-3 py-3">최종수수료</th>
                <th className="text-center px-3 py-3">만료일</th>
                <th className="text-center px-3 py-3">당월제출</th>
                <th className="text-center px-4 py-3">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((item) => {
                const badge = STATUS_BADGE[item.status] ?? STATUS_BADGE["미적용"];
                return (
                  <tr key={item.submissionRouteId} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-900">{item.clientName}</td>
                    <td className="px-3 py-2.5 text-gray-700">{item.companyName}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${
                        item.requestType === "신규"
                          ? "bg-blue-50 border-blue-200 text-blue-700"
                          : "bg-gray-50 border-gray-200 text-gray-500"
                      }`}>
                        {item.requestType}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center text-gray-600 tabular-nums">
                      {new Date(item.routeCreatedAt).toLocaleDateString("ko-KR")}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">
                      {item.baseAdditionalRate}%
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-blue-700">
                      {item.isPromotionEligible ? `${item.finalRate}%` : "-"}
                    </td>
                    <td className="px-3 py-2.5 text-center text-gray-500 tabular-nums text-xs">
                      {item.promotionExpiresAt
                        ? new Date(item.promotionExpiresAt).toLocaleDateString("ko-KR")
                        : "-"}
                      {item.promotionRemainingDays != null && (
                        <span className="ml-1 text-gray-400">({item.promotionRemainingDays}일)</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {item.isPromotionEligible ? (
                        item.currentMonthSubmitted
                          ? <span className="text-green-600 font-medium">O</span>
                          : <span className="text-red-500 font-medium">X</span>
                      ) : "-"}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-xs px-2.5 py-1 rounded-full border ${badge.bg} ${badge.text}`}>
                        {item.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && selectedId && filtered.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm">
          {items.length === 0 ? "등록된 제출처가 없습니다" : "해당 상태의 항목이 없습니다"}
        </div>
      )}
    </div>
  );
}
