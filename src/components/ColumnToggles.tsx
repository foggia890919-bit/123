"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ColumnVisibility } from "./MedicationTable";

type Setter = React.Dispatch<React.SetStateAction<ColumnVisibility>>;

interface Props {
  cols: ColumnVisibility;
  setCols: Setter;
  isSalesRep: boolean;
}

const TOGGLES: { key: keyof ColumnVisibility; label: string; salesRepOnly?: boolean }[] = [
  { key: "showIngredientName", label: "성분명" },
  { key: "showBioStatus",      label: "생동/생산" },
  { key: "showOriginalDrug",   label: "오리지날/대조약" },
  { key: "showInsuranceCode",  label: "보험코드" },
  { key: "showPrice",          label: "약가" },
  { key: "showRate",           label: "기본수수료·합계", salesRepOnly: true },
  { key: "showCategoryA",      label: "분류(A)" },
  { key: "showCategoryB",      label: "분류(B)" },
  { key: "showCompanyName",    label: "제약사명" },
  { key: "showNotes",          label: "특이사항" },
  { key: "showStock",          label: "재고" },
];

export default function ColumnToggles({ cols, setCols, isSalesRep }: Props) {
  const [open, setOpen] = useState(false);

  const visibleToggles = TOGGLES.filter((t) => !t.salesRepOnly || isSalesRep);
  const checkedCount = visibleToggles.filter((t) => !!cols[t.key]).length;

  function selectAll() {
    const update: Partial<ColumnVisibility> = {};
    visibleToggles.forEach((t) => { update[t.key] = true; });
    setCols((prev) => ({ ...prev, ...update }));
  }

  function clearAll() {
    const update: Partial<ColumnVisibility> = {};
    visibleToggles.forEach((t) => { update[t.key] = false; });
    setCols((prev) => ({ ...prev, ...update }));
  }

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors select-none"
      >
        <span className="font-medium">컬럼 설정</span>
        <span className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">
          {checkedCount}/{visibleToggles.length}
        </span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="mt-2 p-3 bg-white border border-gray-200 rounded-xl shadow-sm space-y-2">
          <div className="flex gap-2 pb-2 border-b border-gray-100">
            <button type="button" onClick={selectAll}
              className="text-xs px-3 py-1 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 font-medium">
              전체선택
            </button>
            <button type="button" onClick={clearAll}
              className="text-xs px-3 py-1 bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-100">
              전체해제
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-2.5">
            {visibleToggles.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={!!cols[key]}
                  onChange={(e) => setCols((prev) => ({ ...prev, [key]: e.target.checked }))}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer"
                />
                <span className="text-sm text-gray-700 group-hover:text-gray-900 select-none">
                  {label}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
