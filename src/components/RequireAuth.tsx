"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [showMsg, setShowMsg] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      setShowMsg(true);
      const t = setTimeout(() => router.push("/register"), 2000);
      return () => clearTimeout(t);
    }
  }, [session, status, router]);

  if (status === "loading") return null;

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        {showMsg && (
          <div className="bg-blue-50 border border-blue-200 text-blue-700 px-6 py-4 rounded-lg text-center">
            <p className="font-semibold text-lg">회원가입 후 사용가능합니다.</p>
            <p className="text-sm mt-1 text-blue-500">잠시 후 회원가입 페이지로 이동합니다...</p>
          </div>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
