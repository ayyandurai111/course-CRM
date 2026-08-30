import type { ComponentType } from "react";
import type { ContentType } from "../../types/index";
import { PlayIcon, FileTextIcon, ImageIcon } from "./Icons";

export const CONTENT_TYPE_CONFIG: Record<
  ContentType,
  { label: string; icon: ComponentType<{ className?: string }>; className: string }
> = {
  VIDEO: { label: "Video", icon: PlayIcon, className: "bg-ink-900 text-paper-50" },
  PDF: { label: "PDF", icon: FileTextIcon, className: "bg-ink-700 text-paper-50" },
  POST: { label: "Post", icon: ImageIcon, className: "bg-amber-500 text-ink-950" },
};

// The recurring "typed icon chip" is this platform's signature visual
// motif — every content surface (landing showcase, dashboard feed, admin
// table) uses the same three marks so a user learns to recognize content
// type at a glance without reading a label.
export default function ContentTypeBadge({ type, className = "" }: { type: ContentType; className?: string }) {
  const cfg = CONTENT_TYPE_CONFIG[type];
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium tracking-wide ${cfg.className} ${className}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {cfg.label}
    </span>
  );
}
