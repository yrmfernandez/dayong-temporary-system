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

type LeaveRequest = {
  id: string;
  employeeId: string;
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
  reviewedAt: string;
};

export default function LeaveApprovalsPage() {
  const [requests, setRequests] = useState<
    LeaveRequest[]
  >([]);

  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState("");
  const [message, setMessage] = useState("");

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
    void loadRequests();
  }, []);

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

          {loading ? (
            <p className="text-sm text-muted-foreground">
              Loading leave requests...
            </p>
          ) : requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No leave requests found.
            </p>
          ) : (
            <div className="divide-y rounded-lg border">
              {requests.map((request) => (
                <div
                  key={request.id}
                  className="space-y-3 p-4"
                >
                  <div className="flex flex-col justify-between gap-3 sm:flex-row">
                    <div>
                      <p className="font-medium">
                        {request.leaveType}
                      </p>

                      <p className="text-sm text-muted-foreground">
                        Employee: {request.employeeId}
                      </p>

                      <p className="text-sm text-muted-foreground">
                        {request.startDate} to {request.endDate}
                      </p>
                    </div>

                    <Badge
                      variant={
                        request.approvalStatus ===
                        "Approved"
                          ? "default"
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
                      Reviewed by {request.reviewedBy}
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