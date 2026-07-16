"use client";

import React, { useRef, useState, useEffect } from "react";
import { AlertTriangle, CheckCircle, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ManualDrug, OcrResult, AutocompleteOption } from "./types";
import { emptyManualDrug, rowCommission } from "./constants";

interface ManualDrugsPanelProps {
  manualDrugs: ManualDrug[];
  setManualDrugs: React.Dispatch<React.SetStateAction<ManualDrug[]>>;
  editOcr: OcrResult | null;
  manualInitMode: "ocr" | "lastMonth" | "empty";
  setManualInitMode: React.Dispatch<React.SetStateAction<"ocr" | "lastMonth" | "empty">>;
  isClientUnnapproved: boolean;
  submitted: boolean;
  submitError: string;
  submitting: boolean;
  onSubmit: () => void;
  focusedIdx: number | null;
  setFocusedIdx: React.Dispatch<React.SetStateAction<number | null>>;
  imageScrollRef: React.RefObject<HTMLDivElement | null>;
  imageElRef: React.RefObject<HTMLImageElement | null>;
  sessionUserId: string | undefined;
}

export default function ManualDrugsPanel({
  manualDrugs,
  setManualDrugs,
  editOcr,
  manualInitMode,
  setManualInitMode,
  isClientUnnapproved,
  submitted,
  submitError,
  submitting,
  onSubmit,
  focusedIdx,
  setFocusedIdx,
  imageScrollRef,
  imageElRef,
  sessionUserId,
}: ManualDrugsPanelProps) {
  const manualInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [lookupBusy, setLookupBusy] = useState<Record<number, boolean>>({});

  // 제품명 자동완성
  const [autocompleteIdx, setAutocompleteIdx] = useState<number | null>(null);
  const [autocompleteOptions, setAutocompleteOptions] = useState<AutocompleteOption[]>([]);
  const [autocompleteFocus, setAutocompleteFocus] = useState(0);
  const autocompleteQuery = autocompleteIdx != null ? (manualDrugs[autocompleteIdx]?.productName ?? "") : "";
  const autocompleteCache = useRef<Map<string, AutocompleteOption[]>>(new Map());

  useEffect(() => {
    if (autocompleteIdx == null) { setAutocompleteOptions([]); return; }
    const q = autocompleteQuery.trim();
    if (q.length < 2) { setAutocompleteOptions([]); return; }
    const userId = sessionUserId;
    const cacheKey = `${userId ?? ""}:${q}`;
    const cached = autocompleteCache.current.get(cacheKey);
    if (cached) { setAutocompleteOptions(cached); setAutocompleteFocus(0); return; }
    const t = setTimeout(async () => {
      try {
        const url = `/api/medications/search?q=${encodeURIComponent(q)}&limit=8&fast=true${userId ? `&userId=${userId}` : ""}`;
        const res = await fetch(url);
        const data = await res.json();
        const opts: AutocompleteOption[] = Array.isArray(data.medications) ? data.medications.slice(0, 8) : [];
        autocompleteCache.current.set(cacheKey, opts);
        setAutocompleteOptions(opts);
        setAutocompleteFocus(0);
      } catch { setAutocompleteOptions([]); }
    }, 80);
    return () => clearTimeout(t);
  }, [autocompleteIdx, autocompleteQuery, sessionUserId]);

  function applyAutocomplete(rowIdx: number, opt: AutocompleteOption) {
    setManualDrugs((prev) => {
      const next = [...prev];
      next[rowIdx] = {
        ...next[rowIdx],
        insuranceCode: opt.insuranceCode ?? next[rowIdx].insuranceCode,
        companyName: opt.companyName ?? "",
        productName: opt.productName,
        unitPrice: opt.price ?? null,
        commissionRate: opt.commissionRate ?? null,
        additionalRate: opt.additionalRate ?? null,
        matchedMedicationId: opt.id,
      };
      return next;
    });
    setAutocompleteIdx(null);
    setAutocompleteOptions([]);
  }

  function updateManualField(idx: number, field: keyof ManualDrug, value: string) {
    setManualDrugs((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value, matchedMedicationId: field === "insuranceCode" ? null : next[idx].matchedMedicationId };
      if (idx === next.length - 1 && (value || "").trim()) next.push(emptyManualDrug());
      return next;
    });
  }

  function removeManualRow(idx: number) {
    setManualDrugs((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next.length ? next : [emptyManualDrug()];
    });
  }

  function addManualRow() {
    setManualDrugs((prev) => [...prev, emptyManualDrug()]);
  }

  function moveManualRow(fromIdx: number, toIdx: number) {
    setManualDrugs((prev) => {
      if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= prev.length || toIdx >= prev.length) return prev;
      const next = [...prev];
      const [row] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, row);
      return next;
    });
  }

  function handleManualFocus(idx: number) {
    setFocusedIdx(idx);
    const row = manualDrugs[idx];
    const scrollEl = imageScrollRef.current;
    const imgEl = imageElRef.current;
    if (!scrollEl || !imgEl) return;
    const imgRect = imgEl.getBoundingClientRect();
    const scrollRect = scrollEl.getBoundingClientRect();
    const imgTopInScroll = imgRect.top - scrollRect.top + scrollEl.scrollTop;
    const bbox = row?.bbox;
    if (bbox && bbox.some((v) => v > 0)) {
      // 실좌표 bbox 세로 중심으로 스크롤 (정확한 위치)
      const centerYFrac = (bbox[1] + bbox[3]) / 2;
      const targetY = imgTopInScroll + imgEl.clientHeight * centerYFrac;
      scrollEl.scrollTo({ top: Math.max(0, targetY - scrollEl.clientHeight / 2), behavior: "smooth" });
    } else if (row?.bboxYPercent != null) {
      const targetY = imgTopInScroll + (imgEl.clientHeight * row.bboxYPercent) / 100;
      scrollEl.scrollTo({ top: Math.max(0, targetY - scrollEl.clientHeight / 2), behavior: "smooth" });
    } else if (manualDrugs.length) {
      const targetY = imgTopInScroll + (idx / manualDrugs.length) * imgEl.clientHeight;
      scrollEl.scrollTo({ top: Math.max(0, targetY - scrollEl.clientHeight / 2), behavior: "smooth" });
    }
  }

  function handleManualKey(e: React.KeyboardEvent<HTMLInputElement>, idx: number, field: keyof ManualDrug) {
    const acOpen = field === "productName" && autocompleteIdx === idx && autocompleteOptions.length > 0;
    if (acOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAutocompleteFocus((f) => Math.min(f + 1, autocompleteOptions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAutocompleteFocus((f) => Math.max(f - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        applyAutocomplete(idx, autocompleteOptions[autocompleteFocus]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAutocompleteIdx(null);
        return;
      }
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
    e.preventDefault();
    setAutocompleteIdx(null);
    const dir = e.key === "ArrowUp" ? -1 : 1;
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= manualDrugs.length) return;
    const target = manualInputRefs.current[`${nextIdx}:${field}`];
    target?.focus();
    target?.select();
    if (target) {
      target.scrollLeft = 0;
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  async function lookupByInsuranceCode(idx: number) {
    const code = manualDrugs[idx]?.insuranceCode.replace(/\D/g, "") ?? "";
    if (code.length !== 9) return;
    setLookupBusy((b) => ({ ...b, [idx]: true }));
    try {
      const res = await fetch(`/api/medications/search?q=${encodeURIComponent(code)}&limit=1`);
      const data = await res.json();
      const med = data.medications?.[0];
      if (med && med.insuranceCode === code) {
        setManualDrugs((prev) => {
          const next = [...prev];
          next[idx] = {
            ...next[idx],
            insuranceCode: code,
            companyName: med.companyName ?? "",
            productName: med.productName ?? "",
            unitPrice: med.price ?? null,
            commissionRate: med.commissionRate ?? null,
            additionalRate: med.additionalRate ?? null,
            matchedMedicationId: med.id ?? null,
          };
          return next;
        });
      }
    } finally {
      setLookupBusy((b) => ({ ...b, [idx]: false }));
    }
  }

  const filledManualDrugs = manualDrugs.filter((d) => d.insuranceCode || d.productName || d.quantity);
  const totalQuantity = filledManualDrugs.reduce((sum, d) => sum + (parseFloat(d.quantity) || 0), 0);
  const totalAmount = filledManualDrugs.reduce((sum, d) => {
    const qty = parseFloat(d.quantity) || 0;
    const price = d.unitPrice ?? 0;
    return sum + qty * price;
  }, 0);
  const noPriceCount = filledManualDrugs.filter((d) => (parseFloat(d.quantity) || 0) > 0 && !d.unitPrice).length;
  const suspectedSummaryRows = totalQuantity > 0
    ? filledManualDrugs.filter((d) => (parseFloat(d.quantity) || 0) > totalQuantity * 0.3).length
    : 0;
  const dupCodeRows = (() => {
    const counts = new Map<string, number>();
    for (const d of filledManualDrugs) {
      const c = (d.insuranceCode || "").replace(/\D/g, "");
      if (c.length === 9) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    let dups = 0;
    for (const [, n] of counts) if (n > 1) dups += n;
    return dups;
  })();
  const totalFee = filledManualDrugs.reduce((sum, d) => sum + rowCommission(d), 0);

  // 사진 이중 검산 3단계 상태 집계 (OCR 로 채워진 행만 rowStatus 를 가짐)
  const statusCounts = manualDrugs.reduce(
    (acc, d) => {
      if (d.rowStatus === "verified") acc.verified++;
      else if (d.rowStatus === "mismatch") acc.mismatch++;
      else if (d.rowStatus === "unreadable") acc.unreadable++;
      return acc;
    },
    { verified: 0, mismatch: 0, unreadable: 0 },
  );

  // 못 읽은 셀 키 → 한글 라벨
  const unreadableCellKo: Record<string, string> = {
    quantity: "수량", unitPrice: "단가", totalPrice: "금액", productName: "약품명",
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col max-h-[80vh]">
      <div className="border-b border-gray-100 px-3 h-[44px] flex items-center gap-2 overflow-x-auto">
        <span className="text-xs font-semibold text-gray-700">② 최종 수정</span>
        <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{filledManualDrugs.length}건</span>
        {(statusCounts.verified + statusCounts.mismatch + statusCounts.unreadable) > 0 && (
          <span className="flex items-center gap-1" title="사진 이중 검산 결과 — 초록: 검증완료 / 빨강: 검산 불일치 / 주황: 판독 불가. 행을 클릭하면 사진의 해당 위치가 강조됩니다.">
            {statusCounts.verified > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 font-medium">검증 {statusCounts.verified}</span>
            )}
            {statusCounts.mismatch > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-red-300 bg-red-50 text-red-700 font-semibold">불일치 {statusCounts.mismatch}</span>
            )}
            {statusCounts.unreadable > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-700 font-semibold">판독불가 {statusCounts.unreadable}</span>
            )}
          </span>
        )}
        {isClientUnnapproved && (
          <span className="text-xs bg-yellow-100 text-yellow-700 border border-yellow-300 px-1.5 py-0.5 rounded font-semibold">정산서 미반영</span>
        )}
        <select
          value={manualInitMode}
          onChange={(e) => setManualInitMode(e.target.value as "ocr" | "lastMonth" | "empty")}
          className="ml-auto text-[11px] h-7 border border-gray-300 rounded px-1.5 bg-white text-gray-600"
          title="OCR 인식 시 이 패널을 어떤 데이터로 채울지 선택">
          <option value="ocr">OCR 결과 복사</option>
          <option value="lastMonth">저번달 복사</option>
          <option value="empty">비어있음</option>
        </select>
        <button onClick={addManualRow}
          className="text-[11px] px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 flex items-center gap-1">
          <Plus className="w-3 h-3" />행 추가
        </button>
      </div>

      {/* 부분 추출 경고 */}
      {editOcr?.partialExtraction && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-amber-800">
            <span className="font-semibold">부분 추출 감지</span> — 사진의 약품수 (
            <strong>{editOcr.partialExtraction.detected}건</strong>) 와 추출된 행 수 (
            <strong>{editOcr.partialExtraction.extracted}건</strong>) 가 다릅니다. 일부 행이
            누락됐을 수 있어요 — 행 추가로 수동 입력하거나 더 선명한 사진으로 재시도하세요.
          </div>
        </div>
      )}

      {/* 총수량/총금액/총 수수료 + 최종 승인 */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <div>
            <p className="text-[10px] text-gray-400" title="OCR 이 잡은 모든 행의 수량 합. 이미지 헤더의 총수량과 비교해 누락 여부 즉시 확인">
              총수량 <span className="text-gray-300">(OCR 전체)</span>
            </p>
            <p className="text-lg font-bold text-gray-900">{totalQuantity.toLocaleString()}</p>
            {suspectedSummaryRows > 0 && (
              <p className="text-[10px] text-red-600 font-medium" title="한 행의 수량이 전체의 30%+ — 합계행이 약품으로 잘못 OCR 됐을 가능성">
                ⚠ 합계행 의심 {suspectedSummaryRows}건
              </p>
            )}
            {dupCodeRows > 0 && (
              <p className="text-[10px] text-red-600 font-medium" title="같은 9자리 보험코드가 여러 행에 등장 — OCR 이 한 행을 두 번 읽었거나 다른 행 코드를 잘못 읽음">
                ⚠ 보험코드 중복 {dupCodeRows}건
              </p>
            )}
          </div>
          <div>
            <p className="text-[10px] text-gray-400" title="약가 매칭된 행의 (수량 × 마스터 약가) 합">
              총금액 <span className="text-gray-300">(수량×약가)</span>
            </p>
            <p className="text-lg font-bold text-gray-900">{totalAmount.toLocaleString()}원</p>
            {noPriceCount > 0 && (
              <p className="text-[10px] text-amber-600 font-medium" title="보험코드 미매칭 — 약가 못 가져와서 0원으로 합산">
                약가 미적용 {noPriceCount}건
              </p>
            )}
          </div>
          <div>
            <p className="text-[10px] text-gray-400">예상 총 수수료</p>
            <p className="text-lg font-bold text-gray-900">{totalFee.toLocaleString()}원</p>
            {isClientUnnapproved && <p className="text-[10px] text-yellow-600 font-medium">정산서 미반영 (승인전)</p>}
          </div>
        </div>
        {submitted ? (
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle className="w-5 h-5" /><span className="text-sm font-semibold">제출 완료</span>
          </div>
        ) : (
          <div className="flex flex-col items-end gap-1">
            {submitError && <p className="text-xs text-red-500">{submitError}</p>}
            <Button onClick={onSubmit} disabled={submitting} className="bg-gray-900 hover:bg-gray-700 text-white">
              {submitting ? "제출 중..." : "최종 승인"}
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 min-h-[200px]">
        <table className="w-full text-xs table-fixed">
          <thead className="sticky top-0 bg-gray-50 z-10">
            <tr className="border-b border-gray-200">
              <th className="text-center py-1.5 px-1 font-medium text-gray-500 w-[44px] bg-gray-50">#</th>
              <th className="text-left py-1.5 px-1.5 font-medium text-gray-500 w-[24%] bg-gray-50">보험코드</th>
              <th className="text-left py-1.5 px-1.5 font-medium text-gray-500 w-[18%] bg-gray-50">제약사</th>
              <th className="text-left py-1.5 px-1.5 font-medium text-gray-500 bg-gray-50">제품명</th>
              <th className="text-left py-1.5 px-1.5 font-medium text-gray-500 w-[14%] bg-gray-50">수량</th>
              <th className="py-1.5 px-1 w-[34px] bg-gray-50"></th>
            </tr>
          </thead>
          <tbody>
            {manualDrugs.length === 0 ? (
              <tr><td colSpan={5} className="py-10 text-center text-gray-400 text-xs">행 추가를 눌러 직접 입력하거나 처방전을 인식하세요</td></tr>
            ) : manualDrugs.map((d, i) => {
              const aiPair = editOcr?.drugs[i];
              const lowConf = aiPair?.manualCheck;
              // 이중 검산 3단계 상태 — 행에 붙은 스냅샷 우선(재정렬해도 유지), 없으면 OCR 페어.
              const st = d.rowStatus ?? aiPair?.rowStatus ?? null;
              const v = d.verify ?? aiPair?.verify ?? null;
              const unreadableSet = new Set(v?.unreadableCells ?? []);
              const statusBg = st === "mismatch" ? "bg-red-50" : st === "unreadable" ? "bg-amber-50" : "";
              const statusBorder = st === "mismatch" ? "border-l-2 border-l-red-400"
                : st === "unreadable" ? "border-l-2 border-l-amber-400"
                : st === "verified" ? "border-l-2 border-l-emerald-400" : "";
              const rowFallbackBg = !st && lowConf ? "bg-red-50/50" : "";
              const dotColor = st === "mismatch" ? "bg-red-500"
                : st === "unreadable" ? "bg-amber-500"
                : st === "verified" ? "bg-emerald-500" : "";
              const failDetails = [
                v?.checkA?.applicable && v?.checkA?.pass === false ? v?.checkA?.detail : "",
                v?.checkB?.applicable && v?.checkB?.pass === false ? v?.checkB?.detail : "",
              ].filter(Boolean).join(" / ");
              const rowTitle = st === "mismatch"
                ? `검산 불일치 — ${failDetails}`
                : st === "unreadable"
                ? `판독 불가 셀: ${(v?.unreadableCells ?? []).map((c) => unreadableCellKo[c] ?? c).join(", ")} — 추정 없이 비워둠. 사진 확인 후 직접 입력하세요.`
                : st === "verified"
                ? (v && v.masterPriceChecked ? "검증완료 (산술 + 마스터 약가 대조 통과)" : "검증완료 (산술 통과 · 약가대조 미실시)")
                : "";
              return (
                <tr key={i}
                  title={rowTitle || undefined}
                  className={`border-b border-gray-100 h-9 ${statusBorder} ${focusedIdx === i ? "bg-yellow-50" : (statusBg || rowFallbackBg)}`}>
                  <td className="px-1 align-middle text-center">
                    <select value={i}
                      onChange={(e) => moveManualRow(i, parseInt(e.target.value, 10))}
                      title="행 순서 변경 — 다른 위치 선택 시 이 행이 그 위치로 이동"
                      className="w-full h-7 border border-gray-300 rounded px-1 text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 cursor-pointer">
                      {manualDrugs.map((_, j) => (
                        <option key={j} value={j}>{j + 1}{j === i ? "" : ` ↩`}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-1 align-middle">
                    <input value={d.insuranceCode}
                      ref={(el) => { manualInputRefs.current[`${i}:insuranceCode`] = el; }}
                      onFocus={() => handleManualFocus(i)}
                      onKeyDown={(e) => handleManualKey(e, i, "insuranceCode")}
                      onChange={(e) => updateManualField(i, "insuranceCode", e.target.value.replace(/\D/g, "").slice(0, 9))}
                      onBlur={() => lookupByInsuranceCode(i)}
                      placeholder="9자리"
                      className={`w-full h-7 border rounded px-1.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-blue-400 ${d.matchedMedicationId ? "border-green-300 bg-green-50" : "border-gray-300"}`} />
                  </td>
                  <td className="px-1 align-middle">
                    <input value={d.companyName}
                      ref={(el) => { manualInputRefs.current[`${i}:companyName`] = el; }}
                      onFocus={() => handleManualFocus(i)}
                      onKeyDown={(e) => handleManualKey(e, i, "companyName")}
                      onChange={(e) => updateManualField(i, "companyName", e.target.value)}
                      placeholder="제약사"
                      className="w-full h-7 border border-gray-300 rounded px-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </td>
                  <td className="px-1 align-middle">
                    <div className="flex items-center gap-1">
                      {st && <span className={`shrink-0 w-2 h-2 rounded-full ${dotColor}`} title={rowTitle || undefined} />}
                      <div className="relative flex-1">
                      <input value={d.productName}
                        ref={(el) => { manualInputRefs.current[`${i}:productName`] = el; }}
                        onFocus={() => { handleManualFocus(i); setAutocompleteIdx(i); }}
                        onBlur={(e) => {
                          const next = e.relatedTarget as HTMLElement | null;
                          if (next?.closest?.("[data-ac-dropdown]")) return;
                          window.setTimeout(() => { setAutocompleteIdx((cur) => (cur === i ? null : cur)); }, 200);
                        }}
                        onKeyDown={(e) => handleManualKey(e, i, "productName")}
                        onChange={(e) => { updateManualField(i, "productName", e.target.value); setAutocompleteIdx(i); }}
                        placeholder={unreadableSet.has("productName") ? "판독불가 — 직접 입력" : "제품명"}
                        className={`w-full h-7 border rounded px-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400 ${unreadableSet.has("productName") ? "border-amber-400 bg-amber-50 placeholder-amber-500" : "border-gray-300"}`} />
                      {autocompleteIdx === i && autocompleteOptions.length > 0 && (
                        <div data-ac-dropdown className="absolute z-40 left-0 right-0 top-full mt-0.5 bg-white border border-gray-300 rounded shadow-lg max-h-56 overflow-y-auto">
                          {autocompleteOptions.map((opt, j) => (
                            <button key={opt.id} type="button"
                              onMouseDown={(e) => { e.preventDefault(); applyAutocomplete(i, opt); }}
                              className={`block w-full text-left px-2 py-1 text-[11px] border-b border-gray-100 last:border-b-0 ${j === autocompleteFocus ? "bg-blue-100" : "hover:bg-blue-50"}`}>
                              <div className="font-medium text-gray-900 truncate">{opt.productName}</div>
                              <div className="text-gray-500 text-[10px] truncate">
                                {opt.companyName || "-"} · {opt.price ? `${opt.price.toLocaleString()}원` : "단가-"} · {opt.insuranceCode || "코드없음"}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      </div>
                    </div>
                  </td>
                  <td className="px-1 align-middle">
                    <input value={d.quantity}
                      ref={(el) => { manualInputRefs.current[`${i}:quantity`] = el; }}
                      onFocus={() => handleManualFocus(i)}
                      onKeyDown={(e) => handleManualKey(e, i, "quantity")}
                      onChange={(e) => updateManualField(i, "quantity", e.target.value)}
                      placeholder={unreadableSet.has("quantity") ? "판독불가" : "0"}
                      className={`w-full h-7 border rounded px-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400 ${unreadableSet.has("quantity") ? "border-amber-400 bg-amber-50 placeholder-amber-500" : "border-gray-300"}`} />
                  </td>
                  <td className="px-1 align-middle text-center">
                    <button onClick={() => removeManualRow(i)}
                      className="text-gray-400 hover:text-red-600" title="행 삭제">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-[10px] text-gray-400">
          ← 왼쪽 OCR 결과와 행 단위로 매칭됩니다. 보험코드 9자리 입력 후 포커스 이동 시 마스터 DB에서 제품명·제약사·단가 자동 채움.
        </p>
      </div>
    </div>
  );
}
