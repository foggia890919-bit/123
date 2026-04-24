"use client";

import { SessionProvider, useSession, signOut } from "next-auth/react";
import { useEffect } from "react";

function AutoLoginGuard({ children }: { children: React.ReactNode }) {
  const { status } = useSession();

  useEffect(() => {
    if (status !== "authenticated") return;
    const noAuto = localStorage.getItem("kmd_no_auto") === "1";
    const alive = sessionStorage.getItem("kmd_alive");
    if (noAuto && !alive) {
      signOut({ redirect: false });
      return;
    }
    sessionStorage.setItem("kmd_alive", "1");
  }, [status]);

  return <>{children}</>;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchInterval={60} refetchOnWindowFocus={true}>
      <AutoLoginGuard>{children}</AutoLoginGuard>
    </SessionProvider>
  );
}
