"use client";

import { useState, useEffect, Suspense } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Hospital, Building2, UserCheck, Users, PercentCircle } from "lucide-react";
import { BizLayout } from "@/app/biz/page";
import type { Tab } from "./components/types";
import ClientsTab from "./components/ClientsTab";
import DealersTab from "./components/DealersTab";
import PartnerPromoTab from "./components/PartnerPromoTab";
import SalesRepsTab from "./components/SalesRepsTab";
import InhouseClientsTab from "./components/InhouseClientsTab";
import AllTab from "./components/AllTab";

const TABS: { key: Tab; label: string; icon: React.ElementType; desc: string }[] = [
  { key: "all",             label: "전체",           icon: Users,      desc: "등록된 모든 거래처" },
  { key: "clients",         label: "병의원(원외)",   icon: Hospital,   desc: "병의원 등록·승인·H-코드 생성" },
  { key: "inhouse-clients", label: "병의원(원내)",   icon: Hospital,   desc: "원내 병·의원 이팜스 계정 관리" },
  { key: "upper-corp",      label: "상위법인",       icon: Building2,  desc: "상위법인 등록·C-코드 생성" },
  { key: "lower-corp",      label: "하위법인",       icon: Building2,  desc: "하위법인 등록·C-코드 생성" },
  { key: "sales-reps",      label: "영업사원",       icon: UserCheck,  desc: "영업사원 승인·S-코드 생성" },
  { key: "partner-promo",   label: "협력법인 프로모션", icon: PercentCircle, desc: "협력법인 지정·등급 설정·시트 매칭" },
];

function UsersPageInner() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get("tab");
    return (t === "sales-reps" || t === "inhouse-clients" || t === "upper-corp" || t === "lower-corp" || t === "partner-promo") ? t as Tab : "all";
  });
  const [ambigCount, setAmbigCount] = useState(0);

  useEffect(() => {
    // 협력법인 프로모션 — 선택대기 건수 폴링 (페이지 진입 시 1회)
    fetch("/api/admin/company-mapping").then((r) => r.ok ? r.json() : null).then((d) => {
      if (!d?.items) return;
      const cnt = d.items.filter((it: { matched: boolean; candidates: string[] }) =>
        !it.matched && it.candidates.length > 0).length;
      setAmbigCount(cnt);
    }).catch(() => {});
  }, [tab]);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) { router.push("/login"); return; }
    const role = session.user.role;
    if (role !== "BIZ" && role !== "ADMIN") router.push("/");
  }, [session, status, router]);

  function switchTab(t: Tab) {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url.toString());
  }

  const current = TABS.find((t) => t.key === tab)!;

  return (
    <BizLayout>
      <div className="space-y-5">
        {/* 헤더 */}
        <div>
          <h1 className="text-xl font-bold text-gray-900">유저 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">{current.desc}</p>
        </div>

        {/* 탭 바 */}
        <div className="flex border-b border-gray-200">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button key={t.key} onClick={() => switchTab(t.key)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  active
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}>
                <Icon className="w-4 h-4" />
                {t.label}
                {t.key === "partner-promo" && ambigCount > 0 && (
                  <span
                    className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] text-[10px] font-bold rounded-full bg-orange-500 text-white px-1.5"
                    title={`제약사 매칭 선택대기 ${ambigCount}건`}
                  >
                    {ambigCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 탭 콘텐츠 */}
        {tab === "all"             && <AllTab />}
        {tab === "clients"         && <ClientsTab />}
        {tab === "inhouse-clients" && <InhouseClientsTab />}
        {tab === "upper-corp"      && <DealersTab fixedType="UPPER_CORP" />}
        {tab === "lower-corp"      && <DealersTab fixedType="LOWER_CORP" />}
        {tab === "sales-reps"      && <SalesRepsTab />}
        {tab === "partner-promo"   && <PartnerPromoTab />}
      </div>
    </BizLayout>
  );
}

export default function UsersPage() {
  return (
    <Suspense>
      <UsersPageInner />
    </Suspense>
  );
}
