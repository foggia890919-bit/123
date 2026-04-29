"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2, Search, CheckCircle, XCircle, Clock, Filter, ChevronDown, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { BizLayout } from "../page";
import { FilterMappingContent } from "../filter-mapping/page";

interface FilterRow {
  id: string;
  clientName: string;
  bizNumber: string;
  companyName: string;
  requestType: string;
  status: string;
  respondedResult: string | null;
  respondedAt: string | null;
  createdAt: string;
  upperCorpName: string | null;
  lowerCorpName: string | null;
  user?: { name: string | null; email: string };
}

interface DealerSuggestion { clientName: string; bizNumber: string; dealerType: string }

type ResultFilter = "ALL" | "가능" | "불가" | "PENDING" | "REVIEWING" | "APPROVED" | "REJECTED";

const DEALER_LABEL: Record<string, string> = {
  CORPORATION: "법인", UPPER_CORP: "상위법인", LOWER_CORP: "하위법인",
  SELF: "자사", INDIVIDUAL: "딜러",
};

// ── 상태별 배지 설정 ──────────────────────────────────────────
type BadgeConfig = { label: string; icon: React.ComponentType<{ className?: string }>; cls: string };

function getBadgeConfig(respondedResult: string | null, status: string): BadgeConfig {
  if (respondedResult === "가능") return { label: "가능",  icon: CheckCircle, cls: "text-green-700 bg-green-50 border border-green-200" };
  if (respondedResult === "불가") return { label: "불가",  icon: XCircle,     cls: "text-red-700 bg-red-50 border border-red-200" };
  const map: Record<string, BadgeConfig> = {
    PENDING:   { label: "대기",   icon: Clock,         cls: "text-yellow-700 bg-yellow-50 border border-yellow-200" },
    REVIEWING: { label: "검토중", icon: AlertCircle,   cls: "text-orange-600 bg-orange-50 border border-orange-200" },
    APPROVED:  { label: "승인",   icon: CheckCircle,   cls: "text-blue-700 bg-blue-50 border border-blue-200" },
    REJECTED:  { label: "반려",   icon: XCircle,       cls: "text-rose-700 bg-rose-50 border border-rose-200" },
  };
  return map[status] ?? { label: "대기", icon: Clock, cls: "text-yellow-700 bg-yellow-50 border border-yellow-200" };
}

function ResultBadge({ respondedResult, status }: { respondedResult: string | null; status: string }) {
  const { label, icon: Icon, cls } = getBadgeConfig(respondedResult, status);
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>
      <Icon className="w-3 h-3" /> {label}
    </span>
  );
}

// ── 결과 변경 셀 (BIZ / ADMIN) ────────────────────────────────
function ResultCell({ row, onUpdate }: {
  row: FilterRow;
  onUpdate: (id: string, result: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [saving, setSaving] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  function openMenu() {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen(true);
  }

  async function select(result: string | null) {
    setOpen(false);
    setSaving(true);
    const res = await fetch("/api/filter-request", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: row.id, respondedResult: result }),
    });
    setSaving(false);
    if (res.ok) onUpdate(row.id, result);
  }

  const OPTIONS = [
    { value: "가능" as const, label: "가능",       cls: "text-green-700 hover:bg-green-50" },
    { value: "불가" as const, label: "불가",       cls: "text-red-700 hover:bg-red-50" },
    { value: null,            label: "대기(초기화)", cls: "text-yellow-700 hover:bg-yellow-50" },
  ];

  return (
    <>
      <button ref={btnRef} onClick={openMenu} disabled={saving}
        className="flex items-center gap-0.5 hover:opacity-75 transition-opacity">
        {saving
          ? <Loader2 className="w-3 h-3 animate-spin text-gray-400" />
          : <><ResultBadge respondedResult={row.respondedResult} status={row.status} /><ChevronDown className="w-2.5 h-2.5 text-gray-400 ml-0.5" /></>
        }
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden min-w-[120px]"
            style={{ top: pos.top, left: pos.left }}>
            {OPTIONS.map((opt) => (
              <button key={String(opt.value)} onMouseDown={() => select(opt.value)}
                className={`w-full text-left px-4 py-2 text-xs font-medium transition-colors ${opt.cls}`}>
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ── 상위/하위법인 인라인 선택 셀 ─────────────────────────────
function CorpCell({ value, onSave }: { value: string | null; onSave: (v: string | null) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [q, setQ] = useState("");
  const [items, setItems] = useState<DealerSuggestion[]>([]);
  const [saving, setSaving] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function openDropdown() {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setQ(""); fetchItems(""); setOpen(true);
  }

  function fetchItems(query: string) {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const res = await fetch(`/api/filter-mapping/suggestions?type=dealer&q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    }, 150);
  }

  async function select(name: string | null) {
    setOpen(false); setSaving(true);
    await onSave(name);
    setSaving(false);
  }

  return (
    <>
      <button ref={btnRef} onClick={openDropdown} disabled={saving}
        className="text-xs text-left hover:text-blue-600 transition-colors truncate max-w-[110px] block">
        {saving
          ? <Loader2 className="w-3 h-3 animate-spin text-gray-400" />
          : value
            ? <span className="text-gray-700">{value}</span>
            : <span className="text-gray-300 hover:text-blue-400">미설정</span>
        }
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-xl w-52"
            style={{ top: pos.top, left: pos.left }}>
            <div className="px-2 pt-2 pb-1 border-b border-gray-100">
              <input autoFocus value={q}
                onChange={(e) => { setQ(e.target.value); fetchItems(e.target.value); }}
                placeholder="법인·딜러명 검색"
                className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div className="max-h-44 overflow-y-auto py-1">
              <button onMouseDown={() => select(null)}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-50">미설정 (지우기)</button>
              {items.map((item, i) => (
                <button key={i} onMouseDown={() => select(item.clientName)}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center justify-between gap-2">
                  <span className="text-gray-800 truncate">{item.clientName}</span>
                  <span className="text-gray-400 text-[10px] shrink-0">{DEALER_LABEL[item.dealerType] ?? item.dealerType}</span>
                </button>
              ))}
              {items.length === 0 && q && <p className="px-3 py-2 text-xs text-gray-400">결과 없음</p>}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ── 필터 탭 설정 ──────────────────────────────────────────────
const FILTER_TABS: { key: ResultFilter; label: string; activeCls: string }[] = [
  { key: "ALL",       label: "전체",   activeCls: "bg-gray-900 text-white" },
  { key: "가능",      label: "가능",   activeCls: "bg-green-600 text-white" },
  { key: "불가",      label: "불가",   activeCls: "bg-red-600 text-white" },
  { key: "PENDING",   label: "대기",   activeCls: "bg-yellow-500 text-white" },
  { key: "REVIEWING", label: "검토중", activeCls: "bg-orange-500 text-white" },
  { key: "APPROVED",  label: "승인",   activeCls: "bg-blue-600 text-white" },
  { key: "REJECTED",  label: "반려",   activeCls: "bg-rose-600 text-white" },
];

function matchesFilter(r: FilterRow, f: ResultFilter): boolean {
  if (f === "ALL")       return true;
  if (f === "가능")      return r.respondedResult === "가능";
  if (f === "불가")      return r.respondedResult === "불가";
  return !r.respondedResult && r.status === f;
}

function countFilter(rows: FilterRow[], f: ResultFilter): number {
  return f === "ALL" ? rows.length : rows.filter((r) => matchesFilter(r, f)).length;
}

type PageTab = "status" | "mapping";

// ── 메인 페이지 ──────────────────────────────────────────────
export default function FilterStatusPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [tab, setTab] = useState<PageTab>("status");
  const [rows, setRows] = useState<FilterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("ALL");

  const isAdmin = session?.user?.role === "ADMIN";
  const isBiz   = session?.user?.role === "BIZ";
  const canEdit  = isAdmin || isBiz;

  useEffect(() => {
    if (status === "loading") return;
    if (!session) { router.push("/login"); return; }
    const role = session.user.role;
    if (role !== "BIZ" && role !== "ADMIN") { router.push("/"); return; }
    const url = role === "ADMIN" ? "/api/filter-request?all=true" : "/api/filter-request";
    fetch(url)
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, [session, status, router]);

  const updateCorp = useCallback(async (id: string, field: "upperCorpName" | "lowerCorpName", value: string | null) => {
    const res = await fetch("/api/filter-request", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, [field]: value }),
    });
    if (res.ok) setRows((prev) => prev.map((r) => r.id === id ? { ...r, [field]: value } : r));
  }, []);

  const updateResult = useCallback((id: string, result: string | null) => {
    setRows((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      return {
        ...r,
        respondedResult: result,
        status: result ? (result === "가능" ? "APPROVED" : "REJECTED") : "PENDING",
      };
    }));
  }, []);

  const filtered = rows.filter((r) => {
    const matchQ = !query ||
      r.clientName.includes(query) || r.companyName.includes(query) ||
      r.bizNumber.includes(query) || (r.user?.name ?? "").includes(query);
    return matchQ && matchesFilter(r, resultFilter);
  });

  const grouped = filtered.reduce<Record<string, FilterRow[]>>((acc, r) => {
    const key = `${r.clientName}__${r.bizNumber}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});

  function formatDate(s: string | null) {
    if (!s) return "-";
    return new Date(s).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
  }
  function formatBiz(n: string) {
    const d = n.replace(/\D/g, "");
    if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
    return n;
  }

  const gridCols = isAdmin
    ? "grid-cols-[2fr_minmax(80px,1fr)_minmax(80px,1fr)_auto_auto_auto_auto]"
    : "grid-cols-[2fr_minmax(80px,1fr)_minmax(80px,1fr)_auto_auto_auto]";

  return (
    <BizLayout>
      {/* 탭 헤더 */}
      <div className="flex border-b border-gray-200 mb-5 gap-0">
        {([["status", "필터링 현황"], ["mapping", "매핑 관리"]] as [PageTab, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === key ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-800"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "mapping" && <FilterMappingContent />}

      {tab === "status" && <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">필터링 현황</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {isAdmin ? "전체 영업사원의 거래처×제약사 필터링 요청 현황" : "내 거래처별 제약사 필터링 요청 현황"}
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-500 bg-gray-100 px-3 py-1.5 rounded-full">
            <Filter className="w-3.5 h-3.5" />
            총 {rows.length}건
          </div>
        </div>

        {/* 검색 */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder={isAdmin ? "거래처명, 제약사명, 영업사원 검색" : "거래처명 또는 제약사명 검색"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 text-sm"
          />
        </div>

        {/* 상태 필터 탭 */}
        <div className="flex gap-1 flex-wrap">
          {FILTER_TABS.map(({ key, label, activeCls }) => {
            const count = countFilter(rows, key);
            return (
              <button key={key} onClick={() => setResultFilter(key)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors whitespace-nowrap ${
                  resultFilter === key ? activeCls : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}>
                {label} ({count})
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-sm text-gray-400">
            {query || resultFilter !== "ALL" ? "검색 결과가 없습니다" : "필터링 요청 내역이 없습니다"}
          </div>
        ) : (
          <div className="space-y-3">
            {Object.entries(grouped).map(([key, items]) => {
              const [clientName, bizNumber] = key.split("__");
              return (
                <div key={key} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-100">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{clientName}</p>
                      <p className="text-xs text-gray-400 font-mono">{formatBiz(bizNumber)}</p>
                    </div>
                    {isAdmin && items[0].user && (
                      <span className="ml-auto text-xs text-gray-400">
                        {items[0].user.name ?? items[0].user.email}
                      </span>
                    )}
                    <span className={`${isAdmin ? "" : "ml-auto"} text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full`}>
                      {items.length}개 제약사
                    </span>
                  </div>

                  <div className="divide-y divide-gray-50 overflow-x-auto">
                    <div className={`grid text-xs font-medium text-gray-400 px-4 py-2 bg-white ${gridCols}`}>
                      <span>제약사</span>
                      <span>상위법인</span>
                      <span>하위법인</span>
                      <span className="w-12 text-center">유형</span>
                      <span className="w-24 text-center">결과{canEdit && <span className="text-gray-300 font-normal ml-1">(클릭 변경)</span>}</span>
                      <span className="w-20 text-right">요청일</span>
                      {isAdmin && <span className="w-20 text-right">처리일</span>}
                    </div>
                    {items.map((r) => (
                      <div key={r.id}
                        className={`grid items-center px-4 py-2.5 text-xs hover:bg-gray-50 ${gridCols}`}>
                        <span className="font-medium text-gray-800 truncate pr-2">{r.companyName}</span>
                        <div className="pr-2">
                          <CorpCell value={r.upperCorpName} onSave={(v) => updateCorp(r.id, "upperCorpName", v)} />
                        </div>
                        <div className="pr-2">
                          <CorpCell value={r.lowerCorpName} onSave={(v) => updateCorp(r.id, "lowerCorpName", v)} />
                        </div>
                        <span className="w-12 text-center text-gray-500">{r.requestType}</span>
                        <span className="w-24 flex justify-center">
                          {canEdit
                            ? <ResultCell row={r} onUpdate={updateResult} />
                            : <ResultBadge respondedResult={r.respondedResult} status={r.status} />
                          }
                        </span>
                        <span className="w-20 text-right text-gray-400">{formatDate(r.createdAt)}</span>
                        {isAdmin && <span className="w-20 text-right text-gray-400">{formatDate(r.respondedAt)}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>}
    </BizLayout>
  );
}
