import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest, ApiError } from "../../../../shared/frontend-core/lib/apiClient";

/**
 * Returns an API streaming URL, never a raw Supabase Storage URL.
 * The backend sets an HttpOnly, SameSite=Strict playback cookie. The browser
 * can use the returned URL for native video/PDF range requests without
 * exposing a reusable Storage bearer URL to the page or download UI.
 */
export function useProtectedFile(contentId: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const hasLoadedOnceRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  const fetchUrl = useCallback(async () => {
    if (!contentId) return;
    const initialLoad = !hasLoadedOnceRef.current;
    if (initialLoad) setLoading(true);
    try {
      const data = await apiRequest<{ url: string; expiresInSeconds: number }>(`/files/${contentId}/playback`);
      if (!cancelledRef.current) {
        hasLoadedOnceRef.current = true;
        setError(null);
        setUrl(data.url);
        // Renew before expiry while the viewer remains open. The cookie is
        // HttpOnly, so JavaScript never receives or stores the token itself.
        const ttl = Math.max(60, Number(data.expiresInSeconds) || 600);
        const REFRESH_SAFETY_SECONDS = 60;
        const refreshAfterMs = Math.max(30_000, (ttl - REFRESH_SAFETY_SECONDS) * 1000);
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = setTimeout(fetchUrl, refreshAfterMs);
      }
    } catch (err) {
      if (!cancelledRef.current) {
        setError(err instanceof ApiError ? err.message : "Couldn't refresh protected content.");
        // Keep the existing URL/token alive if this was a transient refresh
        // failure, and retry shortly without interrupting the viewer.
        if (!initialLoad) {
          if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
          refreshTimerRef.current = setTimeout(fetchUrl, 30_000);
        }
      }
    } finally {
      if (!cancelledRef.current && initialLoad) setLoading(false);
    }
  }, [contentId]);

  useEffect(() => {
    cancelledRef.current = false;
    hasLoadedOnceRef.current = false;
    setUrl(null);
    fetchUrl();
    return () => {
      cancelledRef.current = true;
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [fetchUrl]);

  // Mint a brand-new playback token/cookie on demand. The streaming URL
  // itself never changes (it's just `/api/files/stream/:id`), so callers
  // that want the <video>/<iframe> element to actually re-request the
  // resource with a fresh cookie need to follow this with a manual
  // reload (e.g. `videoRef.current.load()`) — updating `url` state alone
  // won't do it, since the string doesn't change.
  const refresh = useCallback(() => fetchUrl(), [fetchUrl]);

  return { url, error, loading, refresh };
}
