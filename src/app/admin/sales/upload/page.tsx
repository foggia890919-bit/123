"use client";

import { useState } from "react";
import Link from "next/link";

export default function UploadSalesPage() {
  const [file, setFile] = useState<File | null>(null);
  const [storeCode, setStoreCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit() {
    if (!file || !storeCode) {
      setMsg("스토어 코드와 파일을 선택하세요.");
      return;
    }
    setBusy(true);
    setMsg("업로드 중…");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("storeCode", storeCode);
    const r = await fetch("/api/sales/orders/upload", { method: "POST", body: fd });
    const data = await r.json();
    setMsg(
      r.ok
        ? `업로드 완료 — 주문 ${data.orders}건, 품목 ${data.items}건. 시트 동기화: ${data.sheet?.skipped ? "스킵 (자격증명 미설정)" : data.sheet?.ok ? "OK" : `실패 (${data.sheet?.error})`}`
        : `실패: ${data.error}`,
    );
    setBusy(false);
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/sales" className="text-sm text-gray-500 hover:underline">
          ← 매출 홈
        </Link>
        <h1 className="text-2xl font-bold">매출장부 업로드</h1>
      </div>

      <div className="rounded-md border bg-blue-50 p-3 text-sm text-blue-900">
        스마트스토어센터에서 내려받은 <b>주문/매출 엑셀</b> 을 그대로 업로드하세요.
        시스템이 파싱해서 DB 에 기록하고, 구글시트가 연결되어 있으면 시트에도 자동 추가됩니다.
        <br />네이버 API 가 정상 동작 중이면 이 화면은 보조용 (수동 보정/누락 보충) 입니다.
      </div>

      <div className="rounded-md border bg-white p-4 space-y-3">
        <label className="block text-sm">
          <span className="text-gray-700">스토어 코드</span>
          <input
            value={storeCode}
            onChange={(e) => setStoreCode(e.target.value)}
            placeholder="A / B / C"
            className="mt-1 w-full border rounded px-2 py-1"
          />
        </label>
        <label className="block text-sm">
          <span className="text-gray-700">파일 (.xlsx / .csv)</span>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 block"
          />
        </label>
        <button
          onClick={submit}
          disabled={busy}
          className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm disabled:opacity-50"
        >
          업로드
        </button>
        {msg && <div className="text-sm text-gray-700">{msg}</div>}
      </div>

      <div className="rounded-md border bg-white p-4 text-xs text-gray-600">
        <b>인식하는 헤더 (대소문자/공백 무시)</b>
        <ul className="list-disc ml-5 mt-1">
          <li>상품주문번호 / 주문번호</li>
          <li>채널상품번호 (없으면 상품명 매칭)</li>
          <li>상품명, 옵션</li>
          <li>수량, 상품가격, 결제금액</li>
          <li>네이버페이 주문관리수수료, 매출연동수수료</li>
          <li>결제일</li>
        </ul>
      </div>
    </div>
  );
}
