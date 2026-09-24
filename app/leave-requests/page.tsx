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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type LeaveRequest = {
  id: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string;
  approvalStatus:
    | "Pending"
    | "Approved"
    | "Rejected"
    | "Cancelled";
  createdAt: string;
};

const leaveTypes = [
  "Vacation Leave",
  "Sick Leave",
  "Emergency Leave",
  "Maternity Leave",
  "Paternity Leave",
  "Bereavement Leave",
  "Other",
];

export default function LeaveRequestsPage() {
  const [requests, setRequests] = useState<
    LeaveRequest[]
  >([]);

  const [leaveType, setLeaveType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const loadRequests = async () => {
    try {
      const response = await fetch(
        "/api/leave-requests",
        {
          cache: "no-store",
        },
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.message ||
            "Unable to load leave requests.",
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

  const submitRequest = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    setMessage("");

    if (
      !leaveType ||
      !startDate ||
      !endDate ||
      !reason.trim()
    ) {
      setMessage(
        "Complete all leave request fields.",
      );
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(
        "/api/leave-requests",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            leaveType,
            startDate,
            endDate,
            reason,
          }),
        },
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.message ||
            "Unable to submit leave request.",
        );
      }

      setLeaveType("");
      setStartDate("");
      setEndDate("");
      setReason("");
      setMessage(result.message);
      await loadRequests();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to submit leave request.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Leave Requests
        </h1>

        <p className="text-sm text-muted-foreground">
          Submit leave requests for Admin or HR approval.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New Leave Request</CardTitle>
        </CardHeader>

        <CardContent>
          <form
            className="space-y-4"
            onSubmit={submitRequest}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Leave Type *</Label>

                <Select
                  value={leaveType}
                  onValueChange={(value) =>
                    setLeaveType(value ?? "")
                  }
                  disabled={submitting}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select leave type" />
                  </SelectTrigger>

                  <SelectContent>
                    {leaveTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="leave-start">
                  Start Date *
                </Label>

                <Input
                  id="leave-start"
                  type="date"
                  value={startDate}
                  onChange={(event) =>
                    setStartDate(event.target.value)
                  }
                  disabled={submitting}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="leave-end">
                  End Date *
                </Label>

                <Input
                  id="leave-end"
                  type="date"
                  value={endDate}
                  onChange={(event) =>
                    setEndDate(event.target.value)
                  }
                  disabled={submitting}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="leave-reason">
                Reason *
              </Label>

              <Textarea
                id="leave-reason"
                value={reason}
                onChange={(event) =>
                  setReason(event.target.value)
                }
                placeholder="Explain your leave request."
                disabled={submitting}
              />
            </div>

            {message && (
              <p className="text-sm text-muted-foreground">
                {message}
              </p>
            )}

            <Button type="submit" disabled={submitting}>
              {submitting
                ? "Submitting..."
                : "Submit Leave Request"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>My Leave Requests</CardTitle>
        </CardHeader>

        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">
              Loading leave requests...
            </p>
          ) : requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No leave requests yet.
            </p>
          ) : (
            <div className="divide-y rounded-lg border">
              {requests.map((request) => (
                <div
                  key={request.id}
                  className="space-y-2 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">
                        {request.leaveType}
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

                  <p className="text-sm text-muted-foreground">
                    {request.reason}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}