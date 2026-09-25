export async function readApiResponse(response: Response) {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    if (response.status === 404) throw new Error("This API route is unavailable. Restart the development server and refresh this page.");
    if (response.redirected) throw new Error("Your session may have expired. Sign in again and refresh this page.");
    throw new Error(`The server returned an unexpected response (${response.status}). Please refresh or check the server logs.`);
  }
  return response.json();
}

export async function parseJsonResponse<T>(response: Response): Promise<T> {
  return readApiResponse(response) as Promise<T>;
}
