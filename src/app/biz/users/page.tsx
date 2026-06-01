"use client";

import { useState, useEffect, Suspense } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Hospital, Briefcase, Users, PercentCircle, Pill, User } from "lucide-react";
import { BizLayout } from "@/app/biz/page";
import type { Tab } from "./components/types";
import PartnerPromoTab from "./components/PartnerPromoTab";
import RoleUsersTab from "./components/RoleUsersTab";

const TABS: { key: Tab; label: string; icon: React.ElementType; desc: string }[] = [
  { key: "all",            label: "전체",          icon: Users,         desc: "가입한 모든 회원 (4분류 통합)" },
  { key: "hospital",       label: "병의원",        icon: Hospital,      desc: "의사·간호사 등 병의원 종사자" },
  { key: "pharmacy",       label: "약국",          icon: Pill,          desc: "약사" },
  { key: "cso",            label: "CSO",           icon: Briefcase,     desc: "CSO 영업·비즈관리자·관리자" },
  { key: "general",        label: "일반",          icon: User,          desc: "기타 일반 가입자" },
  { key: "partner-promo",  label: "협력법인 프로모션", icon: PercentCircle, desc: "협력법인 지정·등급 설정·시트 매칭" },
];

const VALID_TABS = TABS.map((t) => t.key);

function UsersPageInner() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get("tab");
    return (t && (VALID_TABS as string[]).includes(t)) ? t as Tab : "all";
  });
  const [ambigCount, setAmbigCount] = useState(0);

  useEffect(() => {
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
        <div>
          <h1 className="text-xl font-bold text-gray-900">유저 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">{current.desc}</p>
        </div>

        <div className="flex border-b border-gray-200 overflow-x-auto">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button key={t.key} onClick={() => switchTab(t.key)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
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

        {tab === "all"           && <RoleUsersTab role="ALL"      title="전체 회원" desc="모든 가입자" />}
        {tab === "hospital"      && <RoleUsersTab role="HOSPITAL" title="병의원" desc="의사·간호사·재직자 등 병의원 종사자" />}
        {tab === "pharmacy"      && <RoleUsersTab role="PHARMACY" title="약국" desc="약사" />}
        {tab === "cso"           && <RoleUsersTab role="CSO"      title="CSO" desc="CSO 영업·비즈관리자·관리자 (관리자에서 권한 부여)" />}
        {tab === "general"       && <RoleUsersTab role="GENERAL"  title="일반" desc="기타 일반 가입자" />}
        {tab === "partner-promo" && <PartnerPromoTab />}
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
