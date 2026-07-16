"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { normalizeCompanyName } from "@/lib/company-name";
import { ClipboardList, CheckCircle2, XCircle, Loader2, ShieldAlert, Building2, Camera } from "lucide-react";

const ALLOWED_ROLES = ["ADMIN", "BIZ", "BUSINESS", "BASIC"];

interface Cell {
  submitted: boolean;
  source: "manual" | "auto" | null;
  photoCount?: number;
}
interface RouteRow {
  id: string;
  submissionEntity: string;
  clientName: string;
  companyName: string;
  parentUserName: string | null;
  directInput?: boolean;
  cells: Record<string, Cell>;
}
interface StatusData {
  months: string[];
  currentMonth: string;
  totalMappings: number;
  submittedThisMonth: number;
  routes: RouteRow[];
}

function monthLabel(ym: string): string {
  const m = Number(ym.split("-")[1]);
  return `${m}월`;
}

export default function SubmissionStatusPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stats/submission-status");
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") refresh();
  }, [status, refresh]);

  // 필터 후 법인 > 거래처 그룹핑 (가나다순)
  const grouped = useMemo(() => {
    if (!data) return [];
    const months = data.months;
    const rows = data.routes.filter(
      (r) =>
        (entityFilter === "all" || r.submissionEntity === entityFilter) &&
        (clientFilter === "all" || r.clientName === clientFilter),
    );

    const entityMap = new Map<
      string,
      {
        entity: string;
        directInput: boolean;
        clients: Map<string, RouteRow[]>;
        monthTotals: Record<string, { done: number; total: number }>;
      }
    >();
    for (const r of rows) {
      let e = entityMap.get(r.submissionEntity);
      if (!e) {
        e = {
          entity: r.submissionEntity,
          directInput: !!r.directInput,
          clients: new Map(),
          monthTotals: Object.fromEntries(months.map((m) => [m, { done: 0, total: 0 }])),
        };
        entityMap.set(r.submissionEntity, e);
      }
      if (!e.clients.has(r.clientName)) e.clients.set(r.clientName, []);
      e.clients.get(r.clientName)!.push(r);
      for (const m of months) {
        e.monthTotals[m].total += 1;
        if (r.cells[m]?.submitted) e.monthTotals[m].done += 1;
      }
    }

    return Array.from(entityMap.values())
      .map((e) => ({
        entity: e.entity,
        directInput: e.directInput,
        monthTotals: e.monthTotals,
        clients: Array.from(e.clients.entries())
          .map(([clientName, routes]) => ({
            clientName,
            routes: routes
              .slice()
              .sort((a, b) =>
                normalizeCompanyName(a.companyName).localeCompare(normalizeCompanyName(b.companyName), "ko"),
              ),
          }))
          .sort((a, b) => a.clientName.localeCompare(b.clientName, "ko")),
      }))
      .sort((a, b) =>
        normalizeCompanyName(a.entity).localeCompare(normalizeCompanyName(b.entity), "ko"),
      );
  }, [data, entityFilter, clientFilter]);

  // 필터 옵션
  const entityOptions = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.routes.map((r) => r.submissionEntity))).sort((a, b) =>
      normalizeCompanyName(a).localeCompare(normalizeCompanyName(b), "ko"),
    );
  }, [data]);
  const clientOptions = useMemo(() => {
    if (!data) return [];
    const rows =
      entityFilter === "all"
        ? data.routes
        : data.routes.filter((r) => r.submissionEntity === entityFilter);
    return Array.from(new Set(rows.map((r) => r.clientName))).sort((a, b) => a.localeCompare(b, "ko"));
  }, [data, entityFilter]);

  if (status === "loading") {
    return <div className="py-20 text-center text-gray-400">불러오는 중...</div>;
  }
  if (!session) {
    router.push("/login");
    return null;
  }

  const role = (session.user as { role?: string }).role ?? "";
  if (!ALLOWED_ROLES.includes(role)) {
    return (
      <div className="max-w-md mx-auto mt-20 p-6 bg-red-50 border border-red-200 rounded-lg text-center">
        <ShieldAlert className="w-10 h-10 text-red-500 mx-auto mb-2" />
        <h2 className="text-lg font-semibold text-red-800">접근 권한이 없어요</h2>
        <p className="text-sm text-red-700 mt-2">제출현황 기능은 사업자·비즈·일반회원 전용입니다.</p>
      </div>
    );
  }

  const months = data?.months ?? [];

  return (
    <div className="max-w-5xl mx-auto py-6 px-4 space-y-6">
      <header className="flex items-center gap-2">
        <ClipboardList className="w-6 h-6 text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">제출현황</h1>
          <p className="text-sm text-gray-500 mt-0.5">법인 &gt; 거래처 &gt; 제약사별 최근 3개월 통계 제출 여부입니다.</p>
        </div>
      </header>

      {/* 요약 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500">전체 매핑</p>
          <p className="text-2xl font-bold text-gray-900 mt-0.5">{data?.totalMappings ?? 0}<span className="text-sm font-normal text-gray-400 ml-1">건</span></p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500">이번 달 제출완료{data ? ` (${monthLabel(data.currentMonth)})` : ""}</p>
          <p className="text-2xl font-bold text-emerald-600 mt-0.5">
            {data?.submittedThisMonth ?? 0}
            <span className="text-sm font-normal text-gray-400 ml-1">/ {data?.totalMappings ?? 0}</span>
          </p>
        </div>
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={entityFilter}
          onChange={(e) => { setEntityFilter(e.target.value); setClientFilter("all"); }}
          className="text-sm border border-gray-300 rounded-md px-3 py-2 bg-white"
        >
          <option value="all">전체 법인</option>
          {entityOptions.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <select
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-3 py-2 bg-white"
        >
          <option value="all">전체 거래처</option>
          {clientOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : grouped.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-10 text-center">
          <ClipboardList className="w-8 h-8 text-gray-200 mx-auto mb-2" />
          <p className="text-sm text-gray-500">표시할 제출처 매핑이 없어요.</p>
          <p className="text-xs text-gray-400 mt-1">통계제출처 메뉴에서 거래처·제약사·법인을 등록하세요.</p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-4 text-[11px] text-gray-500">
            <span className="inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />수동 체크</span>
            <span className="inline-flex items-center gap-1"><Camera className="w-3.5 h-3.5 text-blue-600" />사진 제출 감지(장수)</span>
            <span className="inline-flex items-center gap-1"><XCircle className="w-3.5 h-3.5 text-gray-300" />미제출</span>
          </div>
          {grouped.map((g) => (
            <section key={g.entity} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-2 flex-wrap">
                <Building2 className="w-4 h-4 text-blue-600 shrink-0" />
                <h2 className="text-sm font-semibold text-gray-800">{normalizeCompanyName(g.entity) || g.entity}</h2>
                {g.directInput && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">직접입력</span>}
                <div className="flex items-center gap-1.5 ml-auto">
                  {months.map((m) => {
                    const t = g.monthTotals[m];
                    const all = t.total > 0 && t.done === t.total;
                    return (
                      <span
                        key={m}
                        className={`text-[11px] px-1.5 py-0.5 rounded ${all ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}
                        title={`${monthLabel(m)} 제출완료 ${t.done}/${t.total}`}
                      >
                        {monthLabel(m)} {t.done}/{t.total}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-white text-xs text-gray-500 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">거래처</th>
                      <th className="text-left px-4 py-2 font-medium">제약사</th>
                      {months.map((m) => (
                        <th key={m} className="text-center px-3 py-2 font-medium whitespace-nowrap">{monthLabel(m)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g.clients.map((c) =>
                      c.routes.map((r, idx) => (
                        <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50/60">
                          <td className="px-4 py-2 text-gray-700 align-top">
                            {idx === 0 ? c.clientName : <span className="text-transparent select-none">·</span>}
                          </td>
                          <td className="px-4 py-2 text-gray-800">{normalizeCompanyName(r.companyName) || r.companyName}</td>
                          {months.map((m) => {
                            const cell = r.cells[m];
                            return (
                              <td key={m} className="px-3 py-2 text-center">
                                {!cell?.submitted ? (
                                  <span className="inline-flex items-center gap-0.5 text-gray-300" title="미제출">
                                    <XCircle className="w-4 h-4" />
                                  </span>
                                ) : cell.source === "manual" ? (
                                  <span className="inline-flex items-center gap-0.5 text-emerald-600" title="제출완료 (수동 체크)">
                                    <CheckCircle2 className="w-4 h-4" />
                                  </span>
                                ) : (
                                  <span
                                    className="inline-flex items-center gap-0.5 text-[11px] font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5"
                                    title={`사진 제출 감지 (${cell.photoCount ?? 0}장)`}
                                  >
                                    <Camera className="w-3 h-3" />{cell.photoCount ?? 0}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
