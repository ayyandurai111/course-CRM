import { brand } from "./brand.config";

// Tailwind's recommended pattern for CSS-variable-driven colors that
// still support opacity modifiers (bg-ink-950/50, border-ink-900/8,
// etc. are used all over this codebase): the variable holds
// space-separated "R G B" channels, and tailwind.config.js wraps it as
// `rgb(var(--color-x) / <alpha-value>)`. So each hex value from
// brand.config.ts gets converted to that channel format here.
function hexToRgbChannels(hex: string): string {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

/**
 * Turns brand.config.ts into CSS custom properties on <html> and loads
 * the matching webfont. Call this once, before the app renders (see
 * main.tsx) — every Tailwind utility class across the app resolves
 * through these variables instead of a value baked in at build time.
 */
export function applyBrand() {
  const root = document.documentElement.style;

  for (const [shade, hex] of Object.entries(brand.colors.ink)) {
    root.setProperty(`--color-ink-${shade}`, hexToRgbChannels(hex));
  }
  for (const [shade, hex] of Object.entries(brand.colors.paper)) {
    root.setProperty(`--color-paper-${shade}`, hexToRgbChannels(hex));
  }
  for (const [shade, hex] of Object.entries(brand.colors.amber)) {
    root.setProperty(`--color-amber-${shade}`, hexToRgbChannels(hex));
  }

  root.setProperty("--font-display", brand.fonts.display);
  root.setProperty("--font-body", brand.fonts.body);
  root.setProperty("--font-mono", brand.fonts.mono);

  root.setProperty("--radius-xl2", brand.radius.xl2);
  root.setProperty("--shadow-card", brand.shadow.card);

  document.documentElement.style.fontSize = `${brand.baseFontSizePx}px`;

  // Swap the loaded Google Fonts stylesheet to match the configured
  // families, instead of a fixed one hardcoded in index.html.
  let fontLink = document.getElementById("brand-fonts") as HTMLLinkElement | null;
  if (!fontLink) {
    fontLink = document.createElement("link");
    fontLink.id = "brand-fonts";
    fontLink.rel = "stylesheet";
    document.head.appendChild(fontLink);
  }
  if (fontLink.href !== brand.fonts.googleFontsUrl) fontLink.href = brand.fonts.googleFontsUrl;

  document.title = `${brand.name} — ${brand.tagline}`;
}
