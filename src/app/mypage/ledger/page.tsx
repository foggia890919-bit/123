"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Building2, ChevronRight, ChevronLeft, Loader2, Calendar,
  TrendingUp, Wallet, AlertCircle, Download, RefreshCw,
} from "lucide-react";

interface AccountSummary {
  id: string;
  bizNumber: string;
  clientName: string;
  active: boolean;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  _count: { ledgerEntries: number };
  latestEntry: { entryDate: string; balance: string } | null;
}

interface LedgerEntry {
  id: string;
  entryDate: string;
  itemName: string;
  sales: string;
  payment: string;
  balance: string;
}

const fmtMoney = (v: string | number) => {
  const n = Number(v);
  if (!isFinite(n)) return "—";
  return n.toLocaleString("ko-KR");
};
const fmtDate = (s: string) => new Date(s).toISOString().slice(0, 10);
const todayStr = () => new Date().toISOString().slice(0, 10);
const daysAgoStr = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

export default function LedgerPage() {
  const { status } = useSession();
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AccountSummary | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [from, setFrom] = useState(daysAgoStr(180));
  const [to, setTo] = useState(todayStr());

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login?callbackUrl=/mypage/ledger");
  }, [status, router]);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/ledger");
      if (r.ok) {
        const body = await r.json();
        setAccounts(body.accounts ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadEntries = useCallback(
    async (bizNumber: string) => {
      setEntriesLoading(true);
      try {
        const url = `/api/ledger?bizNumber=${bizNumber}&from=${from}&to=${to}`;
        const r = await fetch(url);
        if (r.ok) {
          const body = await r.json();
          setEntries(body.entries ?? []);
        }
      } finally {
        setEntriesLoading(false);
      }
    },
    [from, to]
  );

  useEffect(() => { if (status === "authenticated") loadList(); }, [status, loadList]);
  useEffect(() => { if (selected) loadEntries(selected.bizNumber); }, [selected, loadEntries]);

  const totals = useMemo(() => {
    let sales = 0, payment = 0;
    for (const e of entries) {
      sales += Number(e.sales);
      payment += Number(e.payment);
    }
    const lastBalance = entries.length ? Number(entries[entries.length - 1].balance) : 0;
    return { sales, payment, balance: lastBalance };
  }, [entries]);

  function downloadCsv() {
    if (!selected) return;
    const header = "명세일자,항목,매출,수금,잔액\n";
    const body = entries
      .map((e) =>
        [
          fmtDate(e.entryDate),
          `"${e.itemName.replace(/"/g, '""')}"`,
          e.sales, e.payment, e.balance,
        ].join(",")
      )
      .join("\n");
    const blob = new Blob(["﻿" + header + body], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selected.clientName}_매출원장_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (status === "loading") {
    return <div className="py-20 text-center text-gray-400">불러오는 중…</div>;
  }

  // ==================== 거래처 목록 화면 ====================
  if (!selected) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">거래처 매출원장</h1>
            <p className="text-sm text-gray-500 mt-1">
              담당하는 거래처의 매출/수금/잔액을 매일 새벽 자동 수집한 데이터로 확인합니다.
            </p>
          </div>
          <button
            onClick={loadList}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <RefreshCw className="w-4 h-4" /> 새로고침
          </button>
        </div>

        {loading ? (
          <div className="py-20 text-center text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin inline mr-2" /> 불러오는 중…
          </div>
        ) : accounts.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
            <Building2 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">담당 거래처가 없습니다.</p>
            <p className="text-xs text-gray-400 mt-1">
              관리자에게 거래처 매핑(UserClient)을 요청하거나, 해당 거래처의 ePharms 계정 등록을 확인하세요.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {accounts.map((a) => (
              <button
                key={a.id}
                onClick={() => setSelected(a)}
                className="bg-white text-left border border-gray-200 rounded-lg p-4 hover:border-blue-400 hover:shadow-sm transition"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-semibold text-gray-900">{a.clientName}</div>
                    <div className="text-xs text-gray-400 font-mono">{a.bizNumber}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 mt-1" />
                </div>
                {a.latestEntry ? (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <div className="text-[11px] text-gray-400">최근 잔액 ({fmtDate(a.latestEntry.entryDate)})</div>
                    <div className="text-lg font-bold text-blue-700">
                      {fmtMoney(a.latestEntry.balance)}원
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400">
                    아직 수집된 데이터 없음
                  </div>
                )}
                <div className="flex items-center justify-between mt-2 text-[11px] text-gray-400">
                  <span>총 {a._count.ledgerEntries.toLocaleString()}건</span>
                  <span>{a.lastSyncedAt ? `${fmtDate(a.lastSyncedAt)} sync` : "미실행"}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ==================== 단일 거래처 상세 화면 ====================
  return (
    <div className="max-w-6xl mx-auto p-6">
      <button
        onClick={() => setSelected(null)}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 mb-3"
      >
        <ChevronLeft className="w-4 h-4" /> 거래처 목록
      </button>
      <div className="flex items-end justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{selected.clientName}</h1>
          <div className="text-xs text-gray-400 font-mono mt-0.5">{selected.bizNumber}</div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="w-4 h-4 text-gray-400" />
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="px-2 py-1.5 border border-gray-200 rounded-md text-sm" />
          <span className="text-gray-400">~</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="px-2 py-1.5 border border-gray-200 rounded-md text-sm" />
          <button
            onClick={() => loadEntries(selected.bizNumber)}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
          >
            조회
          </button>
          <button
            onClick={downloadCsv}
            disabled={entries.length === 0}
            className="flex items-center gap-1 px-3 py-1.5 border border-gray-200 rounded-md hover:bg-gray-50 text-sm disabled:opacity-40"
          >
            <Download className="w-4 h-4" /> CSV
          </button>
        </div>
      </div>

      {/* 합계 카드 */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-500 flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5" /> 기간 매출</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{fmtMoney(totals.sales)}원</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-500 flex items-center gap-1"><Wallet className="w-3.5 h-3.5" /> 기간 수금</div>
          <div className="text-xl font-bold text-green-700 mt-1">{fmtMoney(totals.payment)}원</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-500 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> 최종 잔액</div>
          <div className="text-xl font-bold text-blue-700 mt-1">{fmtMoney(totals.balance)}원</div>
        </div>
      </div>

      {/* 명세 테이블 */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">명세일자</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">항목</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">매출</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">수금</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">잔액</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {entriesLoading && (
              <tr><td colSpan={5} className="py-12 text-center text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin inline mr-2" /> 불러오는 중…
              </td></tr>
            )}
            {!entriesLoading && entries.length === 0 && (
              <tr><td colSpan={5} className="py-12 text-center text-gray-400">
                해당 기간의 명세가 없습니다.
              </td></tr>
            )}
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-2 text-sm text-gray-700 whitespace-nowrap">{fmtDate(e.entryDate)}</td>
                <td className="px-4 py-2 text-sm text-gray-900">{e.itemName}</td>
                <td className="px-4 py-2 text-sm text-right text-gray-900 font-mono">
                  {Number(e.sales) ? fmtMoney(e.sales) : ""}
                </td>
                <td className="px-4 py-2 text-sm text-right text-green-700 font-mono">
                  {Number(e.payment) ? fmtMoney(e.payment) : ""}
                </td>
                <td className="px-4 py-2 text-sm text-right text-blue-700 font-mono font-semibold">
                  {fmtMoney(e.balance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
