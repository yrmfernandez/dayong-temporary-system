import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ClipboardList,
  PhilippinePeso,
  Receipt,
  Users,
} from "lucide-react";

const kpis = [
  {
    title: "Today's Collections",
    value: "₱0.00",
    description: "Gross collections today",
    icon: PhilippinePeso,
  },
  {
    title: "New Sales",
    value: "0",
    description: "New registrations today",
    icon: Users,
  },
  {
    title: "Collections Encoded",
    value: "0",
    description: "Transactions encoded today",
    icon: Receipt,
  },
  {
    title: "Pending Remittances",
    value: "0",
    description: "Transactions awaiting processing",
    icon: ClipboardList,
  },
];

export default function Dashboard() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Dashboard
        </h1>
        <p className="text-sm text-muted-foreground">
          Dayong Monitoring System
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;

          return (
            <Card key={kpi.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium">
                  {kpi.title}
                </CardTitle>

                <Icon className="size-4 text-muted-foreground" />
              </CardHeader>

              <CardContent>
                <div className="text-2xl font-bold">{kpi.value}</div>

                <p className="mt-1 text-xs text-muted-foreground">
                  {kpi.description}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Temporary dashboard sections */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Today's Activity</CardTitle>
          </CardHeader>

          <CardContent>
            <div className="flex min-h-40 items-center justify-center rounded-md border border-dashed">
              <p className="text-sm text-muted-foreground">
                Activity data will appear here.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Collections</CardTitle>
          </CardHeader>

          <CardContent>
            <div className="flex min-h-40 items-center justify-center rounded-md border border-dashed">
              <p className="text-sm text-muted-foreground">
                Collection data will appear here.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}