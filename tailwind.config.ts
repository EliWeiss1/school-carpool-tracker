import type { Config } from "tailwindcss";

/**
 * "Curbside" — the design system for the whole app. See the Design system
 * section of CLAUDE.md for the rules that govern how these tokens are used.
 *
 * The one hard constraint everything else bends around: red and green mean
 * "waiting" and "arrived" and nothing else, on any screen. So the brand colour
 * is marigold — the school bus, the crossing-guard vest, the paint on the
 * pickup lane — which is unmistakable against both at twenty feet.
 */
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Status palette. Deliberately high-contrast: the /display screen is
        // read from across a room, often at an angle, sometimes in daylight.
        //
        // `DEFAULT`/`soft`/`border` are the light-surface set used by /announce
        // and /admin. `screen` is the only pair used on /display, which sits on
        // an ink ground where the darker values disappear.
        waiting: {
          DEFAULT: "#b91c1c",
          soft: "#fef2f2",
          border: "#fecaca",
          screen: "#f04438",
          deep: "#7f1d1d",
        },
        arrived: {
          DEFAULT: "#15803d",
          soft: "#f0fdf4",
          border: "#bbf7d0",
          screen: "#12b76a",
          deep: "#14532d",
        },

        /** Brand. Chrome, accents and focus only — never a status fill. */
        marigold: {
          50: "#fff7e6",
          100: "#ffedc4",
          300: "#ffd98a",
          400: "#ffc24d",
          500: "#f5a524",
          600: "#d9860b",
          700: "#a86407",
        },

        /** Neutral ramp. Concrete, not blue-grey: warm enough to sit under marigold. */
        curb: {
          50: "#f6f7f9",
          100: "#eceef2",
          200: "#dde1e8",
          300: "#c3cad5",
          400: "#98a2b3",
          500: "#6b7686",
          600: "#4c5666",
          700: "#353d4a",
          800: "#232a34",
          900: "#10151f",
        },

        /** The /display ground. Asphalt at dusk. */
        ink: "#10151f",
      },

      fontFamily: {
        // Wired up in layout.tsx via next/font. The fallbacks are real: if the
        // font request fails the app must still be legible outdoors.
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },

      letterSpacing: {
        // -0.03em on anything set at text-4xl or larger. Archivo opens up at
        // display sizes and looks slack without it.
        display: "-0.03em",
        // Eyebrows and small caps labels.
        eyebrow: "0.14em",
      },

      boxShadow: {
        // Layered and ink-tinted, never neutral black. Three elevation levels
        // and nothing in between — see CLAUDE.md.
        card: "0 1px 2px -1px rgb(16 21 31 / 0.08), 0 2px 8px -2px rgb(16 21 31 / 0.06)",
        float:
          "0 2px 4px -2px rgb(16 21 31 / 0.10), 0 12px 28px -8px rgb(16 21 31 / 0.18)",
        press: "inset 0 2px 4px rgb(16 21 31 / 0.14)",
        // /display only: the tile lifts off the ink ground with its own colour.
        "tile-waiting":
          "0 1px 0 0 rgb(255 255 255 / 0.06) inset, 0 8px 24px -12px rgb(240 68 56 / 0.55)",
        "tile-arrived":
          "0 1px 0 0 rgb(255 255 255 / 0.06) inset, 0 8px 32px -10px rgb(18 183 106 / 0.65)",
      },

      transitionTimingFunction: {
        // Spring for anything a finger touches; ease-out for everything else.
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
        exit: "cubic-bezier(0.4, 0, 1, 1)",
      },

      keyframes: {
        // transform and opacity only. `filter: brightness()` was cheaper to
        // write but forces a repaint on a wall-mounted TV that is often driven
        // by a very slow stick PC — the glow is an opacity layer instead.
        "arrival-flash": {
          "0%, 100%": { transform: "scale(1)" },
          "18%": { transform: "scale(1.055)" },
          "45%": { transform: "scale(0.995)" },
          "70%": { transform: "scale(1.015)" },
        },
        "arrival-glow": {
          "0%, 100%": { opacity: "0" },
          "15%": { opacity: "0.85" },
          "60%": { opacity: "0.25" },
        },
        // Push-to-talk. A ring that expands and fades out of the button, so
        // "the app is listening" is legible from arm's length in sunlight.
        "listen-pulse": {
          "0%": { transform: "scale(1)", opacity: "0.55" },
          "100%": { transform: "scale(1.9)", opacity: "0" },
        },
        // The signature hazard band. An over-wide striped track slid sideways
        // inside an overflow-hidden rule: pure transform, no background-position.
        "hazard-slide": {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-33.333%)" },
        },
        "tile-in": {
          "0%": { transform: "translateY(6px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },

      animation: {
        "arrival-flash": "arrival-flash 1.6s cubic-bezier(0.34,1.56,0.64,1) 2",
        "arrival-glow": "arrival-glow 1.6s ease-out 2",
        "listen-pulse": "listen-pulse 1.5s ease-out infinite",
        "hazard-slide": "hazard-slide 1.2s linear infinite",
        "tile-in": "tile-in 0.3s ease-out both",
      },

      // The spacing ladder. Only these steps appear in the app.
      // 1(4) 2(8) 3(12) 4(16) 6(24) 8(32) 12(48) 16(64) 24(96)
      minHeight: {
        tap: "3.5rem", // 56px — the smallest interactive thing anywhere
        "tap-lg": "4rem", // 64px — every control on /announce
        candidate: "6rem", // 96px — a candidate tap target, gloved and one-handed
      },
    },
  },
  plugins: [],
};

export default config;
