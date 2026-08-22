const SECTIONS = [
  { key: "overview", label: "Overview", glyph: "▣" },
  { key: "courses", label: "Courses", glyph: "◈" },
  { key: "content", label: "Content", glyph: "▤" },
  { key: "students", label: "Students", glyph: "◎" },
  { key: "plans", label: "Plans", glyph: "✦" },
  { key: "site", label: "Site content", glyph: "◫" },
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
      {SECTIONS.map((s) => (
        <button
          key={s.key}
          onClick={() => onChange(s.key)}
          className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${
            active === s.key ? "bg-ink-950 text-paper-50" : "text-ink-700 hover:bg-ink-100"
          }`}
        >
          <span aria-hidden="true">{s.glyph}</span>
          {s.label}
        </button>
      ))}
    </nav>
  );
}
