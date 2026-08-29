import type { ContentType } from "../../types";

const TABS: { key: ContentType | "ALL" | "QUIZ"; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "VIDEO", label: "Videos" },
  { key: "PDF", label: "PDFs" },
  { key: "POST", label: "Posts" },
  { key: "QUIZ", label: "Quizzes" },
];

export default function ContentTabs({
  active,
  onChange,
}: {
  active: ContentType | "ALL" | "QUIZ";
  onChange: (tab: ContentType | "ALL" | "QUIZ") => void;
}) {
  return (
    <div role="tablist" aria-label="Content type" className="flex w-fit max-w-full overflow-x-auto rounded-full bg-ink-100 p-1 text-sm font-medium">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={active === tab.key}
          onClick={() => onChange(tab.key)}
          className={`shrink-0 rounded-full px-4 py-2 transition ${
            active === tab.key ? "bg-white text-ink-950 shadow" : "text-ink-500 hover:text-ink-900"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
