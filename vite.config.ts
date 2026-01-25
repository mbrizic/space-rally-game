import { defineConfig } from "vite";

// Use relative asset paths so the built game can be served from subfolders like `/test/`.
export default defineConfig({
  base: "./",
  // Local testing: proxy signaling endpoints to the Bun server (run on :8787).
  // Production should be handled by nginx `/api` proxying.
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        ws: true
      }
    }
  }
});
