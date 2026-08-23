import { useEffect } from "react";
import { apiRequest } from "../../lib/apiClient";
import type { ContentItem } from "../../types";
import { XIcon } from "../common/Icons";

export default function PostViewerModal({ content, onClose }: { content: ContentItem; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    apiRequest(`/content/${content.id}/progress`, { method: "POST", body: { viewed: true, progressPercent: 100 } }).catch(() => {});
    return () => document.removeEventListener("keydown", onKey);
  }, [content.id, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg overflow-hidden rounded-xl2 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-900/8 px-4 py-3">
          <p className="truncate text-sm font-medium text-ink-900">{content.title}</p>
          <button onClick={onClose} aria-label="Close post" className="rounded-full p-1.5 text-ink-500 hover:bg-ink-100">
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        {content.imageUrl && <img src={content.imageUrl} alt="" className="w-full" />}
        {content.description && <p className="p-4 text-sm leading-relaxed text-ink-700">{content.description}</p>}
      </div>
    </div>
  );
}
