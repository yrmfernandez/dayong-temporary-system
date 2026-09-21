import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";

export const metadata: Metadata = {
  title: "Dayong Temporary System",
  description: "Dayong Providers temporary operations system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-muted/30 text-foreground antialiased">
        <div className="flex min-h-screen">
          <Sidebar />

          <main className="min-w-0 flex-1">
            <div className="min-h-screen p-4 pt-16 md:p-6 md:pt-6">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}