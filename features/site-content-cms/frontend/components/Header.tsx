import { useState } from "react";
import { Link } from "react-router-dom";
import { brand } from "../../../../shared/frontend-core/theme/brand.config";

const LINKS = [
  { href: "#courses", label: "Courses" },
  { href: "#features", label: "Features" },
  { href: "#plans", label: "Plans" },
  { href: "#faq", label: "FAQ" },
];

export default function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-ink-900/5 bg-paper-50/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <a href="#top" onClick={() => setOpen(false)} className="font-display text-lg font-semibold tracking-tight text-ink-950">
          {brand.name}
        </a>

        <nav className="hidden items-center gap-8 md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-sm font-medium text-ink-700 transition hover:text-ink-950">
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link to="/login" className="text-sm font-medium text-ink-700 hover:text-ink-950">
            Log in
          </Link>
          <a
            href="#plans"
            className="rounded-full bg-ink-950 px-4 py-2 text-sm font-semibold text-paper-50 transition hover:bg-ink-900"
          >
            Explore plans
          </a>
        </div>

        <button
          className="rounded-md p-2 text-ink-900 md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="block h-0.5 w-6 bg-current" />
          <span className="mt-1.5 block h-0.5 w-6 bg-current" />
          <span className="mt-1.5 block h-0.5 w-6 bg-current" />
        </button>
      </div>

      {open && (
        <div className="border-t border-ink-900/5 bg-paper-50 px-5 pb-5 md:hidden">
          <nav className="flex flex-col gap-3 pt-3">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="text-sm font-medium text-ink-700">
                {l.label}
              </a>
            ))}
            <Link to="/login" onClick={() => setOpen(false)} className="text-sm font-medium text-ink-700">
              Log in
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
