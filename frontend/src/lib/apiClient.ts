import { supabase } from "./supabaseClient";

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  isFormData?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

async function getToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new ApiError("Your session could not be checked. Please sign in again.", 401);
  return data.session?.access_token ?? null;
}

async function readResponse(res: Response): Promise<Record<string, unknown>> {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return {};
  try {
    const value = await res.json();
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, isFormData = false, signal, timeoutMs = 30000 } = options;
  const token = await getToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!isFormData && body !== undefined) headers["Content-Type"] = "application/json";

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : (isFormData ? body as FormData : JSON.stringify(body)),
      signal: controller.signal,
    });
    const data = await readResponse(res);
    if (res.status === 204) return undefined as T;
    if (!res.ok) {
      const message = typeof data.error === "string" ? data.error :
        res.status === 401 ? "Your session has expired. Please sign in again." :
        res.status === 403 ? "You do not have permission to do that." :
        res.status === 404 ? "The requested resource was not found." :
        res.status === 429 ? "Too many requests. Please wait a moment and try again." :
        "Something went wrong. Please try again.";
      throw new ApiError(message, res.status, typeof data.code === "string" ? data.code : undefined);
    }
    return data as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(signal?.aborted ? "Request cancelled." : "The request timed out. Please try again.", 408);
    }
    throw new ApiError("Network error. Please check your connection and try again.", 0);
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export { getToken };
