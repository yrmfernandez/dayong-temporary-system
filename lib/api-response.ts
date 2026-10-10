import { explainServerFailure } from "@/lib/friendly-api-errors";

export async function readApiResponse(response: Response) {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    if (response.redirected) throw new Error("Your session may have expired. Sign in again and refresh this page.");
    throw new Error(explainServerFailure(response.status, await response.text().catch(() => "")));
  }
  return response.json();
}

export async function parseJsonResponse<T>(response: Response): Promise<T> {
  return readApiResponse(response) as Promise<T>;
}
