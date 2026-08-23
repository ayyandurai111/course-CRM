import type { ComponentType } from "react";
import {
  LayoutDashboardIcon,
  BookOpenIcon,
  LayersIcon,
  UsersIcon,
  CreditCardIcon,
  GlobeIcon,
} from "../common/Icons";

const SECTIONS: { key: string; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboardIcon },
  { key: "courses", label: "Courses", icon: BookOpenIcon },
  { key: "content", label: "Content", icon: LayersIcon },
  { key: "students", label: "Students", icon: UsersIcon },
  { key: "plans", label: "Plans", icon: CreditCardIcon },
  { key: "site", label: "Site content", icon: GlobeIcon },
] as const;

export type AdminSection = (typeof SECTIONS)[number]["key"];

export default function AdminSidebar({
  active,
  onChange,
}: {
  active: AdminSection;
  onChange: (s: AdminSection) => void;
}) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-ink-900/8 bg-white px-3 py-2 md:w-56 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:px-3 md:py-6">
      {SECTIONS.map((s) => {
        const Icon = s.icon;
        return (
          <button
            key={s.key}
            onClick={() => onChange(s.key)}
            className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${
              active === s.key ? "bg-ink-950 text-paper-50" : "text-ink-700 hover:bg-ink-100"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {s.label}
          </button>
        );
      })}
    </nav>
  );
}
