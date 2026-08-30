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
      colors: {
        ink: {
          950: "#0F1424",
          900: "#161C33",
          700: "#2C3457",
          500: "#545E8C",
          300: "#9AA2C4",
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
      fontFamily: {
        display: ["'Lexend'", "sans-serif"],
        body: ["'Inter'", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,20,36,0.04), 0 8px 24px -12px rgba(15,20,36,0.12)",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
    },
  },
  plugins: [],
};
