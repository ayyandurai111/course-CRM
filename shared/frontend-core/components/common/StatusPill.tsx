import type { ContentStatus } from "../../types/index";

const CONFIG: Record<ContentStatus, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-ink-100 text-ink-700 border-ink-300/60" },
  SCHEDULED: { label: "Scheduled", className: "bg-amber-400/15 text-amber-600 border-amber-400/40" },
  PUBLISHED: { label: "Published", className: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" },
  UNPUBLISHED: { label: "Unpublished", className: "bg-ink-100 text-ink-500 border-ink-300/60" },
  ARCHIVED: { label: "Archived", className: "bg-red-500/10 text-red-700 border-red-500/25" },
};

export default function StatusPill({ status }: { status: ContentStatus }) {
  const cfg = CONFIG[status];
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}
