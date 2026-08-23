import { useEffect, useState } from "react";
import { apiRequest, ApiError } from "../lib/apiClient";

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

  useEffect(() => {
    if (!contentId) return;
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let hasLoadedOnce = false;
    const REFRESH_SAFETY_SECONDS = 60;

    async function fetchUrl() {
      const initialLoad = !hasLoadedOnce;
      if (initialLoad) setLoading(true);
      try {
        const data = await apiRequest<{ url: string; expiresInSeconds: number }>(`/files/${contentId}/playback`);
        if (!cancelled) {
          hasLoadedOnce = true;
          setUrl(data.url);
          // Renew before expiry while the viewer remains open. The cookie is
          // HttpOnly, so JavaScript never receives or stores the token itself.
          const ttl = Math.max(60, Number(data.expiresInSeconds) || 600);
          const refreshAfterMs = Math.max(30_000, (ttl - REFRESH_SAFETY_SECONDS) * 1000);
          refreshTimer = setTimeout(fetchUrl, refreshAfterMs);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Couldn't refresh protected content.");
          // Keep the existing URL/token alive if this was a transient refresh
          // failure, and retry shortly without interrupting the viewer.
          if (!initialLoad) refreshTimer = setTimeout(fetchUrl, 30_000);
        }
      } finally {
        if (!cancelled && initialLoad) setLoading(false);
      }
    }

    fetchUrl();
    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      setUrl(null);
    };
  }, [contentId]);

  return { url, error, loading };
}
