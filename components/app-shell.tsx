"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/login") return <>{children}</>;

  return (
    <div className="flex h-dvh min-h-0 w-full overflow-hidden">
      <Sidebar />
      <main className="app-main min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
        <div className="app-content mx-auto min-h-full w-full max-w-[1920px] px-3 pb-6 pt-16 sm:px-4 md:p-6">{children}</div>
      </main>
    </div>
  );
}
