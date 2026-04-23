"use client";

import type { ColumnVisibility } from "./MedicationTable";

type Setter = React.Dispatch<React.SetStateAction<ColumnVisibility>>;

interface Props {
  cols: ColumnVisibility;
  setCols: Setter;
  isSalesRep: boolean;
}

const TOGGLES: { key: keyof ColumnVisibility; label: string; salesRepOnly?: boolean }[] = [
  { key: "showBioStatus", label: "생동/생산" },
  { key: "showOriginalDrug", label: "오리지날/대조약" },
  { key: "showCategoryA", label: "분류A" },
  { key: "showCategoryB", label: "분류B" },
  { key: "showNotes", label: "특이사항" },
  { key: "showRate", label: "요율표", salesRepOnly: true },
];

export default function ColumnToggles({ cols, setCols, isSalesRep }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
      {TOGGLES.filter((t) => !t.salesRepOnly || isSalesRep).map(({ key, label }) => (
        <label key={key} className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={!!cols[key]}
            onChange={(e) => setCols((prev) => ({ ...prev, [key]: e.target.checked }))}
            className="w-4 h-4 rounded border-gray-300 text-blue-600"
          />
          {label} 표시
        </label>
      ))}
    </div>
  );
}
