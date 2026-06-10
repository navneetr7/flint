import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      "@flint/domain": new URL("../../packages/domain/src/index.ts", import.meta.url).pathname,
      "@flint/ui": new URL("../../packages/ui/src/index.ts", import.meta.url).pathname,
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  clearScreen: false,
});
