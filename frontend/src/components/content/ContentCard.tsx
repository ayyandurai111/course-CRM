import type { ContentItem } from "../../types";
import ContentTypeBadge, { CONTENT_TYPE_CONFIG } from "../common/ContentTypeBadge";

function formatDate(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDuration(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function ContentCard({ item, onOpen }: { item: ContentItem; onOpen: (item: ContentItem) => void }) {
  const progress = Math.min(100, Math.max(0, Number(item.progress?.percent ?? 0) || 0));
  const viewed = item.progress?.viewed ?? false;

  return (
    <article className="flex flex-col overflow-hidden rounded-xl2 border border-ink-900/8 bg-white shadow-card">
      <div className="relative h-40 w-full overflow-hidden bg-ink-100">
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt=""
            draggable={false}
            onContextMenu={(e) => e.preventDefault()}
            className="absolute inset-0 block h-full w-full select-none object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-ink-300">
            {(() => {
              const Icon = CONTENT_TYPE_CONFIG[item.type].icon;
              return <Icon className="h-10 w-10" />;
            })()}
          </div>
        )}
        <ContentTypeBadge type={item.type} className="absolute left-3 top-3" />
        {viewed && (
          <span className="absolute right-3 top-3 rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-medium text-white">
            Viewed
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        {item.course && <p className="text-xs font-medium text-ink-500">{item.course.title}</p>}
        <h3 className="mt-1 font-display text-base font-semibold text-ink-950">{item.title}</h3>
        {item.description && <p className="mt-1 line-clamp-2 flex-1 text-sm text-ink-500">{item.description}</p>}

        <div className="mt-3 flex items-center gap-2 text-xs text-ink-500">
          <span>{formatDate(item.publishedAt)}</span>
          {item.type === "VIDEO" && item.durationSeconds && <span>· {formatDuration(item.durationSeconds)}</span>}
          {item.type === "PDF" && item.pageCount && <span>· {item.pageCount} pages</span>}
        </div>

        {item.type === "VIDEO" && progress > 0 && progress < 100 && (
          <div className="mt-3">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
              <div className="h-full rounded-full bg-amber-500" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-1 text-xs text-ink-500">{progress}% watched</p>
          </div>
        )}

        <button
          onClick={() => onOpen(item)}
          className="mt-4 rounded-full bg-ink-950 px-4 py-2 text-sm font-semibold text-paper-50 transition hover:bg-ink-900"
        >
          {item.type === "VIDEO" ? (progress > 0 ? "Continue watching" : "Watch") : item.type === "PDF" ? "Read PDF" : "View post"}
        </button>
      </div>
    </article>
  );
}
