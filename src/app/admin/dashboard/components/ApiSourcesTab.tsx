"use client";

import { useState, useEffect } from "react";
import { CheckCircle, AlertCircle, Database, ChevronDown, ChevronUp, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PreviewResult } from "./types";

const DB_FIELD_LABELS: Record<string, string> = {
  productName: "제품명", companyName: "제약사명", ingredientName: "성분명",
  insuranceCode: "보험코드", categoryA: "분류A", categoryB: "주성분코드(분류B)",
  price: "약가", bioStatus: "생동/생산", originalDrug: "오리지날/대조약",
  notes: "특이사항", commissionRate: "수수료율", isSettlement: "정산제약사여부",
  "(매핑키)": "(매핑키 — DB 조회용)", "(미사용)": "(저장 안 함)",
};

interface ApiSource {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiPath: string;
  status: "connected" | "manual" | "pending";
  totalCount?: number;
  mapping: { apiField: string; dbField: string; note?: string }[];
}

const KNOWN_SOURCES: ApiSource[] = [
  {
    id: "mfds",
    name: "식약처 의약품 허가정보",
    provider: "식품의약품안전처 (data.go.kr)",
    baseUrl: "https://apis.data.go.kr",
    apiPath: "/1471000/DrugPrdtPrmsnInfoService07/getDrugPrdtPrmsnInq07",
    status: "connected",
    totalCount: 43252,
    mapping: [
      { apiField: "ITEM_NAME", dbField: "productName" },
      { apiField: "ENTP_NAME", dbField: "companyName" },
      { apiField: "EDI_CODE", dbField: "insuranceCode" },
      { apiField: "ITEM_INGR_NAME", dbField: "ingredientName" },
      { apiField: "PRODUCT_TYPE", dbField: "categoryA" },
      { apiField: "SPCLTY_PBLC", dbField: "(미사용)", note: "전문/일반 구분" },
    ],
  },
  {
    id: "hira_atc",
    name: "HIRA ATC코드 매핑목록 (2025)",
    provider: "건강보험심사평가원 (odcloud.kr)",
    baseUrl: "https://api.odcloud.kr",
    apiPath: "/api/15118958/v1/uddi:6753c7f1-65ed-4bbe-9e98-cd6b7b156a92",
    status: "connected",
    totalCount: 21953,
    mapping: [
      { apiField: "주성분코드", dbField: "categoryB" },
      { apiField: "제품코드", dbField: "(매핑키)", note: "insuranceCode 기준으로 매칭" },
      { apiField: "제품명", dbField: "(미사용)" },
      { apiField: "업체명", dbField: "(미사용)" },
      { apiField: "ATC코드", dbField: "(미사용)" },
      { apiField: "ATC코드 명칭", dbField: "(미사용)" },
    ],
  },
  {
    id: "hira_rate",
    name: "HIRA 약가마스터 의약품주성분",
    provider: "건강보험심사평가원 (odcloud.kr)",
    baseUrl: "https://api.odcloud.kr",
    apiPath: "",
    status: "pending",
    mapping: [],
  },
  {
    id: "excel",
    name: "요율표 엑셀 업로드",
    provider: "수동 업로드",
    baseUrl: "",
    apiPath: "",
    status: "manual",
    mapping: [
      { apiField: "분류(A)", dbField: "categoryA" },
      { apiField: "성분명", dbField: "ingredientName" },
      { apiField: "분류(B)", dbField: "categoryB" },
      { apiField: "코드(수수료율)", dbField: "commissionRate" },
      { apiField: "제약사명", dbField: "companyName" },
      { apiField: "생동/생산", dbField: "bioStatus" },
      { apiField: "품목명", dbField: "productName" },
      { apiField: "약가", dbField: "price" },
      { apiField: "오리지날/대조약", dbField: "originalDrug" },
      { apiField: "보험코드", dbField: "insuranceCode" },
      { apiField: "특이사항", dbField: "notes" },
    ],
  },
];

export default function ApiSourcesTab() {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ mfds: true, hira_atc: true });
  const [testUrl, setTestUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [dbStats, setDbStats] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch("/api/medications/sync").then(r => r.json()).then(d => {
      setDbStats({ public: d.publicCount ?? 0, excel: d.excelCount ?? 0 });
    });
    fetch("/api/medications/sync-ingredient-codes").then(r => r.json()).then(d => {
      setDbStats(prev => ({ ...prev, categoryB: d.filled ?? 0, total: d.total ?? 0 }));
    });
  }, []);

  async function handleTest() {
    if (!testUrl.trim()) return;
    setTesting(true); setPreview(null);
    try {
      const res = await fetch("/api/admin/preview-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: testUrl.trim() }),
      });
      setPreview(await res.json());
    } catch (e) {
      setPreview({ error: String(e) });
    } finally { setTesting(false); }
  }

  const statusBadge = (s: ApiSource["status"]) => {
    if (s === "connected") return <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">● 연동됨</span>;
    if (s === "manual") return <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">↑ 수동업로드</span>;
    return <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">○ 미연동</span>;
  };

  return (
    <div className="space-y-4">
      {/* DB 현황 */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "공공API 약품", value: dbStats.public ?? "-" },
          { label: "엑셀 업로드 약품", value: dbStats.excel ?? "-" },
          { label: "전체 약품", value: dbStats.total ?? "-" },
          { label: "주성분코드 보유", value: dbStats.categoryB != null ? `${dbStats.categoryB}건` : "-" },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{typeof value === "number" ? value.toLocaleString() + "건" : value}</p>
          </div>
        ))}
      </div>

      {/* 소스 카드 목록 */}
      {KNOWN_SOURCES.map((src) => (
        <div key={src.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50"
            onClick={() => setExpanded(p => ({ ...p, [src.id]: !p[src.id] }))}
          >
            <div className="flex items-center gap-3">
              <Database className="w-4 h-4 text-gray-400 shrink-0" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900 text-sm">{src.name}</span>
                  {statusBadge(src.status)}
                  {src.totalCount && <span className="text-xs text-gray-400">{src.totalCount.toLocaleString()}건</span>}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">{src.provider}</p>
              </div>
            </div>
            {expanded[src.id] ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>

          {expanded[src.id] && (
            <div className="border-t border-gray-100 px-5 py-4 space-y-4">
              {/* API URL */}
              {src.baseUrl && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">Base URL</p>
                  <code className="text-xs bg-gray-50 border border-gray-200 rounded px-3 py-1.5 block text-gray-700 break-all">{src.baseUrl}</code>
                  {src.apiPath && (
                    <>
                      <p className="text-xs font-semibold text-gray-500 mb-1 mt-2">API Path</p>
                      <code className="text-xs bg-gray-50 border border-gray-200 rounded px-3 py-1.5 block text-gray-700 break-all">{src.apiPath}</code>
                    </>
                  )}
                </div>
              )}

              {/* 컬럼 매핑 */}
              {src.mapping.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-2">컬럼 매핑 ({src.mapping.length}개 필드)</p>
                  <div className="border border-gray-200 rounded overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 text-gray-500">
                          <th className="px-3 py-2 text-left font-medium">API 필드명</th>
                          <th className="px-3 py-2 text-center font-medium">→</th>
                          <th className="px-3 py-2 text-left font-medium">DB 저장 필드</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-400">비고</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {src.mapping.map((m) => (
                          <tr key={m.apiField} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-mono text-blue-700">{m.apiField}</td>
                            <td className="px-3 py-2 text-center text-gray-400">→</td>
                            <td className="px-3 py-2">
                              <span className={`font-medium ${m.dbField.startsWith("(") ? "text-gray-400 italic" : "text-green-700"}`}>
                                {m.dbField.startsWith("(") ? m.dbField : `${m.dbField} (${DB_FIELD_LABELS[m.dbField] ?? m.dbField})`}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-gray-400">{m.note ?? ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {src.status === "pending" && (
                <p className="text-xs text-yellow-700 bg-yellow-50 rounded p-3">
                  API URL을 아래 테스트 도구에 입력하면 컬럼을 확인할 수 있어요.
                </p>
              )}
            </div>
          )}
        </div>
      ))}

      {/* 새 API 테스트 */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Plus className="w-4 h-4 text-gray-500" />
          <h3 className="font-semibold text-gray-800 text-sm">새 API 미리보기 / 컬럼 확인</h3>
        </div>
        <p className="text-xs text-gray-500">API URL을 입력하면 현재 API 키로 연결해서 컬럼명과 샘플 데이터를 보여줍니다.</p>
        <div className="flex gap-2">
          <input
            value={testUrl}
            onChange={(e) => setTestUrl(e.target.value)}
            placeholder="https://api.odcloud.kr/api/..."
            className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <Button onClick={handleTest} disabled={testing || !testUrl.trim()} className="shrink-0">
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${testing ? "animate-spin" : ""}`} />
            {testing ? "조회 중..." : "컬럼 확인"}
          </Button>
        </div>

        {preview && (
          <div className="space-y-3">
            {preview.error ? (
              <div className="text-xs text-red-700 bg-red-50 rounded p-3">
                <AlertCircle className="w-3.5 h-3.5 inline mr-1" />{preview.error}
                {preview.raw && <div className="mt-1 font-mono text-gray-500 break-all">{preview.raw}</div>}
              </div>
            ) : (
              <>
                <div className="text-xs text-green-700 bg-green-50 rounded p-3">
                  <CheckCircle className="w-3.5 h-3.5 inline mr-1" />
                  연결 성공 · 형식: <strong>{preview.format}</strong> · 전체 데이터: <strong>{Number(preview.totalCount).toLocaleString()}건</strong>
                </div>

                {preview.columns && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-2">컬럼 목록 ({preview.columns.length}개)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {preview.columns.map((col) => (
                        <span key={col} className="text-xs bg-blue-50 border border-blue-200 text-blue-700 rounded px-2 py-0.5 font-mono">{col}</span>
                      ))}
                    </div>
                  </div>
                )}

                {preview.sample && preview.sample.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-2">샘플 데이터 (3건)</p>
                    <div className="overflow-x-auto border border-gray-200 rounded">
                      <table className="text-xs">
                        <thead>
                          <tr className="bg-gray-50">
                            {preview.columns?.map(c => (
                              <th key={c} className="px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap">{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {preview.sample.map((row, i) => (
                            <tr key={i}>
                              {preview.columns?.map(c => (
                                <td key={c} className="px-3 py-1.5 whitespace-nowrap text-gray-700">{String(row[c] ?? "-")}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

