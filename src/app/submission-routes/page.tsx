"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeCompanyName, companyNameKey } from "@/lib/company-name";
import {
  Building2, Stethoscope, ClipboardList, UserCheck, UserPlus, Inbox, Send, Mail,
  Plus, Pencil, Trash2, CheckCircle, CheckCircle2, Loader2, ShieldAlert,
  Search, ChevronDown, ChevronRight, X, AlertCircle, Pill, Filter,
} from "lucide-react";

const ALLOWED_ROLES = ["ADMIN", "BIZ", "BUSINESS", "BASIC"];

interface SubmissionRoute {
  id: string;
  ownerId: string;
  clientName: string;
  companyName: string;
  submissionEntity: string;
  submissionEmail: string | null;
  requestType: string;
  memo: string | null;
  active: boolean;
}
interface ParentInfo { id: string; name: string | null; email: string }
interface MeInfo { id: string; role: string; parent: ParentInfo | null }
interface LinkRequest {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELED";
  targetEmailSnapshot: string;
  reason: string | null;
  createdAt: string;
  decidedAt: string | null;
  requester: { id: string; name: string | null; email: string; role: string };
  target: { id: string; name: string | null; email: string; role: string };
}
interface Company { name: string; isSettlement: boolean; count: number }
interface UserClient { id: string; clientName: string; bizNumber: string; createdAt?: string }
interface FilterReq { id: string; clientName: string; bizNumber: string; companyName: string; status: string }
interface DealerResult {
  clientName: string; bizNumber: string; dealerType: string | null;
  userId?: string; email?: string; name?: string; isBusinessApproved?: boolean;
  role?: string; category?: "ADMIN" | "DOCTOR" | "PHARMACIST" | "BUSINESS_APPROVED" | "GENERAL";
}

function validateBizNumber(biz: string): boolean {
  const d = biz.replace(/\D/g, "");
  if (d.length !== 10) return false;
  const n = d.split("").map(Number);
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += n[i] * w[i];
  sum += Math.floor((n[8] * 5) / 10);
  return (10 - (sum % 10)) % 10 === n[9];
}
function formatBizNumber(v: string) {
  const d = v.replace(/\D/g, "");
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5, 10)}`;
}

const EMPTY_EDIT = { clientName: "", companyName: "", submissionEntity: "", submissionEmail: "", requestType: "신규" as "신규" | "이관", memo: "" };

export default function SubmissionRoutesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [me, setMe] = useState<MeInfo | null>(null);
  const [routes, setRoutes] = useState<SubmissionRoute[]>([]);
  const [clients, setClients] = useState<UserClient[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [filterReqs, setFilterReqs] = useState<FilterReq[]>([]);
  const [outgoing, setOutgoing] = useState<LinkRequest[]>([]);
  const [incoming, setIncoming] = useState<LinkRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const uid = (session?.user as { id?: string } | undefined)?.id;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [mr, rr, cl, co, fr, or, ir] = await Promise.all([
        fetch("/api/mypage"),
        fetch("/api/submission-routes"),
        fetch("/api/user-clients"),
        fetch("/api/medications/companies"),
        uid ? fetch(`/api/filter-request?userId=${uid}`) : Promise.resolve(null),
        fetch("/api/parent-link-requests?box=outgoing"),
        fetch("/api/parent-link-requests?box=incoming"),
      ]);
      if (mr.ok) setMe(await mr.json());
      if (rr.ok) setRoutes(await rr.json());
      if (cl.ok) { const d = await cl.json(); setClients(Array.isArray(d) ? d : []); }
      if (co.ok) { const d = await co.json(); setCompanies(Array.isArray(d) ? d : []); }
      if (fr && fr.ok) { const d = await fr.json(); setFilterReqs(Array.isArray(d) ? d : []); }
      if (or.ok) setOutgoing(await or.json());
      if (ir.ok) setIncoming(await ir.json());
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    if (status === "authenticated") refresh();
  }, [status, refresh]);

  if (status === "loading") {
    return <div className="py-20 text-center text-gray-400">불러오는 중...</div>;
  }
  if (!session) { router.push("/login"); return null; }

  const role = (session.user as { role?: string }).role ?? "";
  if (!ALLOWED_ROLES.includes(role)) {
    return (
      <div className="max-w-md mx-auto mt-20 p-6 bg-red-50 border border-red-200 rounded-lg text-center">
        <ShieldAlert className="w-10 h-10 text-red-500 mx-auto mb-2" />
        <h2 className="text-lg font-semibold text-red-800">접근 권한이 없어요</h2>
        <p className="text-sm text-red-700 mt-2">통계제출처 기능은 사업자·비즈·일반회원 전용입니다.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">통계제출처 관리</h1>
        <p className="text-sm text-gray-500 mt-1">거래처 → 제약사 → 제출법인을 차례로 선택해 제출처 매핑을 등록합니다.</p>
      </header>

      <Workbench
        me={me}
        userName={session.user?.name || session.user?.email || ""}
        clients={clients}
        routes={routes}
        companies={companies}
        filterReqs={filterReqs}
        refresh={refresh}
      />

      <StatusList me={me} role={role} routes={routes} clients={clients} companies={companies} loading={loading} refresh={refresh} />

      <CorpLinkPanel me={me} outgoing={outgoing} incoming={incoming} refresh={refresh} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   상위법인(회원) 검색 드롭다운 — /api/dealers/search 재사용
   ───────────────────────────────────────────────────────────── */
function DealerDropdown({
  selected, onSelect, onClear, placeholder, emptyAction,
}: {
  selected: DealerResult | null;
  onSelect: (d: DealerResult) => void;
  onClear: () => void;
  placeholder: string;
  emptyAction?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DealerResult[]>([]);
  const [searching, setSearching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setSearching(true);
      fetch(`/api/dealers/search?q=${encodeURIComponent(query)}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => setResults(Array.isArray(d) ? d : []))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query, open]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (open && ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full h-10 px-3 border border-gray-300 rounded-md bg-white hover:bg-gray-50 text-left text-sm flex items-center justify-between gap-2">
        {selected ? (
          <span className="flex items-center gap-2 flex-1 min-w-0">
            <CheckCircle2 className="w-4 h-4 text-blue-500 shrink-0" />
            <span className="font-medium text-gray-800 truncate">{selected.clientName}</span>
            <span className="text-gray-400 font-mono text-xs shrink-0">{selected.bizNumber}</span>
          </span>
        ) : (
          <span className="text-gray-400 flex items-center gap-1.5"><Search className="w-3.5 h-3.5" />{placeholder}</span>
        )}
        <div className="flex items-center gap-1 shrink-0">
          {selected && (
            <span onClick={(e) => { e.stopPropagation(); onClear(); setQuery(""); }} className="p-0.5 text-gray-400 hover:text-gray-600 rounded">
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                onCompositionEnd={(e) => setQuery(e.currentTarget.value)}
                placeholder="아이디(이메일)·이름·사업자번호·업체명 검색..."
                className="w-full h-8 pl-8 pr-8 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
              {searching && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-gray-400" />}
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {results.length === 0 ? (
              query.trim() && !searching ? (
                <div className="py-4 px-3 text-center bg-red-50 border-t border-red-100 space-y-2">
                  <AlertCircle className="w-5 h-5 text-red-500 mx-auto" />
                  <p className="text-xs font-semibold text-red-700">등록되지 않은 법인입니다</p>
                  {emptyAction}
                </div>
              ) : (
                <div className="py-5 px-3 text-center">
                  <p className="text-xs text-gray-400">{query.trim() ? "검색 중..." : "법인명·아이디·사업자번호를 입력하세요"}</p>
                </div>
              )
            ) : (
              results.map((d) => {
                const cat = d.category;
                const badge = cat === "ADMIN"
                  ? { label: "관리자", color: "bg-purple-100 text-purple-700 border border-purple-300" }
                  : cat === "DOCTOR" ? { label: "병원", color: "bg-rose-100 text-rose-700" }
                  : cat === "PHARMACIST" ? { label: "약국", color: "bg-emerald-100 text-emerald-700" }
                  : d.isBusinessApproved ? { label: "사업자 인증", color: "bg-blue-100 text-blue-700" }
                  : { label: "일반회원", color: "bg-gray-100 text-gray-600" };
                return (
                  <button key={`${d.clientName}-${d.bizNumber}-${d.userId ?? ""}`} type="button"
                    onClick={() => { onSelect(d); setOpen(false); setQuery(""); }}
                    className="w-full text-left px-3 py-2.5 text-xs hover:bg-gray-50 border-b border-gray-50 last:border-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${badge.color}`}>{badge.label}</span>
                      <p className="font-medium text-gray-800 truncate">{d.clientName}</p>
                    </div>
                    <p className="text-gray-400 font-mono">{d.bizNumber}</p>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   매핑 등록 작업대
   ① 거래처 입력(자동완성/신규 등록) → ② 제약사 입력(자동완성/필터링 요청)
   → ③ 제출법인 선택 → ④ 매핑 등록
   ───────────────────────────────────────────────────────────── */
function Workbench({
  me, userName, clients, routes, companies, filterReqs, refresh,
}: {
  me: MeInfo | null;
  userName: string;
  clients: UserClient[];
  routes: SubmissionRoute[];
  companies: Company[];
  filterReqs: FilterReq[];
  refresh: () => Promise<void>;
}) {
  type SelClient = { id?: string; clientName: string; bizNumber: string };
  // ── ① 거래처 ──
  const [clientQuery, setClientQuery] = useState("");
  const [selectedClient, setSelectedClient] = useState<SelClient | null>(null);
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const [showBizInput, setShowBizInput] = useState(false);
  const [newBiz, setNewBiz] = useState("");
  const [clientRegError, setClientRegError] = useState("");
  const [clientRegistering, setClientRegistering] = useState(false);
  const clientRef = useRef<HTMLDivElement>(null);
  // 선택된 거래처가 사업자번호 없을 때 인라인 보완
  const [bizFixValue, setBizFixValue] = useState("");
  const [bizFixSaving, setBizFixSaving] = useState(false);
  const [bizFixError, setBizFixError] = useState("");

  // ── ② 제약사 (칩 다중선택) ──
  const [companyQuery, setCompanyQuery] = useState("");
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
  const [filterRequesting, setFilterRequesting] = useState(false);
  const [filterMsg, setFilterMsg] = useState("");
  const companyRef = useRef<HTMLDivElement>(null);

  // ── ③ 제출법인 ──
  const [entityDealer, setEntityDealer] = useState<DealerResult | null>(null);
  const [useParent, setUseParent] = useState(false);

  // ── ④ 매핑 ──
  const [mapError, setMapError] = useState("");
  const [mapping, setMapping] = useState(false);
  const [mapDone, setMapDone] = useState("");

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (clientMenuOpen && clientRef.current && !clientRef.current.contains(e.target as Node)) setClientMenuOpen(false);
      if (companyMenuOpen && companyRef.current && !companyRef.current.contains(e.target as Node)) setCompanyMenuOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [clientMenuOpen, companyMenuOpen]);

  // 자동완성 소스 = 내 UserClient ∪ 내 SubmissionRoute distinct clientName (중복 제거).
  // SubmissionRoute 에만 있는 거래처(UserClient 미등록/타 owner)도 후보로 잡히도록 union.
  const clientCandidates = useMemo(() => {
    const byKey = new Map<string, SelClient>();
    for (const c of clients) {
      const k = companyNameKey(c.clientName);
      if (!byKey.has(k)) byKey.set(k, { id: c.id, clientName: c.clientName, bizNumber: c.bizNumber });
    }
    for (const r of routes) {
      const k = companyNameKey(r.clientName);
      if (!byKey.has(k)) byKey.set(k, { clientName: r.clientName, bizNumber: "" });
    }
    return Array.from(byKey.values()).sort((a, b) => a.clientName.localeCompare(b.clientName, "ko"));
  }, [clients, routes]);

  // 후보 = 입력값 부분일치(공백/대소문자 무시)로만. 무매칭이면 0개.
  // 사업자번호 매칭은 입력에 숫자가 있을 때만 (빈 문자열 .includes("") 전체매칭 방지).
  const clientMatches = useMemo(() => {
    const raw = clientQuery.trim();
    if (!raw) return clientCandidates.slice(0, 20); // 빈 입력(포커스) → 전체 목록 브라우즈
    const q = raw.replace(/\s+/g, "").toLowerCase();
    const qDigits = raw.replace(/\D/g, "");
    return clientCandidates
      .filter((c) =>
        c.clientName.replace(/\s+/g, "").toLowerCase().includes(q) ||
        (qDigits.length > 0 && c.bizNumber.replace(/\D/g, "").includes(qDigits)),
      )
      .slice(0, 20);
  }, [clientCandidates, clientQuery]);
  const exactClientMatch = useMemo(() => {
    const q = clientQuery.trim().replace(/\s+/g, "").toLowerCase();
    if (!q) return undefined;
    return clientCandidates.find((c) => c.clientName.replace(/\s+/g, "").toLowerCase() === q);
  }, [clientCandidates, clientQuery]);

  const companyMatches = useMemo(() => {
    const q = companyQuery.trim().toLowerCase();
    const sorted = companies.slice().sort((a, b) => normalizeCompanyName(a.name).localeCompare(normalizeCompanyName(b.name), "ko"));
    return (q ? sorted.filter((c) => c.name.toLowerCase().includes(q)) : sorted)
      .filter((c) => !selectedCompanies.includes(c.name))
      .slice(0, 30);
  }, [companies, companyQuery, selectedCompanies]);

  // 선택 거래처 × 제약사 필터링 기록 존재 여부 — clientName 기준 매칭
  // (즉석 등록 거래처는 bizNumber 가 없을 수 있어 clientName 으로 매칭해야 안전)
  const hasFilter = useCallback((company: string) => {
    if (!selectedClient) return false;
    const ck = companyNameKey(selectedClient.clientName);
    const key = companyNameKey(company);
    return filterReqs.some((r) => companyNameKey(r.clientName) === ck && companyNameKey(r.companyName) === key);
  }, [selectedClient, filterReqs]);

  const companiesNeedingFilter = useMemo(
    () => selectedCompanies.filter((c) => !hasFilter(c)),
    [selectedCompanies, hasFilter],
  );

  function pickClient(c: SelClient) {
    setSelectedClient(c);
    setClientQuery(c.clientName);
    setClientMenuOpen(false);
    setShowBizInput(false);
    setClientRegError("");
    // 거래처 바뀌면 제약사 칩 초기화
    setSelectedCompanies([]);
    setCompanyQuery("");
    setFilterMsg("");
  }

  async function registerNewClient() {
    setClientRegError("");
    const nm = clientQuery.trim();
    const digits = newBiz.replace(/\D/g, "");
    if (!nm) { setClientRegError("거래처명을 입력해주세요."); return; }
    if (!validateBizNumber(digits)) { setClientRegError("유효한 사업자등록번호(10자리)를 입력해주세요."); return; }
    setClientRegistering(true);
    try {
      const res = await fetch("/api/user-clients", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientName: nm, bizNumber: digits, dealerType: null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setClientRegError(data.error || "등록 실패"); return; }
      await refresh();
      pickClient({ id: data.id, clientName: data.clientName ?? nm, bizNumber: data.bizNumber ?? digits });
      setNewBiz("");
    } finally {
      setClientRegistering(false);
    }
  }

  function clearClient() {
    setSelectedClient(null);
    setClientQuery("");
    setClientMenuOpen(false);
    setShowBizInput(false);
    setClientRegError("");
    setSelectedCompanies([]);
    setCompanyQuery("");
    setFilterMsg("");
    setBizFixValue(""); setBizFixError("");
  }

  const clientHasBiz = !!selectedClient && selectedClient.bizNumber.replace(/\D/g, "").length > 0;

  // 사업자번호 없는 선택 거래처 인라인 보완 — UserClient 있으면 PATCH, 없으면 POST 신규
  async function saveBizFix() {
    if (!selectedClient) return;
    setBizFixError("");
    const digits = bizFixValue.replace(/\D/g, "");
    if (!validateBizNumber(digits)) { setBizFixError("유효한 사업자등록번호(10자리)를 입력해주세요."); return; }
    setBizFixSaving(true);
    try {
      const res = selectedClient.id
        ? await fetch(`/api/user-clients?id=${selectedClient.id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bizNumber: digits }),
          })
        : await fetch("/api/user-clients", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clientName: selectedClient.clientName, bizNumber: digits, dealerType: null }),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setBizFixError(data.error || "저장 실패"); return; }
      await refresh();
      setSelectedClient({ id: selectedClient.id ?? data.id, clientName: selectedClient.clientName, bizNumber: digits });
      setBizFixValue("");
    } finally {
      setBizFixSaving(false);
    }
  }

  function addCompany(name: string) {
    setSelectedCompanies((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setCompanyQuery("");
    setFilterMsg("");
  }
  function removeCompany(name: string) {
    setSelectedCompanies((prev) => prev.filter((c) => c !== name));
  }

  // 필터링 기록 없는 칩들만 일괄 요청
  async function requestFilter() {
    if (!selectedClient || companiesNeedingFilter.length === 0) return;
    setFilterMsg("");
    if (!selectedClient.bizNumber.replace(/\D/g, "")) {
      setFilterMsg("이 거래처는 사업자번호가 없어 필터링 요청을 보낼 수 없어요. 거래처관리에서 사업자번호를 보완해주세요.");
      return;
    }
    setFilterRequesting(true);
    try {
      const res = await fetch("/api/filter-request", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: me?.id,
          userName,
          clientName: selectedClient.clientName,
          bizNumber: selectedClient.bizNumber,
          companies: companiesNeedingFilter,
        }),
      });
      if (!res.ok) { setFilterMsg((await res.json().catch(() => ({}))).error || "필터링 요청 실패"); return; }
      setFilterMsg(`${companiesNeedingFilter.length}개 제약사 필터링을 요청했어요. 회신 후 거래 가능 여부가 확정됩니다.`);
      await refresh();
    } finally {
      setFilterRequesting(false);
    }
  }

  const entityName = useParent ? (me?.parent?.name || me?.parent?.email || "") : (entityDealer?.clientName || "");
  const parentUserId = useParent ? (me?.parent?.id ?? null) : (entityDealer?.userId ?? null);
  const canMap = !!selectedClient && selectedCompanies.length > 0 && !!entityName.trim();

  async function submitMapping() {
    setMapError(""); setMapDone("");
    if (!selectedClient) { setMapError("거래처를 선택해주세요."); return; }
    if (selectedCompanies.length === 0) { setMapError("제약사를 1개 이상 선택해주세요."); return; }
    if (!entityName.trim()) { setMapError("제출법인을 선택해주세요."); return; }
    setMapping(true);
    try {
      const entity = normalizeCompanyName(entityName);
      const results = await Promise.all(
        selectedCompanies.map(async (companyName) => {
          try {
            const r = await fetch("/api/submission-routes", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                clientName: selectedClient.clientName.trim(),
                companyName: normalizeCompanyName(companyName),
                submissionEntity: entity,
                parentUserId,
                requestType: "신규",
              }),
            });
            if (r.ok) return { ok: true, companyName, error: null as string | null };
            const b = await r.json().catch(() => ({}));
            return { ok: false, companyName, error: b?.error || `HTTP ${r.status}` };
          } catch (err) {
            return { ok: false, companyName, error: String(err).slice(0, 100) };
          }
        }),
      );
      const ok = results.filter((r) => r.ok).length;
      const failures = results.filter((r) => !r.ok);
      if (failures.length > 0) {
        setMapError(`${ok}건 등록, ${failures.length}건 실패 → ${failures.map((f) => `${f.companyName}: ${f.error}`).join(" / ")}`);
      }
      if (ok > 0) {
        setMapDone(`'${selectedClient.clientName} → ${entity}' 로 ${ok}개 제약사 매핑을 등록했어요.`);
        // 제약사 칩·법인만 초기화 (같은 거래처로 연속 등록 편의)
        setSelectedCompanies([]); setCompanyQuery("");
        setEntityDealer(null); setUseParent(false); setFilterMsg("");
      }
      await refresh();
    } finally {
      setMapping(false);
    }
  }

  const stepDone = (n: number) =>
    (n === 1 && selectedClient) || (n === 2 && selectedCompanies.length > 0) || (n === 3 && entityName.trim());

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-5 space-y-5">
      <div className="flex items-center gap-2">
        <ClipboardList className="w-5 h-5 text-blue-600" />
        <h2 className="text-base font-semibold text-gray-800">매핑 등록 작업대</h2>
      </div>

      {/* ① 거래처 */}
      <div className="space-y-1.5">
        <StepLabel n={1} done={!!stepDone(1)} icon={Stethoscope} text="거래처(병원)" />
        <div className="relative" ref={clientRef}>
          <div className="relative">
            <Input
              value={clientQuery}
              onChange={(e) => { setClientQuery(e.target.value); setSelectedClient(null); setClientMenuOpen(true); setShowBizInput(false); }}
              onCompositionEnd={(e) => { setClientQuery(e.currentTarget.value); setSelectedClient(null); setClientMenuOpen(true); setShowBizInput(false); }}
              onFocus={() => setClientMenuOpen(true)}
              placeholder="거래처명 입력 (자동완성)"
              className={selectedClient ? "border-blue-400 pr-9" : ""}
            />
            {selectedClient && (
              <button type="button" onClick={clearClient} title="선택 해제"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-blue-500 hover:text-red-500">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          {clientMenuOpen && !selectedClient && (clientMatches.length > 0 || (clientQuery.trim() && !exactClientMatch)) && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
              {clientMatches.map((c) => (
                <button key={c.id ?? c.clientName} type="button" onClick={() => pickClient(c)}
                  className="w-full text-left px-3 py-2.5 text-xs hover:bg-gray-50 border-b border-gray-50 last:border-0">
                  <p className="font-medium text-gray-800">{c.clientName}</p>
                  <p className="text-gray-400 font-mono">{c.bizNumber && !c.bizNumber.startsWith("temp-") ? c.bizNumber : <span className="text-gray-300">사업자번호 미입력</span>}</p>
                </button>
              ))}
              {clientQuery.trim() && !exactClientMatch && (
                <button type="button" onClick={() => { setShowBizInput(true); setClientMenuOpen(false); }}
                  className="w-full text-left px-3 py-2.5 text-xs hover:bg-blue-50 bg-blue-50/40 border-t border-blue-100 flex items-center gap-1.5 text-blue-700 font-medium">
                  <Plus className="w-3.5 h-3.5 shrink-0" />&quot;{clientQuery.trim()}&quot; 이름으로 등록
                </button>
              )}
            </div>
          )}
        </div>
        {showBizInput && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-md space-y-2">
            <p className="text-xs text-blue-800 font-medium">신규 거래처 등록: <span className="font-semibold">{clientQuery.trim()}</span></p>
            <div className="flex gap-2">
              <Input placeholder="사업자등록번호 * (필터링에 필요)" value={newBiz} onChange={(e) => setNewBiz(formatBizNumber(e.target.value))} maxLength={12} className="flex-1" />
              <Button type="button" size="sm" onClick={registerNewClient} disabled={clientRegistering}>
                {clientRegistering ? <Loader2 className="w-4 h-4 animate-spin" /> : "등록"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => { setShowBizInput(false); setClientRegError(""); setNewBiz(""); }}>취소</Button>
            </div>
            {clientRegError && <p className="text-xs text-red-600">{clientRegError}</p>}
            <p className="text-[11px] text-blue-600">주소 등 상세는 나중에 거래처관리에서 보완할 수 있어요.</p>
          </div>
        )}
      </div>

      {/* ② 제약사 (칩 다중선택) */}
      <div className={`space-y-1.5 ${!selectedClient ? "opacity-50 pointer-events-none" : ""}`}>
        <StepLabel n={2} done={!!stepDone(2)} icon={Pill} text="제약사 (복수 선택)" />
        {selectedClient && !clientHasBiz && (
          <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-md space-y-1.5">
            <p className="text-xs text-amber-800 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5 shrink-0" />이 거래처는 사업자번호가 없어 필터링 요청을 못 보내요. 여기서 바로 보완하세요.</p>
            <div className="flex gap-2">
              <Input placeholder="사업자등록번호 *" value={bizFixValue} onChange={(e) => setBizFixValue(formatBizNumber(e.target.value))} maxLength={12} className="flex-1 h-9" />
              <Button type="button" size="sm" onClick={saveBizFix} disabled={bizFixSaving}>
                {bizFixSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : "저장"}
              </Button>
            </div>
            {bizFixError && <p className="text-xs text-red-600">{bizFixError}</p>}
          </div>
        )}
        <div className="relative" ref={companyRef}>
          <div className="relative">
            <Input
              value={companyQuery}
              onChange={(e) => { setCompanyQuery(e.target.value); setCompanyMenuOpen(true); }}
              onCompositionEnd={(e) => { setCompanyQuery(e.currentTarget.value); setCompanyMenuOpen(true); }}
              onFocus={() => setCompanyMenuOpen(true)}
              placeholder="제약사명 입력 → 자동완성에서 선택 (여러 개 추가 가능)"
            />
          </div>
          {companyMenuOpen && companyMatches.length > 0 && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
              {companyMatches.map((c) => (
                <button key={c.name} type="button" onClick={() => addCompany(c.name)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0 text-gray-800 flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5 text-gray-400 shrink-0" />{c.name}
                </button>
              ))}
            </div>
          )}
        </div>
        {selectedCompanies.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {selectedCompanies.map((n) => {
              const ok = hasFilter(n);
              return (
                <span key={n} className={`inline-flex items-center gap-1 text-xs border px-2 py-1 rounded-full ${ok ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                  {ok ? <CheckCircle2 className="w-3 h-3 shrink-0" /> : <AlertCircle className="w-3 h-3 shrink-0" />}
                  {n}
                  {!ok && <span className="text-[10px] font-semibold">필터링 필요</span>}
                  <button type="button" onClick={() => removeCompany(n)} className="hover:text-red-500 ml-0.5">×</button>
                </span>
              );
            })}
          </div>
        )}
        {companiesNeedingFilter.length > 0 && (
          <div className="flex items-center justify-between gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-md">
            <p className="text-xs text-amber-800 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5 shrink-0" />필터링 기록이 없는 제약사 {companiesNeedingFilter.length}개가 있어요.</p>
            <Button type="button" size="sm" variant="outline" onClick={requestFilter} disabled={filterRequesting}>
              {filterRequesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Filter className="w-3.5 h-3.5 mr-1" />선택 제약사 필터링 요청</>}
            </Button>
          </div>
        )}
        {filterMsg && <p className="text-xs text-emerald-700">{filterMsg}</p>}
      </div>

      {/* ③ 제출법인 */}
      <div className={`space-y-1.5 ${selectedCompanies.length === 0 ? "opacity-50 pointer-events-none" : ""}`}>
        <StepLabel n={3} done={!!stepDone(3)} icon={Building2} text="제출법인" />
        {me?.parent && (
          <label className="flex items-center gap-2 text-sm p-2.5 bg-blue-50 border border-blue-200 rounded-md cursor-pointer">
            <input type="radio" checked={useParent} onChange={() => { setUseParent(true); setEntityDealer(null); }} className="w-4 h-4 text-blue-600" />
            <UserCheck className="w-4 h-4 text-blue-600 shrink-0" />
            <span className="text-blue-900 font-medium truncate">{me.parent.name || me.parent.email}</span>
            <span className="text-[11px] text-blue-600 ml-auto shrink-0">연결된 법인</span>
          </label>
        )}
        <label className="flex items-center gap-2">
          {me?.parent && <input type="radio" checked={!useParent} onChange={() => setUseParent(false)} className="w-4 h-4 text-blue-600 shrink-0" />}
          <div className="flex-1">
            <DealerDropdown
              selected={entityDealer}
              onSelect={(d) => { setEntityDealer(d); setUseParent(false); }}
              onClear={() => setEntityDealer(null)}
              placeholder={me?.parent ? "다른 법인 직접 검색" : "제출법인 검색"}
              emptyAction={
                <p className="text-[11px] text-red-600">
                  아래 <span className="font-semibold">상위법인 연결 관리</span>에서 연결 요청을 보내면 목록에 나타납니다.
                </p>
              }
            />
          </div>
        </label>
      </div>

      {/* ④ 매핑 등록 */}
      <div className="border-t border-gray-100 pt-4 space-y-2">
        {mapError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 p-2.5 rounded whitespace-pre-wrap">{mapError}</p>}
        {mapDone && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 p-2.5 rounded">{mapDone}</p>}
        <Button type="button" className="w-full" onClick={submitMapping} disabled={mapping || !canMap}>
          {mapping ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4 mr-1" />매핑 등록</>}
        </Button>
      </div>
    </section>
  );
}

function StepLabel({ n, done, icon: Icon, text }: { n: number; done: boolean; icon: React.ElementType; text: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${done ? "bg-emerald-500 text-white" : "bg-blue-600 text-white"}`}>
        {done ? "✓" : n}
      </span>
      <Icon className="w-4 h-4 text-gray-500 shrink-0" />
      <span className="text-sm font-medium text-gray-700">{text}</span>
    </div>
  );
}

/* 한글 IME 안전 자동완성 텍스트 입력 — 자유 입력 + 후보 선택 겸용.
   Input 이 조합 중 부모 onChange 를 막으므로 onCompositionEnd 로 DOM 값을 강제 동기화. */
function Autocomplete({
  value, onChange, options, placeholder, className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (open && ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const q = value.trim().replace(/\s+/g, "").toLowerCase();
  const matches = (q ? options.filter((o) => o.replace(/\s+/g, "").toLowerCase().includes(q)) : options).slice(0, 20);
  return (
    <div className="relative" ref={ref}>
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onCompositionEnd={(e) => { onChange(e.currentTarget.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className={className}
      />
      {open && matches.length > 0 && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {matches.map((o) => (
            <button key={o} type="button" onClick={() => { onChange(o); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0 text-gray-800">
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   세팅된 매핑 현황 (법인 > 거래처 > 제약사, 가나다순, 수정/삭제)
   ───────────────────────────────────────────────────────────── */
function StatusList({
  me, role, routes, clients, companies, loading, refresh,
}: {
  me: MeInfo | null;
  role: string;
  routes: SubmissionRoute[];
  clients: UserClient[];
  companies: Company[];
  loading: boolean;
  refresh: () => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_EDIT);
  const [editError, setEditError] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [search, setSearch] = useState("");

  // 통합 검색 — 병원명·제출법인·제약사 어디에 걸려도 매칭 (공백 제거 + 소문자 관대 비교)
  const filteredRoutes = useMemo(() => {
    const q = search.trim().replace(/\s+/g, "").toLowerCase();
    if (!q) return routes;
    const hit = (s: string) => s.replace(/\s+/g, "").toLowerCase().includes(q);
    return routes.filter((r) => hit(r.clientName) || hit(r.submissionEntity) || hit(r.companyName));
  }, [routes, search]);
  const matchCount = filteredRoutes.length;

  // 수정 폼 자동완성 후보 — 거래처: 내 UserClient ∪ route clientName, 제약사: medications/companies
  const clientOptions = useMemo(() => {
    const s = new Set<string>();
    for (const c of clients) s.add(c.clientName);
    for (const r of routes) s.add(r.clientName);
    return Array.from(s).sort((a, b) => a.localeCompare(b, "ko"));
  }, [clients, routes]);
  const companyOptions = useMemo(
    () => companies.map((c) => c.name).sort((a, b) => normalizeCompanyName(a).localeCompare(normalizeCompanyName(b), "ko")),
    [companies],
  );

  // 평면 정렬: 제출처 → 거래처 → 제약사 가나다순 (normalizeCompanyName 기준)
  const sortedRows = useMemo(() => {
    return filteredRoutes.slice().sort((a, b) => {
      const e = normalizeCompanyName(a.submissionEntity).localeCompare(normalizeCompanyName(b.submissionEntity), "ko");
      if (e !== 0) return e;
      const c = a.clientName.localeCompare(b.clientName, "ko");
      if (c !== 0) return c;
      return normalizeCompanyName(a.companyName).localeCompare(normalizeCompanyName(b.companyName), "ko");
    });
  }, [filteredRoutes]);

  function startEdit(r: SubmissionRoute) {
    if (r.ownerId !== me?.id && role !== "ADMIN") { alert("본인이 등록한 제출처만 수정할 수 있어요."); return; }
    setEditingId(r.id);
    setEditError("");
    setEditForm({
      clientName: r.clientName,
      companyName: r.companyName,
      submissionEntity: r.submissionEntity,
      submissionEmail: r.submissionEmail ?? "",
      requestType: r.requestType === "이관" ? "이관" : "신규",
      memo: r.memo ?? "",
    });
  }

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    setEditError("");
    if (!editForm.clientName.trim()) { setEditError("거래처명은 필수예요."); return; }
    if (!editForm.companyName.trim()) { setEditError("제약사명은 필수예요."); return; }
    if (!editForm.submissionEntity.trim()) { setEditError("제출법인은 필수예요."); return; }
    setEditSubmitting(true);
    try {
      const res = await fetch("/api/submission-routes", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId,
          clientName: normalizeCompanyName(editForm.clientName),
          companyName: normalizeCompanyName(editForm.companyName),
          submissionEntity: normalizeCompanyName(editForm.submissionEntity),
          submissionEmail: editForm.submissionEmail.trim(),
          requestType: editForm.requestType,
          memo: editForm.memo.trim(),
        }),
      });
      if (!res.ok) { setEditError((await res.json().catch(() => ({}))).error || "수정 실패"); return; }
      setEditingId(null); setEditForm(EMPTY_EDIT);
      await refresh();
    } finally {
      setEditSubmitting(false);
    }
  }

  async function deleteRoute(r: SubmissionRoute) {
    if (r.ownerId !== me?.id && role !== "ADMIN") { alert("본인이 등록한 제출처만 삭제할 수 있어요."); return; }
    if (!confirm(`'${r.clientName} → ${r.companyName}' 제출처를 삭제할까요?`)) return;
    const res = await fetch(`/api/submission-routes?id=${r.id}`, { method: "DELETE" });
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error || "삭제 실패"); return; }
    await refresh();
  }

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <ClipboardList className="w-5 h-5 text-gray-500" />
        <h2 className="text-base font-semibold text-gray-800">세팅된 매핑 현황</h2>
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onCompositionEnd={(e) => setSearch(e.currentTarget.value)}
            placeholder="병원·제출법인·제약사 통합검색"
            className="pl-8 pr-8 h-9"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      {search.trim() && !loading && (
        <p className="text-xs text-gray-500">검색 결과 {matchCount}건</p>
      )}

      {editingId && (
        <form onSubmit={submitEdit} className="grid grid-cols-1 md:grid-cols-2 gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md">
          <p className="md:col-span-2 text-xs text-amber-800 font-semibold">매핑 수정 중 — 거래처·제약사·제출법인 모두 수정 가능</p>
          <label className="text-[11px] text-amber-700 font-medium">거래처
            <Autocomplete value={editForm.clientName} onChange={(v) => setEditForm({ ...editForm, clientName: v })} options={clientOptions} placeholder="거래처명 *" />
          </label>
          <label className="text-[11px] text-amber-700 font-medium">제약사
            <Autocomplete value={editForm.companyName} onChange={(v) => setEditForm({ ...editForm, companyName: v })} options={companyOptions} placeholder="제약사명 *" />
          </label>
          <Input placeholder="제출법인 *" value={editForm.submissionEntity} onChange={(e) => setEditForm({ ...editForm, submissionEntity: e.target.value })} onCompositionEnd={(e) => setEditForm({ ...editForm, submissionEntity: e.currentTarget.value })} />
          <Input placeholder="제출 이메일 (선택)" type="email" value={editForm.submissionEmail} onChange={(e) => setEditForm({ ...editForm, submissionEmail: e.target.value })} />
          <select value={editForm.requestType} onChange={(e) => setEditForm({ ...editForm, requestType: e.target.value as "신규" | "이관" })} className="border border-gray-300 rounded-md px-3 py-2 text-sm">
            <option value="신규">신규</option>
            <option value="이관">이관</option>
          </select>
          <Input placeholder="메모 (선택)" value={editForm.memo} onChange={(e) => setEditForm({ ...editForm, memo: e.target.value })} onCompositionEnd={(e) => setEditForm({ ...editForm, memo: e.currentTarget.value })} />
          <div className="md:col-span-2 flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => { setEditingId(null); setEditForm(EMPTY_EDIT); setEditError(""); }}>취소</Button>
            <Button type="submit" disabled={editSubmitting}>{editSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Pencil className="w-4 h-4 mr-1" />수정 저장</>}</Button>
          </div>
          {editError && <p className="md:col-span-2 text-xs text-red-600">{editError}</p>}
        </form>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">불러오는 중...</p>
      ) : sortedRows.length === 0 ? (
        <p className="text-sm text-gray-500">
          {search.trim() ? "검색 결과가 없어요." : "등록된 매핑이 없어요. 위 작업대에서 거래처·제약사·제출법인을 선택해 등록하세요."}
        </p>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-md">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-3 py-2 font-medium">제출처</th>
                <th className="text-left px-3 py-2 font-medium">거래처</th>
                <th className="text-left px-3 py-2 font-medium">제약사</th>
                <th className="text-left px-3 py-2 font-medium">이메일</th>
                <th className="text-left px-3 py-2 font-medium">구분</th>
                <th className="text-right px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => {
                const canEdit = r.ownerId === me?.id || role === "ADMIN";
                return (
                  <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50/60">
                    <td className="px-3 py-2 text-gray-700">
                      <span className="inline-flex items-center gap-1">
                        <Building2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />{r.submissionEntity}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-700">{r.clientName}</td>
                    <td className="px-3 py-2 text-gray-800">{r.companyName}</td>
                    <td className="px-3 py-2 text-gray-500">{r.submissionEmail || "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${r.requestType === "이관" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>{r.requestType}</span>
                      {r.ownerId !== me?.id && <span className="ml-1 text-[10px] text-gray-400">(공용)</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canEdit ? (
                        <div className="inline-flex gap-1">
                          <button onClick={() => startEdit(r)} className="p-1 text-gray-400 hover:text-blue-600"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => deleteRoute(r)} className="p-1 text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      ) : <span className="text-[10px] text-gray-400">조회만</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-gray-400">
        월별 제출 여부는 <Link href="/stats/submission-status" className="underline hover:text-gray-600">제출현황</Link> 메뉴에서 확인하세요.
      </p>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   상위법인 연결 관리 (접이식) — 연결 요청 + 받은 요청 inbox 유지
   ───────────────────────────────────────────────────────────── */
function CorpLinkPanel({
  me, outgoing, incoming, refresh,
}: {
  me: MeInfo | null;
  outgoing: LinkRequest[];
  incoming: LinkRequest[];
  refresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [selectedDealer, setSelectedDealer] = useState<DealerResult | null>(null);
  const [linkError, setLinkError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const pendingOutgoing = outgoing.filter((r) => r.status === "PENDING");
  const pendingIncoming = incoming.filter((r) => r.status === "PENDING");

  async function submitLink() {
    setLinkError("");
    const email = selectedDealer?.email?.trim();
    if (!email) { setLinkError("연결할 법인 회원을 검색해서 선택해주세요."); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/parent-link-requests", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetEmail: email }),
      });
      const data = await res.json();
      if (!res.ok) { setLinkError(data.error || "요청 실패"); return; }
      setSelectedDealer(null);
      await refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelLink(id: string) {
    if (!confirm("요청을 취소할까요?")) return;
    await fetch("/api/parent-link-requests", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "cancel" }),
    });
    await refresh();
  }

  async function decideLink(id: string, action: "approve" | "reject") {
    let reason: string | null = null;
    if (action === "reject") {
      const r = prompt("거절 사유 (선택)");
      if (r === null) return;
      reason = r.trim() || null;
    } else if (!confirm("이 요청을 승인할까요? 승인하면 요청자가 본인의 하위로 연결됩니다.")) return;
    const res = await fetch("/api/parent-link-requests", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, reason }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || (action === "approve" ? "승인 실패" : "거절 실패"));
      return;
    }
    await refresh();
  }

  return (
    <section className="bg-white border border-gray-200 rounded-lg">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 px-5 py-4 text-left">
        {open ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
        <UserPlus className="w-5 h-5 text-emerald-600" />
        <h2 className="text-base font-semibold text-gray-800">상위법인 연결 관리</h2>
        <span className="text-xs text-gray-400 ml-auto">
          {me?.parent ? "연결됨" : pendingOutgoing.length > 0 ? "요청 중" : "미연결"}
          {pendingIncoming.length > 0 && ` · 받은 요청 ${pendingIncoming.length}`}
        </span>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-gray-100 pt-4">
          {/* 내 상위 법인 */}
          {me?.parent ? (
            <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-md">
              <UserCheck className="w-5 h-5 text-blue-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-blue-900 truncate">{me.parent.name || me.parent.email}</p>
                <p className="text-xs text-blue-700 truncate">{me.parent.email}</p>
              </div>
              <span className="text-xs text-blue-600 shrink-0">변경 문의: 관리자</span>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-gray-500">법인 회원을 검색해 연결 요청을 보내세요. 승인되면 제출법인 선택에서 바로 사용할 수 있어요.</p>
              {pendingOutgoing.length > 0 ? (
                pendingOutgoing.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-md">
                    <Send className="w-4 h-4 text-amber-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-amber-900 truncate">{r.targetEmailSnapshot} 에게 요청 중</p>
                      <p className="text-xs text-amber-700">{new Date(r.createdAt).toLocaleString("ko-KR")}</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => cancelLink(r.id)}>취소</Button>
                  </div>
                ))
              ) : (
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="flex-1">
                    <DealerDropdown selected={selectedDealer} onSelect={setSelectedDealer} onClear={() => setSelectedDealer(null)} placeholder="상위법인 회원 검색" />
                  </div>
                  <Button onClick={submitLink} disabled={submitting || !selectedDealer}>
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Mail className="w-4 h-4 mr-1" />연결 요청</>}
                  </Button>
                </div>
              )}
              {linkError && <p className="text-xs text-red-600">{linkError}</p>}
            </div>
          )}

          {/* 받은 연결 요청 */}
          <div className="border-t border-gray-100 pt-3 space-y-2">
            <div className="flex items-center gap-2">
              <Inbox className="w-4 h-4 text-purple-600" />
              <h3 className="text-sm font-semibold text-gray-700">받은 연결 요청 ({pendingIncoming.length})</h3>
            </div>
            {pendingIncoming.length === 0 ? (
              <p className="text-sm text-gray-400">현재 처리할 요청이 없어요.</p>
            ) : (
              pendingIncoming.map((r) => (
                <div key={r.id} className="flex items-center gap-3 p-3 bg-purple-50 border border-purple-200 rounded-md">
                  <UserPlus className="w-4 h-4 text-purple-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-purple-900 truncate">{r.requester.name || r.requester.email}</p>
                    <p className="text-xs text-purple-700 truncate">{r.requester.email} · {new Date(r.createdAt).toLocaleString("ko-KR")}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => decideLink(r.id, "reject")}>거절</Button>
                  <Button size="sm" onClick={() => decideLink(r.id, "approve")}><CheckCircle className="w-4 h-4 mr-1" />승인</Button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}
