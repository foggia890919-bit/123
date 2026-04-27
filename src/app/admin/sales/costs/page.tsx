"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface CostRow {
  id: string;
  productId: string;
  storeName: string;
  productName: string;
  channelProductNo: string;
  optionName: string;
  keyword: string;
  bottlesPerUnit: number;
  unitCost: number;
  shippingCost: number;
  fulfillCost: number;
  packagingCost: number;
  etcCost: number;
}

export default function CostsPage() {
  const [rows, setRows] = useState<CostRow[]>([]);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [filter, setFilter] = useState("");

  async function load() {
    const r = await fetch("/api/sales/costs");
    if (r.ok) {
      const data = await r.json();
      setRows(data.rows ?? []);
      setSheetUrl(data.sheetUrl ?? null);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function uploadFile() {
    if (!file) return;
    setBusy(true);
    setMsg("업로드 중…");
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/sales/costs/upload", { method: "POST", body: fd });
    const data = await r.json();
    setMsg(r.ok ? `업로드 완료: ${data.count}건` : `실패: ${data.error}`);
    setBusy(false);
    load();
  }

  async function saveRow(row: CostRow) {
    setBusy(true);
    const r = await fetch(`/api/sales/costs/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    });
    setMsg(r.ok ? `저장됨: ${row.productName} / ${row.optionName || "(기본)"}` : "저장 실패");
    setBusy(false);
    load();
  }

  const filtered = filter
    ? rows.filter((r) =>
        [r.storeName, r.productName, r.optionName, r.keyword].some((s) => s.toLowerCase().includes(filter.toLowerCase())),
      )
    : rows;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin/sales" className="text-sm text-gray-500 hover:underline">
            ← 매출 홈
          </Link>
          <h1 className="text-2xl font-bold">원가 · 키워드 매핑</h1>
        </div>
        {sheetUrl && (
          <a
            href={sheetUrl}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-2 rounded-md border border-gray-300 bg-white text-sm hover:bg-gray-50"
          >
            📄 구글시트 (실시간)
          </a>
        )}
      </div>

      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
        <b>키워드</b> = 매출보고에서 합산할 품종 단위. 같은 「피쿠알」을 옵션 여러개에 동일하게 적으면 합쳐서 집계됩니다.<br />
        <b>병수/단위</b> = 옵션 1회 판매 시 출고되는 병(개) 수. 1병 옵션은 1, 3병 세트는 3.
      </div>

      <section className="rounded-md border bg-white p-4">
        <h2 className="font-semibold mb-2">엑셀/CSV 업로드</h2>
        <p className="text-xs text-gray-500 mb-2">
          헤더: 스토어코드, 채널상품번호 (또는 상품명), 옵션, 키워드, 병수, 원가, 물류비, 입출고비, 부자재비, 기타비
        </p>
        <div className="flex gap-2 items-center">
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
          <button
            onClick={uploadFile}
            disabled={!file || busy}
            className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm disabled:opacity-50"
          >
            업로드
          </button>
          <input
            placeholder="검색 (스토어/상품/옵션/키워드)"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="ml-auto border rounded px-2 py-1 text-sm w-72"
          />
        </div>
        {msg && <div className="text-sm text-gray-700 mt-2">{msg}</div>}
      </section>

      <section className="rounded-md border bg-white p-4 overflow-x-auto">
        <h2 className="font-semibold mb-3">원가 매핑 ({filtered.length}/{rows.length})</h2>
        <table className="text-sm min-w-[1200px]">
          <thead className="text-left text-gray-500">
            <tr>
              <th>스토어</th>
              <th>상품</th>
              <th>옵션</th>
              <th>키워드</th>
              <th>병수</th>
              <th className="text-right">원가</th>
              <th className="text-right">물류</th>
              <th className="text-right">입출고</th>
              <th className="text-right">부자재</th>
              <th className="text-right">기타</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={r.id} className="border-t">
                <td className="py-1 pr-2">{r.storeName}</td>
                <td className="pr-2">{r.productName}</td>
                <td className="pr-2">
                  <input
                    className="border rounded px-1 w-40"
                    value={r.optionName}
                    onChange={(e) => updateField(setRows, rows, r.id, "optionName", e.target.value)}
                  />
                </td>
                <td className="pr-2">
                  <input
                    className="border rounded px-1 w-28"
                    placeholder="피쿠알"
                    value={r.keyword}
                    onChange={(e) => updateField(setRows, rows, r.id, "keyword", e.target.value)}
                  />
                </td>
                <td className="pr-2">
                  <input
                    type="number"
                    min={1}
                    className="border rounded px-1 w-16 text-right"
                    value={r.bottlesPerUnit}
                    onChange={(e) => updateField(setRows, rows, r.id, "bottlesPerUnit", Number(e.target.value))}
                  />
                </td>
                {(["unitCost", "shippingCost", "fulfillCost", "packagingCost", "etcCost"] as const).map((k) => (
                  <td key={k} className="pr-2 text-right">
                    <input
                      type="number"
                      className="border rounded px-1 w-20 text-right"
                      value={r[k]}
                      onChange={(e) => updateField(setRows, rows, r.id, k, Number(e.target.value))}
                    />
                  </td>
                ))}
                <td>
                  <button
                    onClick={() => saveRow(filtered[i])}
                    disabled={busy}
                    className="px-2 py-1 rounded bg-gray-900 text-white text-xs disabled:opacity-50"
                  >
                    저장
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={11} className="py-3 text-gray-500">
                  데이터 없음. 매출 동기화 후 자동 생성된 상품에 키워드/원가를 입력하거나, 위에서 일괄 업로드하세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function updateField<K extends keyof CostRow>(
  setRows: React.Dispatch<React.SetStateAction<CostRow[]>>,
  _rows: CostRow[],
  id: string,
  key: K,
  value: CostRow[K],
) {
  setRows((rs) => rs.map((x) => (x.id === id ? { ...x, [key]: value } : x)));
}
