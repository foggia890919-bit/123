"use client";

import { useState } from "react";
import MobileSidebar from "./MobileSidebar";
import BottomNav from "./BottomNav";

export default function MobileNavWrapper() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return (
    <>
      <MobileSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <BottomNav
        onMenuToggle={() => setSidebarOpen((prev) => !prev)}
        sidebarOpen={sidebarOpen}
      />
    </>
  );
}
