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

let inFlightRefresh: Promise<string | null> | null = null;

async function getToken(forceRefresh = false): Promise<string | null> {
  if (forceRefresh) {
    // The cached session's access token can go stale while the tab is
    // busy elsewhere (e.g. a WebRTC/LiveKit call), since the
    // background auto-refresh timer isn't guaranteed to fire in time.
    // Force Supabase to actually re-validate/refresh against its
    // server instead of trusting whatever is cached in localStorage.
    //
    // Bug fix: pages that fire several requests at once (e.g.
    // OverviewSection's Promise.all of /admin/overview +
    // /admin/audit-logs) used to have EACH request independently call
    // refreshSession() the moment its own 401 came back. Supabase
    // refresh tokens are single-use/rotating, so of two simultaneous
    // refreshSession() calls only the first actually succeeds — the
    // second is presenting an already-consumed token and gets a hard
    // 400 back from Supabase's server ("Invalid Refresh Token"). That
    // failure used to be swallowed and silently re-shown as "Invalid
    // or expired session" even though the login itself was completely
    // fine, just raced. Sharing one in-flight refresh promise across
    // every concurrent caller means there's only ever one real
    // refreshSession() call in the air at a time — everyone else just
    // awaits its result instead of racing it.
    if (!inFlightRefresh) {
      inFlightRefresh = supabase.auth
        .refreshSession()
        .then(({ data, error }) => {
          if (error) throw new ApiError("Your session could not be checked. Please sign in again.", 401);
          return data.session?.access_token ?? null;
        })
        .finally(() => {
          inFlightRefresh = null;
        });
    }
    return inFlightRefresh;
  }
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

async function doFetch(path: string, options: RequestOptions, token: string | null): Promise<Response> {
  const { method = "GET", body, isFormData = false, signal, timeoutMs = 30000 } = options;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!isFormData && body !== undefined) headers["Content-Type"] = "application/json";

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : (isFormData ? body as FormData : JSON.stringify(body)),
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    let token = await getToken();
    let res = await doFetch(path, options, token);

    // The cached Supabase session can be stale (e.g. after the tab was
    // busy in a LiveKit call and missed its background token refresh).
    // On a 401, force a real refresh against Supabase once and retry
    // before giving up and telling the user to sign in again.
    if (res.status === 401) {
      try {
        token = await getToken(true);
        res = await doFetch(path, options, token);
        if (res.status === 401) {
          // A genuinely fresh, just-refreshed token was STILL rejected
          // — the session really is done for (e.g. the account was
          // deleted, or Supabase's own project keys changed). Clear
          // the stale session so App.tsx's RequireRole/RequireMeeting
          // guards redirect to /login on their own, instead of the
          // "Try again" button on this error retrying the exact same
          // doomed request forever.
          supabase.auth.signOut().catch(() => {});
        }
      } catch {
        // Refresh itself failed (e.g. refresh token also expired/
        // revoked). Same reasoning as above: this session is not
        // coming back on its own, so clear it now rather than leaving
        // a dead session in localStorage for every future request to
        // trip over again.
        supabase.auth.signOut().catch(() => {});
      }
    }

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
      throw new ApiError(options.signal?.aborted ? "Request cancelled." : "The request timed out. Please try again.", 408);
    }
    throw new ApiError("Network error. Please check your connection and try again.", 0);
  }
}

export { getToken };
