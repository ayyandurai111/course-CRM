// ---------------------------------------------------------------------
// brand.config.ts — THE single file to edit when reselling this app to
// a new client: font, size, color, and brand copy all live here.
//
// Nothing else needs to change. This is applied at startup (see
// applyBrand.ts, called once from main.tsx) by turning every value
// below into a CSS custom property on <html>. tailwind.config.js's
// colors / fontFamily / borderRadius / boxShadow all read from those
// same variables instead of hardcoded values, so every existing
// `bg-ink-950`, `font-display`, `rounded-xl2`, etc. class across the
// whole codebase repaints automatically — no component files, and no
// Tailwind config, need to be touched per client.
//
// To onboard a new client: duplicate this file's *values* (keep the
// shape/keys identical) and point main.tsx's import at the new file —
// or just edit the values below directly for a single-tenant deploy.
// ---------------------------------------------------------------------

export interface BrandConfig {
  /** Short product name — header logos, browser tab title, login card. */
  name: string;
  /** Shown next to the name in the browser tab title. */
  tagline: string;
  /** Used in copy like "By continuing you agree to {legalName}'s Terms". */
  legalName: string;

  colors: {
    // Primary dark/neutral scale — text, headers, dark surfaces.
    ink: { 300: string; 500: string; 700: string; 900: string; 950: string };
    // Light background scale.
    paper: { 50: string; 100: string };
    // Accent color — buttons, highlights, live/warning indicators.
    amber: { 400: string; 500: string; 600: string };
  };

  fonts: {
    // Full CSS font-family values (with fallback), e.g. "'Lexend', sans-serif".
    display: string;
    body: string;
    mono: string;
    // Google Fonts stylesheet URL matching the three families above.
    // Swap this together with the family names when changing fonts —
    // applyBrand.ts loads it automatically, no index.html edit needed.
    googleFontsUrl: string;
  };

  /** Overall UI scale in pixels. 16 = normal browser default. */
  baseFontSizePx: number;

  radius: { xl2: string };
  shadow: { card: string };
}

export const brand: BrandConfig = {
  name: "Coursewell",
  tagline: "Course Content Platform",
  legalName: "Coursewell",

  colors: {
    ink: {
      300: "#9AA2C4",
      500: "#545E8C",
      700: "#2C3457",
      900: "#161C33",
      950: "#0F1424",
    },
    paper: {
      50: "#F7F8FB",
      100: "#EFF1F7",
    },
    amber: {
      400: "#E8A23D",
      500: "#D98D22",
      600: "#B5721A",
    },
  },

  fonts: {
    display: "'Lexend', sans-serif",
    body: "'Inter', sans-serif",
    mono: "'JetBrains Mono', monospace",
    googleFontsUrl:
      "https://fonts.googleapis.com/css2?family=Lexend:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap",
  },

  baseFontSizePx: 16,

  radius: { xl2: "1.25rem" },
  shadow: { card: "0 1px 2px rgba(15,20,36,0.04), 0 8px 24px -12px rgba(15,20,36,0.12)" },
};
