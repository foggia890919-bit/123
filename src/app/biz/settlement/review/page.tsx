"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { FileSearch, Loader2, CheckCircle, Clock, AlertCircle, FolderOpen } from "lucide-react";
import { BizLayout } from "../../page";

interface Doc {
  id: string;
  corpName: string;
  fileName: string;
  period: string;
  status: string;
  parsedData: unknown;
  template: { corpName: string; columnMap: Record<string, string> } | null;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: "검수 대기",
  PROCESSING: "처리중",
  DONE: "완료",
  ERROR: "오류",
};
const STATUS_ICON: Record<string, React.ElementType> = {
  PENDING: Clock,
  PROCESSING: Loader2,
  DONE: CheckCircle,
  ERROR: AlertCircle,
};
const STATUS_COLOR: Record<string, string> = {
  PENDING: "text-yellow-600",
  PROCESSING: "text-blue-600",
  DONE: "text-green-600",
  ERROR: "text-red-600",
};

export default function SettlementReviewPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState<string>("");

  useEffect(() => {
    if (status === "loading") return;
    if (!session) { router.push("/login"); return; }
    const role = session.user.role;
    if (role !== "BIZ" && role !== "ADMIN") { router.push("/"); return; }
    fetch("/api/settlement/documents")
      .then((r) => r.json())
      .then((d) => {
        const arr = Array.isArray(d) ? d : [];
        setDocs(arr);
        if (arr.length > 0) {
          const latest = [...arr].sort((a, b) => b.period.localeCompare(a.period))[0];
          setSelectedPeriod(latest.period);
        }
      })
      .finally(() => setLoading(false));
  }, [session, status, router]);

  const periods = [...new Set(docs.map((d) => d.period))].sort().reverse();
  const filtered = selectedPeriod ? docs.filter((d) => d.period === selectedPeriod) : docs;

  const matched = filtered.filter((d) => d.template).length;
  const done = filtered.filter((d) => d.status === "DONE").length;
  const pending = filtered.filter((d) => d.status === "PENDING").length;

  return (
    <BizLayout>
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-bold text-gray-900">정산내역서 검수</h2>
          <p className="text-xs text-gray-500 mt-0.5">업로드된 정산내역을 확인하고 취합합니다</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        ) : docs.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
            <FileSearch className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500 font-medium">업로드된 정산내역서가 없습니다</p>
            <p className="text-xs text-gray-400 mt-1">정산내역서 업로드 메뉴에서 먼저 파일을 업로드하세요</p>
          </div>
        ) : (
          <>
            {/* 기간 선택 */}
            <div className="flex gap-2 flex-wrap">
              {periods.map((p) => (
                <button
                  key={p}
                  onClick={() => setSelectedPeriod(p)}
                  className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
                    selectedPeriod === p
                      ? "bg-gray-900 text-white"
                      : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  {p.replace("-", "년 ")}월
                  <span className="text-xs opacity-70">({docs.filter((d) => d.period === p).length})</span>
                </button>
              ))}
            </div>

            {/* 요약 카드 */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "전체", value: filtered.length, color: "text-gray-900" },
                { label: "양식 매칭", value: matched, color: "text-green-600" },
                { label: "검수 대기", value: pending, color: "text-yellow-600" },
              ].map((s) => (
                <div key={s.label} className="bg-white border border-gray-200 rounded-xl p-4 text-center">
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-gray-500 mt-1">{s.label}</p>
                </div>
              ))}
            </div>

            {/* 목록 */}
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto_auto] text-xs font-semibold text-gray-500 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                <span>법인 / 파일명</span>
                <span className="w-24 text-center">양식</span>
                <span className="w-24 text-center">상태</span>
                <span className="w-20 text-center">등록일</span>
              </div>
              <div className="divide-y divide-gray-50">
                {filtered.map((d) => {
                  const StatusIcon = STATUS_ICON[d.status] ?? Clock;
                  return (
                    <div key={d.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-800">{d.corpName}</p>
                        <p className="text-xs text-gray-400">{d.fileName}</p>
                      </div>
                      <div className="w-24 text-center">
                        {d.template ? (
                          <span className="text-xs text-green-600 font-medium flex items-center justify-center gap-1">
                            <CheckCircle className="w-3.5 h-3.5" /> 매칭
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">미등록</span>
                        )}
                      </div>
                      <div className="w-24 flex items-center justify-center gap-1">
                        <StatusIcon className={`w-3.5 h-3.5 ${STATUS_COLOR[d.status] ?? "text-gray-400"} ${d.status === "PROCESSING" ? "animate-spin" : ""}`} />
                        <span className={`text-xs font-medium ${STATUS_COLOR[d.status] ?? "text-gray-500"}`}>
                          {STATUS_LABEL[d.status] ?? d.status}
                        </span>
                      </div>
                      <div className="w-20 text-center text-xs text-gray-400">
                        {new Date(d.createdAt).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </BizLayout>
  );
}
