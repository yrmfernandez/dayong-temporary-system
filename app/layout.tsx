import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";

export const metadata: Metadata = {
  title: "Dayong Monitoring System",
  description: "Dayong Providers operations monitoring system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full overflow-hidden bg-muted/30 text-foreground antialiased">
        <div className="flex h-screen">
          {/* Sidebar has its own fixed scroll area */}
          <aside className="hidden h-screen shrink-0 overflow-y-auto md:block">
            <Sidebar />
          </aside>

          {/* Main content has its own scroll area */}
          <main className="min-w-0 flex-1 overflow-y-auto">
            <div className="min-h-full p-4 pt-16 md:p-6 md:pt-6">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
