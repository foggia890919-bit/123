"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import {
  Building2, ChevronRight, ChevronLeft, Loader2, Calendar,
  TrendingUp, Wallet, AlertCircle, FileSpreadsheet, FileText,
  RefreshCw, X, Printer,
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function formatMoneyInput(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString("ko-KR");
}

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

  function downloadExcel() {
    if (!selected) return;
    const wsData = [
      ["명세일자", "항목", "매출", "수금", "잔액"],
      ...entries.map((e) => [
        fmtDate(e.entryDate),
        e.itemName,
        Number(e.sales),
        Number(e.payment),
        Number(e.balance),
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = [{ wch: 12 }, { wch: 60 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "매출원장");
    XLSX.writeFile(wb, `${selected.clientName}_매출원장_${from}_${to}.xlsx`);
  }

  // ===== 수금요청서 =====
  const [collectionModal, setCollectionModal] = useState(false);
  const [groupMode, setGroupMode] = useState<"date" | "item">("date");
  const [requestAmountInput, setRequestAmountInput] = useState("");

  // 날짜별 묶음 (같은 날짜끼리 합계)
  const dateGrouped = useMemo(() => {
    const map = new Map<string, { date: string; sales: number; payment: number; items: string[] }>();
    for (const e of entries) {
      const key = fmtDate(e.entryDate);
      const cur = map.get(key) ?? { date: key, sales: 0, payment: 0, items: [] };
      cur.sales += Number(e.sales);
      cur.payment += Number(e.payment);
      if (e.itemName) cur.items.push(e.itemName);
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [entries]);

  // 수금요청 금액 — 입력값 우선, 비어있으면 전체잔액
  const requestAmount = useMemo(() => {
    const parsed = Number(requestAmountInput.replace(/,/g, ""));
    if (requestAmountInput.trim() && isFinite(parsed) && parsed > 0) return parsed;
    return totals.balance;
  }, [requestAmountInput, totals.balance]);
  const isAutoAmount = !(requestAmountInput.trim() && Number(requestAmountInput.replace(/,/g, "")) > 0);

  function openCollectionModal() {
    setRequestAmountInput("");
    setGroupMode("date");
    setCollectionModal(true);
  }

  function printCollectionRequest() {
    if (!selected) return;
    const today = todayStr();
    const rowsHtml = groupMode === "date"
      ? dateGrouped.map(g => `
          <tr>
            <td>${g.date}</td>
            <td class="r">${fmtMoney(g.sales)}</td>
            <td class="r">${fmtMoney(g.payment)}</td>
            <td class="memo">${g.items.length}건</td>
          </tr>`).join("")
      : entries.map(e => `
          <tr>
            <td>${fmtDate(e.entryDate)}</td>
            <td class="memo">${escapeHtml(e.itemName)}</td>
            <td class="r">${Number(e.sales) ? fmtMoney(e.sales) : ""}</td>
            <td class="r">${Number(e.payment) ? fmtMoney(e.payment) : ""}</td>
          </tr>`).join("");

    const headerRow = groupMode === "date"
      ? `<tr><th>일자</th><th>매출</th><th>수금</th><th>비고</th></tr>`
      : `<tr><th>일자</th><th>품목</th><th>매출</th><th>수금</th></tr>`;

    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>수금요청서 - ${escapeHtml(selected.clientName)}</title>
      <style>
        @page { size: A4; margin: 18mm; }
        body { font-family: -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; color:#111; font-size:13px; }
        h1 { font-size:24px; text-align:center; letter-spacing:8px; margin:0 0 24px; }
        .meta { display:grid; grid-template-columns:1fr 1fr; gap:6px 16px; margin-bottom:18px; padding:12px 16px; border:1px solid #ddd; border-radius:6px; }
        .meta dt { color:#666; font-weight:500; }
        .meta dd { margin:0; }
        .amount-box { text-align:center; padding:18px; border:2px solid #1d4ed8; border-radius:6px; margin:12px 0 22px; }
        .amount-box .label { color:#1d4ed8; font-size:12px; letter-spacing:2px; }
        .amount-box .value { font-size:30px; font-weight:bold; color:#1d4ed8; margin-top:6px; }
        .amount-box .note { color:#888; font-size:11px; margin-top:4px; }
        table { width:100%; border-collapse:collapse; margin-top:8px; }
        th, td { border:1px solid #ccc; padding:6px 8px; }
        th { background:#f5f5f5; font-weight:600; }
        td.r { text-align:right; font-variant-numeric:tabular-nums; }
        td.memo { color:#444; }
        .footer { margin-top:36px; padding-top:14px; border-top:2px solid #333; text-align:center; color:#444; font-size:12px; line-height:1.7; }
        .print-btn { position:fixed; top:12px; right:12px; padding:8px 18px; background:#16a34a; color:#fff; border:0; border-radius:6px; cursor:pointer; font-size:14px; }
        @media print { .print-btn { display:none; } }
      </style></head><body>
      <button class="print-btn" onclick="window.print()">🖨️ 인쇄 / PDF 저장</button>
      <h1>수 금 요 청 서</h1>
      <dl class="meta">
        <div><dt>거래처명</dt><dd>${escapeHtml(selected.clientName)}</dd></div>
        <div><dt>사업자번호</dt><dd>${escapeHtml(selected.bizNumber)}</dd></div>
        <div><dt>발행일</dt><dd>${today}</dd></div>
        <div><dt>조회기간</dt><dd>${from} ~ ${to}</dd></div>
      </dl>
      <div class="amount-box">
        <div class="label">수 금 요 청 금 액</div>
        <div class="value">${fmtMoney(requestAmount)} 원</div>
        ${isAutoAmount ? '<div class="note">※ 미입력 — 최종 잔액 기준 자동 산정</div>' : ""}
      </div>
      <table>
        <thead>${headerRow}</thead>
        <tbody>${rowsHtml || `<tr><td colspan="4" style="text-align:center;color:#888;padding:20px">명세 없음</td></tr>`}</tbody>
      </table>
      <div class="footer">
        상기 금액의 송금을 요청드립니다.<br/>
        문의는 담당 영업사원 또는 본사로 부탁드립니다.
      </div>
      <script>setTimeout(()=>window.focus(),100);</script>
    </body></html>`;

    const w = window.open("", "_blank", "width=900,height=1200");
    if (!w) { alert("팝업이 차단되어 있습니다. 팝업 허용 후 다시 시도해주세요."); return; }
    w.document.open(); w.document.write(html); w.document.close();
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
            onClick={downloadExcel}
            disabled={entries.length === 0}
            className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-md text-sm font-medium disabled:opacity-40"
          >
            <FileSpreadsheet className="w-4 h-4" /> 엑셀다운
          </button>
          <button
            onClick={openCollectionModal}
            disabled={entries.length === 0}
            className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-sm font-medium disabled:opacity-40"
          >
            <FileText className="w-4 h-4" /> 수금요청서 생성
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

      {/* ===== 수금요청서 모달 ===== */}
      {collectionModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setCollectionModal(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white z-10">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <FileText className="w-5 h-5 text-amber-600" /> 수금요청서 생성
              </h2>
              <button onClick={() => setCollectionModal(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>

            <div className="p-6 space-y-5">
              {/* 묶음 방식 */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2">묶음 방식</label>
                <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
                  <button
                    onClick={() => setGroupMode("date")}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${groupMode === "date" ? "bg-amber-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
                  >
                    날짜별 (같은 일자 묶음)
                  </button>
                  <button
                    onClick={() => setGroupMode("item")}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${groupMode === "item" ? "bg-amber-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
                  >
                    품목별 (개별 명세)
                  </button>
                </div>
              </div>

              {/* 수금요청 금액 */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  수금요청 금액
                  <span className="ml-2 text-[11px] font-normal text-gray-400">
                    비워두면 최종 잔액({fmtMoney(totals.balance)}원)으로 자동 설정
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={requestAmountInput}
                    onChange={(e) => setRequestAmountInput(formatMoneyInput(e.target.value))}
                    placeholder={fmtMoney(totals.balance)}
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono text-right"
                  />
                  <span className="text-sm text-gray-500">원</span>
                </div>
                <div className="mt-1 text-xs">
                  {isAutoAmount
                    ? <span className="text-gray-400">→ 자동: <b>{fmtMoney(totals.balance)}원</b> (전체 잔액)</span>
                    : <span className="text-amber-700">→ 입력값: <b>{fmtMoney(requestAmount)}원</b></span>}
                </div>
              </div>

              {/* 미리보기 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-700">미리보기</label>
                  <span className="text-[11px] text-gray-400">
                    {groupMode === "date"
                      ? `${dateGrouped.length}개 일자`
                      : `${entries.length}개 명세`}
                  </span>
                </div>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  {/* 헤더: 거래처/금액 */}
                  <div className="bg-gray-50 px-4 py-3 border-b flex items-center justify-between text-xs">
                    <div>
                      <div className="text-gray-500">거래처</div>
                      <div className="font-semibold text-gray-900 text-sm">{selected.clientName}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-gray-500">수금요청금액</div>
                      <div className="font-bold text-amber-700 text-base">{fmtMoney(requestAmount)}원</div>
                    </div>
                  </div>
                  {/* 명세 */}
                  <div className="max-h-72 overflow-y-auto">
                    <table className="min-w-full text-xs">
                      {groupMode === "date" ? (
                        <>
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="px-3 py-2 text-left text-gray-500">일자</th>
                              <th className="px-3 py-2 text-right text-gray-500">매출</th>
                              <th className="px-3 py-2 text-right text-gray-500">수금</th>
                              <th className="px-3 py-2 text-left text-gray-500">비고</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {dateGrouped.map((g) => (
                              <tr key={g.date}>
                                <td className="px-3 py-1.5 whitespace-nowrap">{g.date}</td>
                                <td className="px-3 py-1.5 text-right font-mono">{g.sales ? fmtMoney(g.sales) : ""}</td>
                                <td className="px-3 py-1.5 text-right font-mono text-green-700">{g.payment ? fmtMoney(g.payment) : ""}</td>
                                <td className="px-3 py-1.5 text-gray-500">{g.items.length}건</td>
                              </tr>
                            ))}
                            {dateGrouped.length === 0 && (
                              <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400">명세 없음</td></tr>
                            )}
                          </tbody>
                        </>
                      ) : (
                        <>
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="px-3 py-2 text-left text-gray-500">일자</th>
                              <th className="px-3 py-2 text-left text-gray-500">품목</th>
                              <th className="px-3 py-2 text-right text-gray-500">매출</th>
                              <th className="px-3 py-2 text-right text-gray-500">수금</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {entries.map((e) => (
                              <tr key={e.id}>
                                <td className="px-3 py-1.5 whitespace-nowrap">{fmtDate(e.entryDate)}</td>
                                <td className="px-3 py-1.5">{e.itemName}</td>
                                <td className="px-3 py-1.5 text-right font-mono">{Number(e.sales) ? fmtMoney(e.sales) : ""}</td>
                                <td className="px-3 py-1.5 text-right font-mono text-green-700">{Number(e.payment) ? fmtMoney(e.payment) : ""}</td>
                              </tr>
                            ))}
                            {entries.length === 0 && (
                              <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400">명세 없음</td></tr>
                            )}
                          </tbody>
                        </>
                      )}
                    </table>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 px-6 pb-5 sticky bottom-0 bg-white border-t pt-4">
              <button
                onClick={() => setCollectionModal(false)}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                취소
              </button>
              <button
                onClick={printCollectionRequest}
                disabled={entries.length === 0}
                className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg disabled:opacity-40"
              >
                <Printer className="w-4 h-4" /> 출력 / PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
