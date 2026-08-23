import { useEffect, useState } from "react";
import { apiRequest, ApiError } from "../../lib/apiClient";
import { DEFAULT_SITE_CONTENT } from "../../lib/defaultSiteContent";
import type { SiteContent, FeatureItem, FaqItem } from "../../types";
import { ErrorState } from "../common/States";
import { FormSectionsSkeleton, Skeleton } from "../common/Skeleton";
import { Field, inputClass } from "../forms/FormFields";
import { ExternalLinkIcon, CheckIcon, PlusIcon } from "../common/Icons";

function SectionCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl2 border border-ink-900/8 bg-white p-6 shadow-card">
      <h2 className="font-display text-base font-semibold text-ink-950">{title}</h2>
      {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
      <div className="mt-5">{children}</div>
    </div>
  );
}

export default function SiteContentSection() {
  const [content, setContent] = useState<SiteContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function load() {
    setError(null);
    try {
      const data = await apiRequest<{ content: SiteContent | null }>("/site-content");
      setContent(data.content || DEFAULT_SITE_CONTENT);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load site content.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  function update<K extends keyof SiteContent>(section: K, value: SiteContent[K]) {
    setContent((prev) => (prev ? { ...prev, [section]: value } : prev));
    setSaved(false);
  }

  async function handleSave() {
    if (!content) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest("/site-content", { method: "PUT", body: content });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save changes.");
    } finally {
      setSaving(false);
    }
  }

  if (!content && !error) {
    return (
      <div className="pb-24">
        <div className="mb-5">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="mt-2 h-3 w-64" />
        </div>
        <FormSectionsSkeleton count={4} />
      </div>
    );
  }
  if (error && !content) return <ErrorState message={error} onRetry={load} />;
  if (!content) return null;

  function updateFeatureItem(index: number, patch: Partial<FeatureItem>) {
    const items = [...content!.features.items];
    items[index] = { ...items[index], ...patch };
    update("features", { ...content!.features, items });
  }

  function addFeatureItem() {
    update("features", { ...content!.features, items: [...content!.features.items, { glyph: "✦", title: "", desc: "" }] });
  }

  function removeFeatureItem(index: number) {
    update("features", { ...content!.features, items: content!.features.items.filter((_, i) => i !== index) });
  }

  function updateFaqItem(index: number, patch: Partial<FaqItem>) {
    const items = [...content!.faq.items];
    items[index] = { ...items[index], ...patch };
    update("faq", { ...content!.faq, items });
  }

  function addFaqItem() {
    update("faq", { ...content!.faq, items: [...content!.faq.items, { q: "", a: "" }] });
  }

  function removeFaqItem(index: number) {
    update("faq", { ...content!.faq, items: content!.faq.items.filter((_, i) => i !== index) });
  }

  return (
    <div className="pb-24">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink-950">Site content</h1>
          <p className="mt-1 text-sm text-ink-500">Edit the copy shown on your public landing page.</p>
        </div>
        <a
          href="/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-700 hover:text-ink-950"
        >
          View live site
          <ExternalLinkIcon className="h-3.5 w-3.5" />
        </a>
      </div>

      <div className="space-y-6">
        <SectionCard title="Hero section" description="The first thing visitors see.">
          <Field label="Badge text (small pill above the headline)" htmlFor="hero-badge">
            <input id="hero-badge" value={content.hero.badge} onChange={(e) => update("hero", { ...content.hero, badge: e.target.value })} className={inputClass} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Headline — line 1" htmlFor="hero-t1">
              <input id="hero-t1" value={content.hero.titleLine1} onChange={(e) => update("hero", { ...content.hero, titleLine1: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Headline — line 2 (optional)" htmlFor="hero-t2">
              <input id="hero-t2" value={content.hero.titleLine2} onChange={(e) => update("hero", { ...content.hero, titleLine2: e.target.value })} className={inputClass} />
            </Field>
          </div>
          <Field label="Subtitle" htmlFor="hero-sub">
            <textarea id="hero-sub" rows={2} value={content.hero.subtitle} onChange={(e) => update("hero", { ...content.hero, subtitle: e.target.value })} className={inputClass} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Primary button label" htmlFor="hero-cta1">
              <input id="hero-cta1" value={content.hero.primaryCtaLabel} onChange={(e) => update("hero", { ...content.hero, primaryCtaLabel: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Secondary button label" htmlFor="hero-cta2">
              <input id="hero-cta2" value={content.hero.secondaryCtaLabel} onChange={(e) => update("hero", { ...content.hero, secondaryCtaLabel: e.target.value })} className={inputClass} />
            </Field>
          </div>
        </SectionCard>

        <SectionCard title="Course showcase heading">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Eyebrow label" htmlFor="cs-eyebrow">
              <input id="cs-eyebrow" value={content.courseShowcase.eyebrow} onChange={(e) => update("courseShowcase", { ...content.courseShowcase, eyebrow: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Heading" htmlFor="cs-title">
              <input id="cs-title" value={content.courseShowcase.title} onChange={(e) => update("courseShowcase", { ...content.courseShowcase, title: e.target.value })} className={inputClass} />
            </Field>
          </div>
        </SectionCard>

        <SectionCard title="Features" description="Add, edit, or remove the feature tiles shown on the dark section.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Eyebrow label" htmlFor="feat-eyebrow">
              <input id="feat-eyebrow" value={content.features.eyebrow} onChange={(e) => update("features", { ...content.features, eyebrow: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Heading" htmlFor="feat-title">
              <input id="feat-title" value={content.features.title} onChange={(e) => update("features", { ...content.features, title: e.target.value })} className={inputClass} />
            </Field>
          </div>

          <div className="space-y-3">
            {content.features.items.map((item, i) => (
              <div key={i} className="rounded-lg border border-ink-900/10 p-3">
                <div className="flex flex-wrap gap-3">
                  <input
                    value={item.glyph}
                    onChange={(e) => updateFeatureItem(i, { glyph: e.target.value })}
                    className={`${inputClass} w-16 shrink-0 text-center`}
                    aria-label="Icon glyph"
                    maxLength={2}
                  />
                  <input
                    value={item.title}
                    onChange={(e) => updateFeatureItem(i, { title: e.target.value })}
                    className={`${inputClass} min-w-[10rem] flex-1`}
                    placeholder="Feature title"
                  />
                  <button onClick={() => removeFeatureItem(i)} className="shrink-0 px-2 text-sm font-medium text-red-600 hover:text-red-700">
                    Remove
                  </button>
                </div>
                <textarea
                  value={item.desc}
                  onChange={(e) => updateFeatureItem(i, { desc: e.target.value })}
                  className={`${inputClass} mt-2`}
                  rows={2}
                  placeholder="Feature description"
                />
              </div>
            ))}
          </div>
          <button onClick={addFeatureItem} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-ink-700 hover:text-ink-950">
            <PlusIcon className="h-4 w-4" />
            Add feature
          </button>
        </SectionCard>

        <SectionCard title="Plans section heading">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Eyebrow label" htmlFor="plans-eyebrow">
              <input id="plans-eyebrow" value={content.plansSection.eyebrow} onChange={(e) => update("plansSection", { ...content.plansSection, eyebrow: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Heading" htmlFor="plans-title">
              <input id="plans-title" value={content.plansSection.title} onChange={(e) => update("plansSection", { ...content.plansSection, title: e.target.value })} className={inputClass} />
            </Field>
          </div>
        </SectionCard>

        <SectionCard title="FAQ" description="Add, edit, or remove questions.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Eyebrow label" htmlFor="faq-eyebrow">
              <input id="faq-eyebrow" value={content.faq.eyebrow} onChange={(e) => update("faq", { ...content.faq, eyebrow: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Heading" htmlFor="faq-title">
              <input id="faq-title" value={content.faq.title} onChange={(e) => update("faq", { ...content.faq, title: e.target.value })} className={inputClass} />
            </Field>
          </div>

          <div className="space-y-3">
            {content.faq.items.map((item, i) => (
              <div key={i} className="rounded-lg border border-ink-900/10 p-3">
                <div className="flex flex-wrap gap-3">
                  <input
                    value={item.q}
                    onChange={(e) => updateFaqItem(i, { q: e.target.value })}
                    className={`${inputClass} min-w-[10rem] flex-1`}
                    placeholder="Question"
                  />
                  <button onClick={() => removeFaqItem(i)} className="shrink-0 px-2 text-sm font-medium text-red-600 hover:text-red-700">
                    Remove
                  </button>
                </div>
                <textarea
                  value={item.a}
                  onChange={(e) => updateFaqItem(i, { a: e.target.value })}
                  className={`${inputClass} mt-2`}
                  rows={2}
                  placeholder="Answer"
                />
              </div>
            ))}
          </div>
          <button onClick={addFaqItem} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-ink-700 hover:text-ink-950">
            <PlusIcon className="h-4 w-4" />
            Add question
          </button>
        </SectionCard>

        <SectionCard title="Footer & legal">
          <Field label="Footer tagline" htmlFor="footer-tagline">
            <input id="footer-tagline" value={content.footer.tagline} onChange={(e) => update("footer", { tagline: e.target.value })} className={inputClass} />
          </Field>
          <Field label="Terms & Conditions text" htmlFor="legal-terms">
            <textarea id="legal-terms" rows={5} value={content.legal.terms} onChange={(e) => update("legal", { ...content.legal, terms: e.target.value })} className={inputClass} />
          </Field>
          <Field label="Privacy Policy text" htmlFor="legal-privacy">
            <textarea id="legal-privacy" rows={5} value={content.legal.privacy} onChange={(e) => update("legal", { ...content.legal, privacy: e.target.value })} className={inputClass} />
          </Field>
        </SectionCard>
      </div>

      {error && <p className="mt-4 text-sm font-medium text-red-600">{error}</p>}

      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-ink-900/8 bg-white/95 px-5 py-3 backdrop-blur md:pl-56">
        <div className="mx-auto flex max-w-4xl items-center justify-end gap-3">
          {saved && (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600">
              <CheckIcon className="h-4 w-4" />
              Saved
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full rounded-full bg-ink-950 px-5 py-2.5 text-sm font-semibold text-paper-50 transition hover:bg-ink-900 disabled:opacity-60 sm:w-auto"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
