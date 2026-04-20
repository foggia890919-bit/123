"use client";

import { useSession } from "next-auth/react";
import { Lock } from "lucide-react";
import { hasRole, ROLE_LABELS, type UserRole } from "@/lib/roles";

interface Props {
  minRole: UserRole;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export default function RequireRole({ minRole, children, fallback }: Props) {
  const { data: session, status } = useSession();
  if (status === "loading") return null;

  const role = session?.user?.role as UserRole | undefined;
  if (!role || !hasRole(role, minRole)) {
    if (fallback) return <>{fallback}</>;
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
          <Lock className="w-7 h-7 text-gray-400" />
        </div>
        <div className="text-center">
          <p className="text-base font-semibold text-gray-700">접근 권한이 없습니다</p>
          <p className="text-sm text-gray-400 mt-1">
            이 기능은 <span className="font-medium text-gray-600">{ROLE_LABELS[minRole]}</span> 이상 회원만 이용할 수 있습니다.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
