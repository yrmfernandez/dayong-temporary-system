"use client";

import {
  useEffect,
  useState,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { formatDate as showDate } from "@/lib/date-format";

type LeaveRequest = {
  id: string;
  employeeId: string;
  /** The employee's name from Employees; blank when the ID is not registered. */
  employeeName?: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string;
  approvalStatus:
    | "Pending"
    | "Approved"
    | "Rejected"
    | "Cancelled";
  reviewedBy: string;
  reviewedByName?: string;
  reviewedAt: string;
};

// Tabs in review order (owner, October 13, 2026): what still needs a decision first, then the decided ones.
const TABS = ["Pending", "Approved", "Rejected", "Cancelled"] as const;
type Tab = typeof TABS[number];

/** Pending: the soonest leave first. Decided: the latest reviewed first. */
const ordered = (list: LeaveRequest[], tab: Tab) => [...list].sort((a, b) => tab === "Pending"
  ? a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate)
  : (b.reviewedAt || b.startDate).localeCompare(a.reviewedAt || a.startDate));

export default function LeaveApprovalsPage() {
  const [requests, setRequests] = useState<
    LeaveRequest[]
  >([]);

  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState("");
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<Tab>("Pending");
  const counts = Object.fromEntries(TABS.map((status) => [status, requests.filter((request) => request.approvalStatus === status).length])) as Record<Tab, number>;
  // Cancelled shows only when there are any (or while it is open).
  const tabs = TABS.filter((status) => status !== "Cancelled" || counts.Cancelled > 0 || tab === "Cancelled");
  const shown = ordered(requests.filter((request) => request.approvalStatus === tab), tab);

  const loadRequests = async () => {
    try {
      const response = await fetch(
        "/api/leave-approvals",
        {
          cache: "no-store",
        },
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.message ||
            "You are not allowed to review leave requests.",
        );
      }

      setRequests(result.requests ?? []);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load leave requests.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load; loading state is already set
    void loadRequests();
  }, []);
  // Live updates: reload when another user saves (lib/use-live-refresh.ts).
  useLiveRefresh(["leave_requests"], loadRequests);

  const reviewRequest = async (
    leaveRequestId: string,
    approvalStatus: "Approved" | "Rejected",
  ) => {
    setMessage("");
    setUpdatingId(leaveRequestId);

    try {
      const response = await fetch(
        "/api/leave-approvals",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            leaveRequestId,
            approvalStatus,
          }),
        },
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.message ||
            "Unable to review leave request.",
        );
      }

      setMessage(result.message);
      await loadRequests();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to review leave request.",
      );
    } finally {
      setUpdatingId("");
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Leave Approvals
        </h1>

        <p className="text-sm text-muted-foreground">
          Review employee leave requests.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Leave Requests</CardTitle>
        </CardHeader>

        <CardContent>
          {message && (
            <p className="mb-4 text-sm text-muted-foreground">
              {message}
            </p>
          )}

          <div role="tablist" aria-label="Leave request status" className="mb-4 flex flex-wrap gap-2">
            {tabs.map((status) => (
              <Button key={status} type="button" role="tab" size="sm" aria-selected={tab === status} variant={tab === status ? "default" : "outline"} onClick={() => setTab(status)}>
                {status}
                <span className={`ml-1.5 rounded-full px-1.5 text-xs ${tab === status ? "bg-white/20" : "bg-muted"}`}>{counts[status]}</span>
              </Button>
            ))}
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">
              Loading leave requests...
            </p>
          ) : shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {requests.length === 0 ? "No leave requests found." : `No ${tab.toLowerCase()} leave requests.`}
            </p>
          ) : (
            <div className="divide-y rounded-lg border">
              {shown.map((request) => (
                <div
                  key={request.id}
                  className="space-y-3 p-4"
                >
                  <div className="flex flex-col justify-between gap-3 sm:flex-row">
                    <div>
                      <p className="font-semibold">
                        {request.employeeName || request.employeeId}
                        {request.employeeName && <span className="ml-2 text-xs font-normal text-muted-foreground">{request.employeeId}</span>}
                      </p>

                      <p className="text-sm font-medium">
                        {request.leaveType}
                      </p>

                      <p className="text-sm text-muted-foreground">
                        {showDate(request.startDate)} to {showDate(request.endDate)}
                      </p>
                    </div>

                    <Badge
                      variant={
                        request.approvalStatus === "Approved"
                          ? "default"
                          : request.approvalStatus === "Rejected"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {request.approvalStatus}
                    </Badge>
                  </div>

                  <p className="text-sm">
                    {request.reason}
                  </p>

                  {request.approvalStatus ===
                    "Pending" && (
                    <div className="flex gap-3">
                      <Button
                        type="button"
                        disabled={
                          updatingId === request.id
                        }
                        onClick={() =>
                          void reviewRequest(
                            request.id,
                            "Approved",
                          )
                        }
                      >
                        {updatingId === request.id
                          ? "Updating..."
                          : "Approve"}
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        disabled={
                          updatingId === request.id
                        }
                        onClick={() =>
                          void reviewRequest(
                            request.id,
                            "Rejected",
                          )
                        }
                      >
                        Reject
                      </Button>
                    </div>
                  )}

                  {request.reviewedBy && (
                    <p className="text-xs text-muted-foreground">
                      Reviewed by {request.reviewedByName ? `${request.reviewedByName} (${request.reviewedBy})` : request.reviewedBy}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}