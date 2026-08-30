import type { SiteContent } from "../../../shared/frontend-core/types/index";

// Shown until the admin saves their own version via the Admin Panel's
// "Site Content" section. Once they save, this is never used again for
// their site — the site_content DB row takes over entirely.
export const DEFAULT_SITE_CONTENT: SiteContent = {
  hero: {
    badge: "NEW CONTENT, EVERY WEEK",
    titleLine1: "Watch, read, and learn",
    titleLine2: "on your schedule.",
    subtitle:
      "Coursewell delivers videos, PDFs, and posts straight from your favorite courses — no rigid lesson plans, just fresh content unlocked by your plan.",
    primaryCtaLabel: "Explore courses",
    secondaryCtaLabel: "View plans",
  },
  courseShowcase: {
    eyebrow: "Courses",
    title: "Pick a course, unlock everything in it",
  },
  features: {
    eyebrow: "Features",
    title: "Built for content, not checklists",
    items: [
      { glyph: "▶", title: "Video learning", desc: "Stream lessons on any device, with progress that picks up right where you left off." },
      { glyph: "▤", title: "PDF resources", desc: "Read notes and guides in a protected viewer — nothing gets exposed to the open web." },
      { glyph: "◆", title: "Visual posts", desc: "Quick, scrollable updates for the moments a full video or PDF isn't needed." },
      { glyph: "◈", title: "Secure access", desc: "Every piece of content is checked against your plan on the server, every time." },
      { glyph: "▣", title: "Progress tracking", desc: "See what you've watched, read, and viewed — without any lesson checklists." },
      { glyph: "✦", title: "Flexible plans", desc: "Upgrade, downgrade, or cancel any time. Your access updates instantly." },
    ],
  },
  plansSection: {
    eyebrow: "Plans",
    title: "Choose how much you want to unlock",
  },
  faq: {
    eyebrow: "FAQ",
    title: "Common questions",
    items: [
      { q: "Is this a course with fixed lessons?", a: "No. Content — videos, PDFs, and posts — is published on an ongoing basis inside each course. You consume it in any order, whenever your plan gives you access." },
      { q: "What happens if I downgrade my plan?", a: "You keep access to anything included in your new plan immediately. Content tied only to your previous plan becomes inaccessible until you upgrade again." },
      { q: "Can I access content before it's published?", a: "No. Scheduled content only becomes available at its publish time, and this is enforced on the server — not just hidden in the interface." },
      { q: "Are PDFs downloadable?", a: "PDFs open in a protected in-app viewer. There's no public link to the raw file, so it can't be shared or indexed outside your account." },
    ],
  },
  footer: {
    tagline: "Content-driven learning, delivered on your schedule.",
  },
  legal: {
    terms:
      "Replace this placeholder with your actual terms of service before launch. Cover acceptable use, subscription billing and cancellation, content licensing, and account termination.",
    privacy:
      "Replace this placeholder with your actual privacy policy before launch. Cover what data you collect, how progress and account data is stored, and how users can request deletion.",
  },
};
