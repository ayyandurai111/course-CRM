import { supabase } from "./supabaseClient";

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  isFormData?: boolean;
}

/**
 * Every request grabs the current Supabase access token. getSession()
 * returns the cached session and silently refreshes it in the
 * background if it's close to expiry, so callers never need manual
 * refresh logic — same guarantee the old firebaseAuth.currentUser +
 * getIdToken() gave us.
 */
async function getToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, isFormData = false } = options;

  const token = await getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (!isFormData) headers["Content-Type"] = "application/json";

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? (isFormData ? (body as FormData) : JSON.stringify(body)) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.error || "Something went wrong.", res.status);
  }
  return data as T;
}

export { ApiError, getToken };
