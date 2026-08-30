import type { SiteContent } from "../../../../shared/frontend-core/types/index";

export default function Features({ content }: { content: SiteContent["features"] }) {
  return (
    <section id="features" className="scroll-mt-24 bg-ink-950 px-5 py-20 text-paper-50">
      <div className="mx-auto max-w-6xl">
        <p className="font-mono text-xs font-medium uppercase tracking-widest text-amber-400">{content.eyebrow}</p>
        <h2 className="mt-2 max-w-lg font-display text-3xl font-semibold tracking-tight">{content.title}</h2>

        <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {content.items.map((f) => (
            <div key={f.title}>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 font-mono text-amber-400">
                {f.glyph}
              </span>
              <h3 className="mt-4 font-display text-lg font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-300">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
