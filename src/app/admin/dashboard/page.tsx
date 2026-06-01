"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { Upload, ShieldCheck, Users, Percent, FileSpreadsheet, Filter, Database, Send, Inbox, MessageCircle, Menu, LogOut, Building2, Network, X, Briefcase } from "lucide-react";
import type { Tab, MenuGroup } from "./components/types";
import UploadTab from "./components/UploadTab";
import MembersTab from "./components/MembersTab";
import HospitalsTab from "./components/HospitalsTab";
import BusinessesTab from "./components/BusinessesTab";
import RatesTab from "./components/RatesTab";
import FilterReqsTab from "./components/FilterReqsTab";
import BulkSubmissionTab from "./components/BulkSubmissionTab";
import CompanySubmissionsTab from "./components/CompanySubmissionsTab";
import SubmissionTreeTab from "./components/SubmissionTreeTab";
import UserClientsTab from "./components/UserClientsTab";
import BizManagementTab from "./components/BizManagementTab";
import CorpRelationTab from "./components/CorpRelationTab";
import ApiSourcesTab from "./components/ApiSourcesTab";
import NoticesTab from "./components/NoticesTab";
import LoginLogsTab from "./components/LoginLogsTab";
import FileMigrationTab from "./components/FileMigrationTab";
import BannersTab from "./components/BannersTab";
import BoardsTab from "./components/BoardsTab";
import SyncSheetsButton from "./components/SyncSheetsButton";

const MENU_GROUPS: MenuGroup[] = [
  {
    title: "최상단 관리",
    items: [
      { key: "members", label: "회원관리", icon: Users },
      { key: "hospitals", label: "병의원관리", icon: Building2 },
      { key: "businesses", label: "사업자관리", icon: Briefcase },
    ],
  },
  {
    title: "데이터 관리",
    items: [
      { key: "upload", label: "요율표 업로드", icon: Upload },
      { key: "apiSources", label: "API 연동관리", icon: Database },
    ],
  },
  {
    title: "수수료·거래처 상세",
    items: [
      { key: "rates", label: "추가수수료 관리", icon: Percent },
      { key: "userClients", label: "담당자별 거래처", icon: Building2 },
      { key: "bizManagement", label: "사업자 상세 (legacy)", icon: Building2 },
      { key: "corpRelation", label: "상위/하위법인 (legacy)", icon: Building2 },
    ],
  },
  {
    title: "필터링 요청",
    items: [
      { key: "filterReqs", label: "요청 내역", icon: Filter },
      { key: "bulkSubmit", label: "제약사별 일괄제출", icon: Send },
      { key: "companySubmissions", label: "제출처 관리", icon: Inbox },
      { key: "submissionTree", label: "제출 트리", icon: Network },
    ],
  },
  {
    title: "콘텐츠",
    items: [
      { key: "notices", label: "공지사항 관리", icon: FileSpreadsheet },
      { key: "banners", label: "메인 배너", icon: Upload },
      { key: "boards", label: "게시판 관리", icon: MessageCircle },
    ],
  },
  {
    title: "보안",
    items: [
      { key: "loginLogs", label: "로그인 기록", icon: ShieldCheck },
    ],
  },
  {
    title: "시스템",
    items: [
      { key: "fileMigration", label: "파일 스토리지 이전", icon: Database },
    ],
  },
];

export default function AdminDashboardPage() {
  const [tab, setTab] = useState<Tab>("members");
  const [mobileOpen, setMobileOpen] = useState(false);

  function handleLogout() {
    signOut({ callbackUrl: "/login" });
  }

  return (
    <>
      <button
        type="button"
        aria-label="메뉴 토글"
        onClick={() => setMobileOpen((v) => !v)}
        className="md:hidden fixed top-3 left-3 z-40 p-2 bg-white border border-gray-200 rounded-md shadow-sm"
      >
        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-20"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
    <div className="flex gap-6 max-w-7xl mx-auto">
      <aside
        className={`w-56 shrink-0 space-y-6 bg-white p-4 overflow-y-auto fixed inset-y-0 left-0 z-30 transition-transform ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } md:relative md:inset-auto md:translate-x-0 md:bg-transparent md:p-0 md:overflow-visible md:sticky md:top-4 md:self-start md:z-auto md:transition-none`}
      >
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-gray-800" />
          <div>
            <h1 className="text-base font-bold text-gray-900 leading-tight">관리자</h1>
            <p className="text-[11px] text-gray-400">데이터 · 회원 관리</p>
          </div>
        </div>

        <nav className="space-y-5">
          {MENU_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="text-[10px] font-semibold tracking-wider text-gray-400 uppercase px-2 mb-1.5">{group.title}</div>
              <div className="space-y-0.5">
                {group.items.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => { setTab(key); setMobileOpen(false); }}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm transition-colors text-left ${
                      tab === key
                        ? "bg-blue-50 text-blue-700 font-medium"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${tab === key ? "text-blue-600" : "text-gray-400"}`} />
                    <span className="truncate">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 text-sm text-gray-500 hover:text-red-600 border border-gray-200 hover:border-red-200 rounded-md px-2.5 py-2 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          로그아웃
        </button>

        <SyncSheetsButton />
      </aside>

      <main className="flex-1 min-w-0 space-y-4">
        {tab === "upload" && <UploadTab />}
        {tab === "notices" && <NoticesTab />}
        {tab === "members" && <MembersTab />}
        {tab === "hospitals" && <HospitalsTab />}
        {tab === "businesses" && <BusinessesTab />}
        {tab === "rates" && <RatesTab />}
        {tab === "filterReqs" && <FilterReqsTab />}
        {tab === "bulkSubmit" && <BulkSubmissionTab />}
        {tab === "companySubmissions" && <CompanySubmissionsTab />}
        {tab === "submissionTree" && <SubmissionTreeTab />}
        {tab === "userClients" && <UserClientsTab />}
        {tab === "bizManagement" && <BizManagementTab />}
        {tab === "corpRelation" && <CorpRelationTab />}
        {tab === "apiSources" && <ApiSourcesTab />}
        {tab === "loginLogs" && <LoginLogsTab />}
        {tab === "fileMigration" && <FileMigrationTab />}
        {tab === "banners" && <BannersTab />}
        {tab === "boards" && <BoardsTab />}
      </main>
    </div>
    </>
  );
}
