import { NewSalesForm } from "@/components/new-sales-form";

/** A MAS submits New Sales for the Entry Clerk of their branch to review and save (lib/sale-submissions.ts). */
export default function MasSalesPage() {
  return <NewSalesForm mode="mas" />;
}
