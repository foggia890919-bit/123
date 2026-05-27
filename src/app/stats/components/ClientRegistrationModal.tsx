"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { UserClient } from "./types";

interface ClientRegistrationModalProps {
  initialName: string;
  onClose: () => void;
  onRegistered: (client: UserClient) => void;
}

export default function ClientRegistrationModal({ initialName, onClose, onRegistered }: ClientRegistrationModalProps) {
  const { data: session } = useSession();
  const [regName, setRegName] = useState(initialName);
  const [regBizNum, setRegBizNum] = useState("");
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState("");

  async function registerClient() {
    if (!regName.trim() || !regBizNum.trim()) { setRegError("이름과 사업자번호를 입력하세요"); return; }
    if (!session?.user?.id) return;
    setRegLoading(true); setRegError("");
    try {
      const res = await fetch("/api/user-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: session.user.id, clientName: regName.trim(), bizNumber: regBizNum.trim() }),
      });
      const data = await res.json();
      if (data.error) { setRegError(data.error); return; }
      onRegistered(data);
    } catch (e) {
      setRegError(String(e));
    } finally {
      setRegLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-900">신규 거래처 가등록</h2>
          <button onClick={() => { onClose(); }} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">거래처명 (병원명)</label>
            <Input value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="예: 서울내과의원" className="h-9 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">사업자번호</label>
            <Input value={regBizNum} onChange={(e) => setRegBizNum(e.target.value)} placeholder="예: 123-45-67890" className="h-9 text-sm" />
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-yellow-700">
            <span className="font-semibold">가등록</span>으로 저장되며, 관리자 승인 전까지 통계는 정산서에 반영되지 않습니다.
          </div>
          {regError && <p className="text-xs text-red-500">{regError}</p>}
          <div className="flex gap-2 pt-1">
            <Button onClick={registerClient} disabled={regLoading} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm">
              {regLoading ? "등록 중..." : "가등록 완료"}
            </Button>
            <Button variant="outline" onClick={() => { onClose(); }} className="flex-1 text-sm">취소</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
