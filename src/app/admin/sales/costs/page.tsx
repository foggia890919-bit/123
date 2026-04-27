"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface CostRow {
  id: string;
  storeName: string;
  productName: string;
  channelProductNo: string;
  optionName: string;
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
    setMsg(r.ok ? "저장됨" : "저장 실패");
    setBusy(false);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin/sales" className="text-sm text-gray-500 hover:underline">
            ← 매출 홈
          </Link>
          <h1 className="text-2xl font-bold">원가 관리</h1>
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

      <section className="rounded-md border bg-white p-4">
        <h2 className="font-semibold mb-2">엑셀/CSV 업로드</h2>
        <p className="text-xs text-gray-500 mb-2">
          헤더: 스토어코드, 채널상품번호, 상품명, 옵션, 원가, 물류비, 입출고비, 부자재비, 기타비
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
        </div>
        {msg && <div className="text-sm text-gray-700 mt-2">{msg}</div>}
      </section>

      <section className="rounded-md border bg-white p-4 overflow-x-auto">
        <h2 className="font-semibold mb-3">원가 테이블 ({rows.length})</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-gray-500">
            <tr>
              <th>스토어</th>
              <th>상품</th>
              <th>옵션</th>
              <th className="text-right">원가</th>
              <th className="text-right">물류</th>
              <th className="text-right">입출고</th>
              <th className="text-right">부자재</th>
              <th className="text-right">기타</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className="border-t">
                <td className="py-1">{r.storeName}</td>
                <td>{r.productName}</td>
                <td>
                  <input
                    className="border rounded px-1 w-24"
                    value={r.optionName}
                    onChange={(e) =>
                      setRows((rs) => rs.map((x, j) => (j === i ? { ...x, optionName: e.target.value } : x)))
                    }
                  />
                </td>
                {(["unitCost", "shippingCost", "fulfillCost", "packagingCost", "etcCost"] as const).map((k) => (
                  <td key={k} className="text-right">
                    <input
                      type="number"
                      className="border rounded px-1 w-20 text-right"
                      value={r[k]}
                      onChange={(e) =>
                        setRows((rs) =>
                          rs.map((x, j) => (j === i ? { ...x, [k]: Number(e.target.value) } : x)),
                        )
                      }
                    />
                  </td>
                ))}
                <td>
                  <button
                    onClick={() => saveRow(r)}
                    disabled={busy}
                    className="px-2 py-1 rounded bg-gray-900 text-white text-xs disabled:opacity-50"
                  >
                    저장
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-3 text-gray-500">
                  원가 데이터가 없습니다. 위에서 업로드하거나, 매출 동기화 후 자동 생성된 상품에 값을 입력하세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
