"use client";

import { useState, useEffect } from "react";
import { X, Plus, FileText, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MedicationItem } from "@/types";

interface Proposal { id: string; title: string; _count: { items: number }; }

interface Props {
  medication: MedicationItem;
  userId: string;
  onClose: () => void;
}

export default function AddToProposalDialog({ medication, userId, onClose }: Props) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"select" | "new" | "done">("select");
  const [newTitle, setNewTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [addedProposalId, setAddedProposalId] = useState("");

  useEffect(() => {
    fetch(`/api/proposals?userId=${userId}`)
      .then((r) => r.json())
      .then((data) => { setProposals(Array.isArray(data) ? data : []); setLoading(false); });
  }, [userId]);

  async function addToProposal(proposalId: string) {
    setSaving(true);
    const res = await fetch(`/api/proposals/${proposalId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ medicationId: medication.id }),
    });
    if (res.ok || res.status === 409) {
      setAddedProposalId(proposalId);
      setMode("done");
    }
    setSaving(false);
  }

  async function createAndAdd() {
    if (!newTitle.trim()) return;
    setSaving(true);
    const res = await fetch("/api/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle.trim(), userId }),
    });
    if (res.ok) {
      const proposal = await res.json();
      await addToProposal(proposal.id);
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-gray-900 text-sm">제안서에 추가</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-5 py-3 bg-blue-50 border-b">
          <p className="text-xs text-blue-700 font-medium truncate">{medication.productName}</p>
          <p className="text-xs text-blue-500">{medication.companyName}</p>
        </div>

        {mode === "select" && (
          <div className="p-5 space-y-3">
            <button onClick={() => setMode("new")}
              className="w-full flex items-center gap-3 p-3 border-2 border-dashed border-blue-300 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors">
              <Plus className="w-4 h-4" />
              <span className="text-sm font-medium">새 제안서 만들기</span>
            </button>
            {loading ? (
              <p className="text-xs text-gray-400 text-center py-3">불러오는 중...</p>
            ) : proposals.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-3">기존 제안서가 없어요</p>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto">
                <p className="text-xs text-gray-500 font-medium">기존 제안서에 추가</p>
                {proposals.map((p) => (
                  <button key={p.id} onClick={() => addToProposal(p.id)} disabled={saving}
                    className="w-full flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-left">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-800">{p.title}</span>
                    </div>
                    <span className="text-xs text-gray-400">{p._count.items}개</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {mode === "new" && (
          <div className="p-5 space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-700">제안서 이름</label>
              <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
                placeholder="예: 서울대병원 2026-04-20" autoFocus
                onKeyDown={(e) => e.key === "Enter" && createAndAdd()} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setMode("select")} className="flex-1">뒤로</Button>
              <Button onClick={createAndAdd} disabled={!newTitle.trim() || saving} className="flex-1">
                {saving ? "생성 중..." : "만들고 추가"}
              </Button>
            </div>
          </div>
        )}

        {mode === "done" && (
          <div className="p-5 space-y-4 text-center">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <Check className="w-6 h-6 text-green-600" />
            </div>
            <p className="text-sm font-medium text-gray-800">제안서에 추가됐어요!</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose} className="flex-1">창 닫기</Button>
              <Button onClick={() => window.open(`/proposals?id=${addedProposalId}`, "_self")} className="flex-1">
                제안서 확인하기
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
