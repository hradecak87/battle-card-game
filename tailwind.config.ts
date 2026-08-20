import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
      keyframes: {
        // Battle-highlight border blink: unlike Tailwind's built-in
        // `animate-pulse` (which only dims to 50% opacity), this fades all
        // the way to fully transparent so the tile's underlying ownership
        // border color is briefly, unambiguously visible, then holds at
        // zero for a beat before ramping back up.
        "battle-blink": {
          "0%, 100%": { opacity: "1" },
          "35%": { opacity: "0" },
          "60%": { opacity: "0" },
        },
      },
      animation: {
        "battle-blink": "battle-blink 4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
