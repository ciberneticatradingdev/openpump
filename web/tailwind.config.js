/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#e5fdf0",
        panel: "#ffffff",
        panel2: "#f3fdf8",
        line: "rgba(2,65,48,0.10)",
        line2: "rgba(2,65,48,0.18)",
        ink: "#024130",
        mute: "rgba(2,65,48,0.62)",
        dim: "rgba(2,65,48,0.40)",
        acc: "#02b874",
        acc2: "#02d086",
        red: "#e0245e",
        gold: "#b7791f",
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"], head: ["Outfit", "Inter", "sans-serif"] },
      borderRadius: { xl2: "16px", xl3: "20px" },
      boxShadow: { dock: "0 10px 30px rgba(2,65,48,0.12), 0 1px 2px rgba(2,65,48,0.06)", glow: "0 0 0 1px rgba(2,208,134,0.35), 0 8px 24px rgba(2,208,134,0.18)" },
    },
  },
  plugins: [],
};
