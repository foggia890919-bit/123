"use client";

import { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MigrationStatus } from "./types";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="text-xl font-bold text-gray-900">{value.toLocaleString()}</div>
    </div>
  );
}

export default function FileMigrationTab() {
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  async function loadStatus() {
    const res = await fetch("/api/admin/migrate-files");
    if (res.ok) setStatus(await res.json());
  }

  useEffect(() => { loadStatus(); }, []);

  async function runBatch(all: boolean) {
    setRunning(true);
    try {
      // Keep calling until totalRemaining hits 0 or the user stops
      while (true) {
        const res = await fetch("/api/admin/migrate-files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batch: 50 }),
        });
        const data = await res.json();
        if (!res.ok) {
          setLog((l) => [`오류: ${data.message || data.error || "실패"}`, ...l]);
          break;
        }
        const moved =
          data.userDocuments.migrated + data.userClients.migrated +
          data.filterRequests.migrated + data.prescriptionReports.migrated;
        const failed =
          data.userDocuments.failed + data.userClients.failed +
          data.filterRequests.failed + data.prescriptionReports.failed;
        setLog((l) => [
          `이전 ${moved}건 · 실패 ${failed}건 · 남은 ${data.totalRemaining}건`,
          ...l,
        ].slice(0, 20));
        setStatus({
          storageEnabled: status?.storageEnabled ?? true,
          remaining: {
            userDocuments: data.userDocuments.remaining,
            userClients: data.userClients.remaining,
            filterRequests: data.filterRequests.remaining,
            prescriptionReports: data.prescriptionReports.remaining,
          },
          totalRemaining: data.totalRemaining,
        });
        if (!all) break;
        if (data.totalRemaining === 0) break;
        if (moved === 0 && failed > 0) break; // avoid infinite loop on persistent failures
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div>
          <h2 className="text-base font-bold text-gray-900">파일 스토리지 이전</h2>
          <p className="text-xs text-gray-500 mt-1">
            DB에 base64로 저장된 파일들을 Supabase Storage로 옮겨 DB 크기·백업·조회 속도를 개선합니다.
          </p>
        </div>

        {!status ? (
          <div className="text-sm text-gray-400">상태 확인 중...</div>
        ) : !status.storageEnabled ? (
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
            <p className="font-semibold mb-1">Supabase Storage 연결이 설정되지 않았어요.</p>
            <p className="text-xs">
              Vercel 환경변수에 <code className="bg-white px-1 rounded">SUPABASE_URL</code> 과
              {" "}<code className="bg-white px-1 rounded">SUPABASE_SERVICE_ROLE_KEY</code> 를 추가한 뒤 Redeploy 해주세요.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
              <Stat label="회원 서류" value={status.remaining.userDocuments} />
              <Stat label="거래처 서류" value={status.remaining.userClients} />
              <Stat label="필터요청 서류" value={status.remaining.filterRequests} />
              <Stat label="처방 이미지" value={status.remaining.prescriptionReports} />
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => runBatch(false)} disabled={running || status.totalRemaining === 0}>
                {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                <span className="ml-1">50건 이전</span>
              </Button>
              <Button size="sm" variant="outline" onClick={() => runBatch(true)} disabled={running || status.totalRemaining === 0}>
                전부 이전
              </Button>
              <Button size="sm" variant="ghost" onClick={loadStatus} disabled={running}>
                <RefreshCw className="w-4 h-4" /><span className="ml-1">새로고침</span>
              </Button>
              <span className="ml-auto text-xs text-gray-500">
                남은 {status.totalRemaining.toLocaleString()}건
              </span>
            </div>
          </>
        )}

        {log.length > 0 && (
          <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 font-mono max-h-48 overflow-auto">
            {log.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
