import { useState } from "react";
import type { SiteContent } from "../../../../shared/frontend-core/types/index";

export default function Faq({ content }: { content: SiteContent["faq"] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="scroll-mt-24 mx-auto max-w-3xl px-5 py-20">
      <p className="text-center font-mono text-xs font-medium uppercase tracking-widest text-amber-600">{content.eyebrow}</p>
      <h2 className="mt-2 text-center font-display text-3xl font-semibold tracking-tight text-ink-950">{content.title}</h2>

      <div className="mt-10 divide-y divide-ink-900/8 rounded-xl2 border border-ink-900/8 bg-white shadow-card">
        {content.items.map((item, i) => {
          const isOpen = openIndex === i;
          return (
            <div key={item.q}>
              <button
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                aria-expanded={isOpen}
                onClick={() => setOpenIndex(isOpen ? null : i)}
              >
                <span className="font-medium text-ink-900">{item.q}</span>
                <span className={`shrink-0 text-ink-500 transition-transform ${isOpen ? "rotate-45" : ""}`} aria-hidden="true">
                  +
                </span>
              </button>
              {isOpen && <p className="px-5 pb-4 text-sm leading-relaxed text-ink-500">{item.a}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
