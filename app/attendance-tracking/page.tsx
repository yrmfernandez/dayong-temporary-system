"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, Clock3, Timer, UserCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";

type Employee = { id: string; name: string; roles: string[]; status: string; branches: string[] };
type Record = { id: string; employeeId: string; attendanceDate: string; branch: string; scheduledTimeIn: string; scheduledTimeOut: string; timeIn: string; timeOut: string; workedHours: number; overtimeHours: number; status: string; lateMinutes: number; undertimeMinutes: number; leaveType: string; leaveApprovalStatus: string; notes: string };
type Result = { success: boolean; message?: string; employees?: Employee[]; records?: Record[] };

const ManilaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const monthStart = () => `${ManilaToday().slice(0, 7)}-01`;
const hours = (value: number) => `${value.toFixed(2)} hrs`;

export default function AttendanceTrackingPage() {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(ManilaToday);
  const [employeeId, setEmployeeId] = useState("");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [records, setRecords] = useState<Record[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/attendance-tracking?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&employeeId=${encodeURIComponent(employeeId)}`, { cache: "no-store" });
      const result = await response.json() as Result;
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load attendance tracking.");
      setEmployees(result.employees ?? []); setRecords(result.records ?? []);
    } catch (failure) { setRecords([]); setError(failure instanceof Error ? failure.message : "Unable to load attendance tracking."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);
  const selectedEmployee = employees.find((employee) => employee.id === employeeId);
  const summary = useMemo(() => ({
    present: records.filter((record) => record.status === "Present").length,
    absent: records.filter((record) => record.status === "Absent" || record.status === "AWOL").length,
    leave: records.filter((record) => record.status === "Leave").length,
    worked: records.reduce((sum, record) => sum + record.workedHours, 0),
    overtime: records.reduce((sum, record) => sum + record.overtimeHours, 0),
    late: records.reduce((sum, record) => sum + record.lateMinutes, 0),
    undertime: records.reduce((sum, record) => sum + record.undertimeMinutes, 0),
  }), [records]);

  return <section className="mx-auto max-w-7xl space-y-6">
    <header className="rounded-2xl page-hero p-5">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-violet-95 p-3 text-violet-40"><BarChart3 className="size-6" /></div><div><h1 className="text-2xl font-bold">Employee Attendance Tracking</h1><p className="text-sm text-violet-30/80">Review attendance history, work hours, overtime, lateness, undertime, leave, and absences.</p></div></div>
    </header>

    <Card><CardContent className="grid gap-4 p-4 md:grid-cols-4">
      <div className="space-y-2 md:col-span-2"><Label>Employee</Label><SearchSelect aria-label="Employee" clearable value={employeeId} placeholder="All employees - search ID or name" options={employees.map((employee) => ({ value: employee.id, label: employee.name, description: employee.id }))} onValueChange={setEmployeeId}/></div>
      <div className="space-y-2"><Label>From</Label><Input type="date" value={from} onChange={(event) => setFrom(event.target.value)}/></div>
      <div className="space-y-2"><Label>To</Label><Input type="date" min={from} value={to} onChange={(event) => setTo(event.target.value)}/></div>
      <div className="md:col-span-4 flex flex-wrap items-center gap-3"><Button type="button" disabled={loading || !from || !to || from > to} onClick={() => void load()}>{loading ? "Loading..." : "Apply filters"}</Button><Button type="button" variant="ghost" onClick={() => setEmployeeId("")}>All employees</Button>{selectedEmployee && <p className="text-sm text-muted-foreground">{selectedEmployee.roles.join(", ") || "Employee"} · {selectedEmployee.branches.join(", ") || "No branch assignment"}</p>}</div>
    </CardContent></Card>

    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Metric icon={UserCheck} label="Present days" value={String(summary.present)} />
      <Metric icon={Clock3} label="Worked hours" value={hours(summary.worked)} />
      <Metric icon={Timer} label="Overtime" value={hours(summary.overtime)} />
      <Metric icon={BarChart3} label="Attendance exceptions" value={String(summary.absent + summary.leave)} detail={`${summary.absent} absent/AWOL · ${summary.leave} leave`} />
    </div>
    <div className="grid gap-3 sm:grid-cols-2"><Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Total late time</p><p className="mt-1 text-xl font-semibold">{summary.late} minutes</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Total undertime</p><p className="mt-1 text-xl font-semibold">{summary.undertime} minutes</p></CardContent></Card></div>

    <Card><CardHeader><CardTitle>Attendance records</CardTitle></CardHeader><CardContent><div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[980px] text-sm"><thead className="bg-muted/50 text-left"><tr>{["Date","Employee","Branch","Status","Time in","Time out","Worked","Overtime","Late","Undertime","Remarks"].map((heading) => <th key={heading} className="p-3">{heading}</th>)}</tr></thead><tbody>{records.map((record) => { const employee = employees.find((item) => item.id === record.employeeId); return <tr key={record.id} className="border-t"><td className="p-3">{record.attendanceDate}</td><td className="p-3"><strong>{employee?.name || record.employeeId}</strong><div className="text-xs text-muted-foreground">{record.employeeId}</div></td><td className="p-3">{record.branch || "—"}</td><td className="p-3"><Badge variant={record.status === "Present" ? "default" : "secondary"}>{record.status}</Badge></td><td className="p-3">{record.timeIn || "—"}</td><td className="p-3">{record.timeOut || "—"}</td><td className="p-3">{hours(record.workedHours)}</td><td className="p-3">{hours(record.overtimeHours)}</td><td className="p-3">{record.lateMinutes} min</td><td className="p-3">{record.undertimeMinutes} min</td><td className="max-w-64 p-3">{record.notes || (record.leaveType ? `${record.leaveType} · ${record.leaveApprovalStatus}` : "—")}</td></tr>; })}{!loading && !records.length && <tr><td colSpan={11} className="p-8 text-center text-muted-foreground">No recorded attendance matches these filters.</td></tr>}</tbody></table></div></CardContent></Card>
  </section>;
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof UserCheck; label: string; value: string; detail?: string }) {
  return <Card><CardContent className="flex items-start gap-3 p-4"><div className="rounded-lg bg-violet-95 p-2 text-violet-50"><Icon className="size-5"/></div><div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p>{detail && <p className="text-xs text-muted-foreground">{detail}</p>}</div></CardContent></Card>;
}
