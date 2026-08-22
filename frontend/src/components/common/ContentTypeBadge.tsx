import type { ContentType } from "../../types";

const CONFIG: Record<ContentType, { label: string; glyph: string; className: string }> = {
  VIDEO: { label: "Video", glyph: "▶", className: "bg-ink-900 text-paper-50" },
  PDF: { label: "PDF", glyph: "▤", className: "bg-ink-700 text-paper-50" },
  POST: { label: "Post", glyph: "◆", className: "bg-amber-500 text-ink-950" },
};

// The recurring "typed glyph chip" is this platform's signature visual
// motif — every content surface (landing showcase, dashboard feed, admin
// table) uses the same three marks so a user learns to recognize content
// type at a glance without reading a label.
export default function ContentTypeBadge({ type, className = "" }: { type: ContentType; className?: string }) {
  const cfg = CONFIG[type];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-mono font-medium tracking-wide ${cfg.className} ${className}`}
    >
      <span aria-hidden="true">{cfg.glyph}</span>
      {cfg.label}
    </span>
  );
}
