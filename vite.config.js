import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "public",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "public/index.html"),
        overlay: resolve(import.meta.dirname, "public/overlay.html"),
      },
    },
  },
  server: {
    port: 1421,
    strictPort: true,
  },
});
