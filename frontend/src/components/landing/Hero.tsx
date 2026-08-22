import type { SiteContent } from "../../types";

export default function Hero({ content }: { content: SiteContent["hero"] }) {
  return (
    <section id="top" className="relative overflow-hidden px-5 pb-20 pt-16 md:pb-28 md:pt-24">
      <div
        className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-amber-400/20 blur-3xl"
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-4xl text-center">
        {content.badge && (
          <span className="inline-flex items-center rounded-full border border-ink-900/10 bg-white px-3 py-1 text-xs font-mono font-medium tracking-wide text-ink-500">
            {content.badge}
          </span>
        )}
        <h1 className="mt-6 font-display text-4xl font-semibold leading-[1.1] tracking-tight text-ink-950 md:text-6xl">
          {content.titleLine1}
          {content.titleLine2 && (
            <>
              <br />
              {content.titleLine2}
            </>
          )}
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-ink-500 md:text-lg">{content.subtitle}</p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href="#courses"
            className="w-full rounded-full bg-ink-950 px-6 py-3 text-sm font-semibold text-paper-50 transition hover:bg-ink-900 sm:w-auto"
          >
            {content.primaryCtaLabel}
          </a>
          <a
            href="#plans"
            className="w-full rounded-full border border-ink-900/15 bg-white px-6 py-3 text-sm font-semibold text-ink-900 transition hover:border-ink-900/30 sm:w-auto"
          >
            {content.secondaryCtaLabel}
          </a>
        </div>
      </div>
    </section>
  );
}
