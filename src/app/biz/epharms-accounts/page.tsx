"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BizLayout } from "@/app/biz/page";
import {
  Plus, Pencil, Trash2, Search, Loader2, X, RefreshCw,
  ToggleLeft, ToggleRight, KeyRound, AlertCircle, CheckCircle2,
  FileSpreadsheet, Download,
} from "lucide-react";

interface SalesRep { id: string; name: string | null; email: string; }
interface EpharmsAccount {
  id: string; bizNumber: string; clientName: string; loginId: string;
  active: boolean; lastSyncedAt: string | null; lastSyncStatus: string | null;
  lastSyncError: string | null; memo: string | null;
  createdAt: string; updatedAt: string;
  assignedSalesRepUserId: string | null;
  assignedSalesRep: SalesRep | null;
}

const EMPTY = { bizNumber: "", clientName: "", loginId: "", loginPw: "", memo: "", assignedSalesRepUserId: "" };

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function StatusBadge({ status, error }: { status: string | null; error: string | null }) {
  if (!status) return <span className="text-xs text-gray-400">미실행</span>;
  if (status === "ok")
    return <span className="inline-flex items-center gap-1 text-xs text-green-700"><CheckCircle2 className="w-3.5 h-3.5" /> 성공</span>;
  return <span className="inline-flex items-center gap-1 text-xs text-red-700" title={error ?? ""}><AlertCircle className="w-3.5 h-3.5" /> 실패</span>;
}

function EpharmsAccountsContent() {
  const [items, setItems] = useState<EpharmsAccount[]>([]);
  const [reps, setReps] = useState<SalesRep[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<"add" | "edit" | null>(null);
  const [edit, setEdit] = useState<EpharmsAccount | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = `/api/epharms-accounts${search ? `?q=${encodeURIComponent(search)}` : ""}`;
      const r = await fetch(url);
      if (r.ok) setItems(await r.json());
    } finally { setLoading(false); }
  }, [search]);

  const loadReps = useCallback(async () => {
    const r = await fetch("/api/users/sales-reps").catch(() => null);
    if (r && r.ok) { const body = await r.json(); setReps(body.reps ?? []); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadReps(); }, [loadReps]);

  function openAdd() { setForm(EMPTY); setEdit(null); setModal("add"); }
  function openEdit(a: EpharmsAccount) {
    setEdit(a);
    setForm({
      bizNumber: a.bizNumber, clientName: a.clientName, loginId: a.loginId,
      loginPw: "", memo: a.memo ?? "",
      assignedSalesRepUserId: a.assignedSalesRepUserId ?? "",
    });
    setModal("edit");
  }

  async function handleSave() {
    setSaving(true);
    try {
      const isEdit = modal === "edit" && edit;
      const r = await fetch("/api/epharms-accounts", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? {
          id: edit!.id, clientName: form.clientName, loginId: form.loginId,
          ...(form.loginPw ? { loginPw: form.loginPw } : {}),
          memo: form.memo,
          assignedSalesRepUserId: form.assignedSalesRepUserId || null,
        } : {
          bizNumber: form.bizNumber.replace(/[^0-9]/g, ""),
          clientName: form.clientName, loginId: form.loginId, loginPw: form.loginPw,
          memo: form.memo,
          assignedSalesRepUserId: form.assignedSalesRepUserId || null,
        }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || "저장 실패"); return; }
      setModal(null); await load();
    } finally { setSaving(false); }
  }

  async function handleToggle(a: EpharmsAccount) {
    await fetch("/api/epharms-accounts", { method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: a.id, active: !a.active }) });
    await load();
  }
  async function handleDelete(a: EpharmsAccount) {
    if (!confirm(`${a.clientName} 계정을 삭제하시겠습니까?\n저장된 매출원장 데이터도 모두 삭제됩니다.`)) return;
    await fetch(`/api/epharms-accounts?id=${a.id}`, { method: "DELETE" });
    await load();
  }
  async function syncAll() {
    if (!confirm("지금 전체 활성 계정의 매출원장을 다시 긁어옵니다. (수십분 소요 가능)\n진행할까요?")) return;
    setSyncingAll(true);
    try {
      const r = await fetch("/api/epharms-accounts/sync", { method: "POST" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) alert(body.error || "워커 호출 실패");
      else alert("백그라운드 sync 시작됨. 잠시 후 새로고침으로 결과 확인하세요.");
    } finally { setSyncingAll(false); }
  }
  async function syncOne(a: EpharmsAccount) {
    setSyncingId(a.id);
    try {
      const r = await fetch(`/api/epharms-accounts/sync?accountId=${a.id}`, { method: "POST" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) alert(bo
