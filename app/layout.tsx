import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { themeBootScript } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Dayong Monitoring System",
  description: "Dayong Providers operations monitoring system",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f3f7" },
    { media: "(prefers-color-scheme: dark)", color: "#131118" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The boot script sets the theme class before hydration, so the class can differ from the server render.
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="h-full overflow-hidden text-foreground antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
