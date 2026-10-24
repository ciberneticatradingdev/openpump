import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [react(), nodePolyfills({ include: ["buffer", "crypto", "stream", "util", "process"], globals: { Buffer: true, process: true } })],
  define: { "process.env": {} },
  server: { port: 5173, proxy: { "/api": "http://localhost:8787", "/uploads": "http://localhost:8787", "/ws": { target: "ws://localhost:8787", ws: true } } },
  build: { target: "es2022" },
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
});
