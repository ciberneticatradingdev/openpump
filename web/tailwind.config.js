/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#050806",
        panel: "rgba(255,255,255,0.035)",
        panel2: "rgba(255,255,255,0.06)",
        line: "rgba(255,255,255,0.07)",
        line2: "rgba(255,255,255,0.12)",
        ink: "#ecf2ed",
        mute: "rgba(236,242,237,0.55)",
        dim: "rgba(236,242,237,0.32)",
        acc: "#79ff77",
        acc2: "#4cd964",
        red: "#ff5c7a",
        gold: "#ffd166",
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"], head: ["Poppins", "Inter", "sans-serif"] },
      borderRadius: { xl2: "16px", xl3: "20px" },
      boxShadow: { dock: "0 16px 48px rgba(0,0,0,0.45)", glow: "0 0 0 1px rgba(121,255,119,0.25), 0 8px 32px rgba(121,255,119,0.12)" },
    },
  },
  plugins: [],
};
