import { useEffect, useState } from "react";
import { apiRequest, ApiError } from "../lib/apiClient";

/**
 * Fetches a short-lived signed URL for a protected content file and
 * exposes it for direct use as a <video>/<iframe> src. Using the signed
 * URL directly (rather than downloading the whole file as a blob) lets
 * the browser make native HTTP range requests, so video scrubbing works
 * correctly instead of requiring the whole file to buffer first.
 */
export function useProtectedFile(contentId: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!contentId) return;
    let cancelled = false;

    async function fetchUrl() {
      setLoading(true);
      setError(null);
      try {
        const data = await apiRequest<{ url: string }>(`/files/${contentId}`);
        if (!cancelled) setUrl(data.url);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Couldn't load this file.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchUrl();
    return () => {
      cancelled = true;
    };
  }, [contentId]);

  return { url, error, loading };
}
