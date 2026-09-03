import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Status palette. Deliberately high-contrast: the /display screen is
        // read from across a room, often at an angle, sometimes in daylight.
        waiting: {
          DEFAULT: "#b91c1c",
          soft: "#fef2f2",
          border: "#fecaca",
        },
        arrived: {
          DEFAULT: "#15803d",
          soft: "#f0fdf4",
          border: "#bbf7d0",
        },
      },
      keyframes: {
        "arrival-flash": {
          "0%, 100%": { transform: "scale(1)", filter: "brightness(1)" },
          "20%": { transform: "scale(1.06)", filter: "brightness(1.35)" },
          "60%": { transform: "scale(1.02)", filter: "brightness(1.15)" },
        },
      },
      animation: {
        "arrival-flash": "arrival-flash 1.6s ease-in-out 2",
      },
    },
  },
  plugins: [],
};

export default config;
