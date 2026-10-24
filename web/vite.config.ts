import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { fileURLToPath } from "node:url";

// The SDK lives outside this package; make the polyfill shims resolvable from there too.
const shim = (n: string) => fileURLToPath(new URL(`./node_modules/vite-plugin-node-polyfills/shims/${n}`, import.meta.url));

export default defineConfig({
  plugins: [react(), nodePolyfills({ include: ["buffer", "crypto", "stream", "util", "process"], globals: { Buffer: true, process: true } })],
  define: { "process.env": {} },
  resolve: {
    alias: {
      "vite-plugin-node-polyfills/shims/buffer": shim("buffer"),
      "vite-plugin-node-polyfills/shims/global": shim("global"),
      "vite-plugin-node-polyfills/shims/process": shim("process"),
    },
  },
  server: { port: 5173, proxy: { "/api": "http://localhost:8787", "/uploads": "http://localhost:8787", "/ws": { target: "ws://localhost:8787", ws: true } } },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
});
