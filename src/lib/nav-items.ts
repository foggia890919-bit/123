import {
  Search, Filter, ClipboardList, FileText, Upload,
  BarChart3, Sparkles, ShieldCheck, Truck, ShoppingCart,
  Building2,
} from "lucide-react";
import type { UserRole } from "./roles";

export interface NavLeaf {
  kind: "link";
  href: string;
  label: string;
  icon: React.ElementType;
  minRole: UserRole;
}
export interface NavGroup {
  kind: "group";
  label: string;
  icon: React.ElementType;
  minRole: UserRole;
  matchPrefixes: string[];
  children: { href: string; label: string; icon: React.ElementType }[];
}
export type NavItem = NavLeaf | NavGroup;

export const navItems: NavItem[] = [
  { kind: "link",  href: "/search",            label: "통합검색",        icon: Search,        minRole: "BASIC"     },
  { kind: "link",  href: "/filter",            label: "제약사 필터링",   icon: Filter,        minRole: "BIZ"       },
  { kind: "link",  href: "/submission-routes", label: "통계제출처",      icon: ClipboardList, minRole: "BUSINESS"  },
  {
    kind: "group",
    label: "제안서",
    icon: FileText,
    minRole: "BUSINESS",
    matchPrefixes: ["/proposals", "/bulk-register"],
    children: [
      { href: "/proposals",     label: "제안서",       icon: FileText },
      { href: "/bulk-register", label: "제안서(대량)", icon: Upload   },
    ],
  },
  {
    kind: "group",
    label: "통계",
    icon: BarChart3,
    minRole: "BIZ",
    matchPrefixes: ["/stats", "/biz/stats-review"],
    children: [
      { href: "/stats/photo",       label: "AI 처방통계 등록",   icon: Sparkles    },
      { href: "/biz/stats-review",  label: "AI 처방통계 검수",   icon: ShieldCheck },
      { href: "/stats",             label: "통계자동입력 (구)",   icon: BarChart3   },
      { href: "/stats/bulk-check",  label: "통계엑셀대량확인",   icon: ClipboardList },
    ],
  },
  {
    kind: "group",
    label: "원내거래",
    icon: Truck,
    minRole: "BASIC",
    matchPrefixes: ["/inhouse", "/mypage/ledger"],
    children: [
      { href: "/inhouse/order",  label: "원내주문",        icon: ShoppingCart },
      { href: "/mypage/ledger",  label: "거래처 매출원장", icon: Building2    },
    ],
  },
];
