import { useEffect, useRef } from "react";
import { useProtectedFile } from "../../hooks/useProtectedFile";
import { apiRequest } from "../../lib/apiClient";
import type { ContentItem } from "../../types";
import { ErrorState } from "../common/States";
import { Skeleton } from "../common/Skeleton";
import { XIcon } from "../common/Icons";

export default function VideoPlayerModal({ content, onClose }: { content: ContentItem; onClose: () => void }) {
  const { url, error, loading } = useProtectedFile(content.id);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSaveRef = useRef(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function saveProgress(percent: number, positionSeconds: number) {
    const now = Date.now();
    if (now - lastSaveRef.current < 4000 && percent < 100) return; // throttle
    lastSaveRef.current = now;
    try {
      await apiRequest(`/content/${content.id}/progress`, {
        method: "POST",
        body: { progressPercent: Math.round(percent), lastPositionSeconds: Math.round(positionSeconds), viewed: percent >= 95 },
      });
    } catch {
      // Non-critical — progress will sync on the next tick or view.
    }
  }

  function handleTimeUpdate() {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    saveProgress((v.currentTime / v.duration) * 100, v.currentTime);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-3xl overflow-hidden rounded-xl2 bg-black shadow-2xl">
        <div className="flex items-center justify-between bg-ink-950 px-4 py-3">
          <p className="truncate text-sm font-medium text-paper-50">{content.title}</p>
          <button onClick={onClose} aria-label="Close video" className="rounded-full p-1.5 text-paper-50 hover:bg-white/10">
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="aspect-video w-full bg-black">
          {loading && <Skeleton className="h-full w-full rounded-none bg-white/10" />}
          {error && <div className="p-6"><ErrorState message={error} /></div>}
          {url && (
            <video
              ref={videoRef}
              src={url}
              controls
              autoPlay
              className="h-full w-full"
              onTimeUpdate={handleTimeUpdate}
              onEnded={() => saveProgress(100, videoRef.current?.duration || 0)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
