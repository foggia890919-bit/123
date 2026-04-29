"use client";

import { useEffect, useState } from "react";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

interface RequestInfo {
  id: string;
  clientName: string;
  companyName: string;
  userName: string;
  requestType: string;
  respondedResult: string | null;
}

export default function FilterRespondPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [info, setInfo] = useState<RequestInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/filter-respond/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setInfo(d);
      })
      .catch(() => setError("요청 정보를 불러올 수 없어요."))
      .finally(() => setLoading(false));
  }, [token]);

  async function respond(result: "가능" | "불가") {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/filter-respond/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error || "처리 중 오류가 발생했어요.");
      } else {
        setDone(true);
        setInfo((prev) => prev ? { ...prev, respondedResult: result } : prev);
      }
    } catch {
      setError("네트워크 오류가 발생했어요.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-sm w-full text-center">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <p className="text-gray-700 font-medium">{error}</p>
        </div>
      </div>
    );
  }

  if (!info) return null;

  const alreadyResponded = !!info.respondedResult;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-sm w-full">
        {/* 헤더 */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-50 rounded-2xl mb-4">
            <span className="text-2xl">💊</span>
          </div>
          <h1 className="text-lg font-bold text-gray-900">필터링 {info.requestType} 요청</h1>
          <p className="text-sm text-gray-500 mt-1">메디밴스</p>
        </div>

        {/* 요청 정보 */}
        <div className="bg-gray-50 rounded-xl p-4 space-y-2.5 mb-6">
          <InfoRow label="거래처" value={info.clientName} />
          <InfoRow label="제약사" value={info.companyName} />
          <InfoRow label="영업사원" value={info.userName} />
          <InfoRow label="요청유형" value={info.requestType} />
        </div>

        {/* 이미 응답한 경우 */}
        {alreadyResponded || done ? (
          <div className="text-center">
            {info.respondedResult === "가능" ? (
              <div className="flex flex-col items-center gap-2">
                <CheckCircle className="w-10 h-10 text-green-500" />
                <p className="font-semibold text-green-700">필터링 가능으로 응답했습니다</p>
                <p className="text-sm text-gray-500">영업사원에게 알림이 전송됩니다.</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <XCircle className="w-10 h-10 text-red-400" />
                <p className="font-semibold text-red-700">필터링 불가로 응답했습니다</p>
                <p className="text-sm text-gray-500">영업사원에게 알림이 전송됩니다.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-center text-gray-600 mb-4">
              위 거래처의 필터링 {info.requestType} 요청에 응답해 주세요.
            </p>
            <button
              onClick={() => respond("가능")}
              disabled={submitting}
              className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold py-3.5 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
              가능
            </button>
            <button
              onClick={() => respond("불가")}
              disabled={submitting}
              className="w-full bg-red-50 hover:bg-red-100 active:bg-red-200 text-red-600 font-semibold py-3.5 rounded-xl border border-red-200 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-5 h-5" />}
              불가
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  );
}
