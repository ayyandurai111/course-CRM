import { useEffect } from "react";
import { useProtectedFile } from "../../hooks/useProtectedFile";
import { apiRequest } from "../../lib/apiClient";
import type { ContentItem } from "../../types";
import { ErrorState } from "../common/States";
import { Skeleton } from "../common/Skeleton";
import { XIcon } from "../common/Icons";

export default function PdfViewerModal({ content, onClose }: { content: ContentItem; onClose: () => void }) {
  const { url, error, loading } = useProtectedFile(content.id);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Mark as viewed as soon as the PDF is opened — there's no reliable
  // "pages read" signal from an embedded viewer without a custom renderer,
  // so read status is a simple viewed flag rather than a fake percentage.
  useEffect(() => {
    if (!url) return;
    apiRequest(`/content/${content.id}/progress`, { method: "POST", body: { viewed: true, progressPercent: 100 } }).catch(() => {});
  }, [url, content.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 p-4" role="dialog" aria-modal="true">
      <div className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl2 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-900/8 px-4 py-3">
          <p className="truncate text-sm font-medium text-ink-900">{content.title}</p>
          <button onClick={onClose} aria-label="Close PDF" className="rounded-full p-1.5 text-ink-500 hover:bg-ink-100">
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 bg-ink-100" onContextMenu={(e) => e.preventDefault()}>
          {loading && <Skeleton className="h-full w-full rounded-none" />}
          {error && <div className="p-6"><ErrorState message={error} /></div>}
          {url && (
            // #toolbar=0&navpanes=0 hides Chrome's/Firefox's built-in PDF
            // viewer toolbar (which otherwise has its own download/print
            // buttons) — a viewer-level convention, not a real security
            // boundary. See the note below on what this can't stop.
            <iframe title={content.title} src={`${url}#toolbar=0&navpanes=0&scrollbar=0`} className="h-full w-full" />
          )}
        </div>
      </div>
    </div>
  );
}
