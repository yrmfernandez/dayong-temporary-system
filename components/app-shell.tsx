"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/login") return <>{children}</>;

  return (
    <div className="flex h-screen">
      <aside className="hidden h-screen shrink-0 overflow-y-auto md:block">
        <Sidebar />
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="min-h-full p-4 pt-16 md:p-6 md:pt-6">{children}</div>
      </main>
    </div>
  );
}
