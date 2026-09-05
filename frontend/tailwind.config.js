/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "../features/*/frontend/**/*.{js,ts,jsx,tsx}",
    "../shared/frontend-core/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Every shade below is a CSS variable set at runtime by
      // shared/frontend-core/theme/applyBrand.ts from brand.config.ts —
      // see that file to reskin the app for a new client. The
      // `rgb(var(...) / <alpha-value>)` form is Tailwind's documented
      // pattern for CSS-variable colors that still support opacity
      // modifiers (bg-ink-950/50, border-ink-900/8, etc., used
      // throughout this codebase).
      colors: {
        ink: {
          950: "rgb(var(--color-ink-950) / <alpha-value>)",
          900: "rgb(var(--color-ink-900) / <alpha-value>)",
          700: "rgb(var(--color-ink-700) / <alpha-value>)",
          500: "rgb(var(--color-ink-500) / <alpha-value>)",
          300: "rgb(var(--color-ink-300) / <alpha-value>)",
        },
        paper: {
          50: "rgb(var(--color-paper-50) / <alpha-value>)",
          100: "rgb(var(--color-paper-100) / <alpha-value>)",
        },
        amber: {
          400: "rgb(var(--color-amber-400) / <alpha-value>)",
          500: "rgb(var(--color-amber-500) / <alpha-value>)",
          600: "rgb(var(--color-amber-600) / <alpha-value>)",
        },
      },
      fontFamily: {
        display: "var(--font-display)",
        body: "var(--font-body)",
        mono: "var(--font-mono)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
      },
      borderRadius: {
        xl2: "var(--radius-xl2)",
      },
    },
  },
  plugins: [],
};
