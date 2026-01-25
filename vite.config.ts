import { defineConfig } from "vite";

// Use relative asset paths so the built game can be served from subfolders like `/test/`.
export default defineConfig({
  base: "./"
});

