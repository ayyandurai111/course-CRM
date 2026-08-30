import { useState } from "react";
import LegalDrawer from "./LegalDrawer";
import type { SiteContent } from "../../../../shared/frontend-core/types/index";

export default function Footer({ footer, legal }: { footer: SiteContent["footer"]; legal: SiteContent["legal"] }) {
  const [legalOpen, setLegalOpen] = useState<"terms" | "privacy" | null>(null);

  return (
    <footer className="border-t border-ink-900/8 px-5 py-12">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 md:flex-row">
        <div className="text-center md:text-left">
          <p className="font-display text-lg font-semibold text-ink-950">Coursewell</p>
          <p className="mt-1 text-sm text-ink-500">{footer.tagline}</p>
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-ink-500">
          <a href="#courses" className="hover:text-ink-900">Courses</a>
          <a href="#plans" className="hover:text-ink-900">Plans</a>
          <a href="#faq" className="hover:text-ink-900">FAQ</a>
          <button onClick={() => setLegalOpen("terms")} className="hover:text-ink-900">Terms</button>
          <button onClick={() => setLegalOpen("privacy")} className="hover:text-ink-900">Privacy</button>
        </nav>
      </div>
      <p className="mt-8 text-center text-xs text-ink-300">© {new Date().getFullYear()} Coursewell. All rights reserved.</p>

      {legalOpen === "terms" && (
        <LegalDrawer title="Terms & Conditions" onClose={() => setLegalOpen(null)}>
          <p style={{ whiteSpace: "pre-wrap" }}>{legal.terms}</p>
        </LegalDrawer>
      )}
      {legalOpen === "privacy" && (
        <LegalDrawer title="Privacy Policy" onClose={() => setLegalOpen(null)}>
          <p style={{ whiteSpace: "pre-wrap" }}>{legal.privacy}</p>
        </LegalDrawer>
      )}
    </footer>
  );
}
