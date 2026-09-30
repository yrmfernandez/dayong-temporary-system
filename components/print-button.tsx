"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Prints the current page; the app's print styles hide the sidebar and top bar. */
export function PrintButton({ label = "Print" }: { label?: string }) {
  return <Button type="button" variant="outline" size="sm" className="print:hidden" onClick={() => window.print()}><Printer className="mr-2 size-4" />{label}</Button>;
}
