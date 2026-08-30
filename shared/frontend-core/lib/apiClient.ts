import { supabase } from "./supabaseClient";

export class ApiError extends Error {
  status: number;
  code?: string;
  // True when this error is the tail end of a confirmed session expiry
  // (forced refresh already failed and signOut() has been triggered).
  // Call sites should skip their usual alert() for this case — the
  // user is about to be redirected to /login with a friendly message
  // instead, so popping a native alert on top of that is redundant.
  sessionExpired?: boolean;
  constructor(message: string, status: number, code?: string, sessionExpired?: boolean) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.sessionExpired = sessionExpired;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  isFormData?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

// Fires once when a request discovers the session is truly gone (not
// just a stale cached token — the forced refresh itself failed too).
// LoginPage listens for this via sessionStorage to show a friendly
// "please sign in again" message instead of every call site popping
// its own alert() on top of the redirect that AuthContext/App.tsx
// already trigger once supabase.auth.signOut() fires SIGNED_OUT.
const SESSION_EXPIRED_KEY = "coursewell:session-expired-message";

function markSessionExpired(message: string) {
  try { sessionStorage.setItem(SESSION_EXPIRED_KEY, message); } catch { /* ignore */ }
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
  let sessionExpired = false;
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
          sessionExpired = true;
          markSessionExpired("Your session expired. Please sign in again.");
          supabase.auth.signOut().catch(() => {});
        }
      } catch {
        // Refresh itself failed (e.g. refresh token also expired/
        // revoked). Same reasoning as above: this session is not
        // coming back on its own, so clear it now rather than leaving
        // a dead session in localStorage for every future request to
        // trip over again.
        sessionExpired = true;
        markSessionExpired("Your session expired. Please sign in again.");
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
      throw new ApiError(message, res.status, typeof data.code === "string" ? data.code : undefined, sessionExpired);
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

/**
 * Drop-in replacement for the old `alert(err instanceof ApiError ? err.message : fallback)`
 * pattern used across the admin screens. Skips the popup entirely when
 * the error is a confirmed session expiry — App.tsx's route guards are
 * already redirecting to /login, and LoginPage shows the friendly
 * message on arrival (see SESSION_EXPIRED_KEY above), so an extra
 * native alert() on top of that redirect is just noise.
 */
export function reportActionError(err: unknown, fallback: string) {
  if (err instanceof ApiError) {
    if (err.sessionExpired) return;
    alert(err.message);
    return;
  }
  alert(fallback);
}

/** Read + clear the one-shot "you were signed out" message, if any. */
export function consumeSessionExpiredMessage(): string | null {
  try {
    const msg = sessionStorage.getItem(SESSION_EXPIRED_KEY);
    if (msg) sessionStorage.removeItem(SESSION_EXPIRED_KEY);
    return msg;
  } catch {
    return null;
  }
}
