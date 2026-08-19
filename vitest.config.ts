// Component tests need a real DOM and a JSX transform, which the scheduled
// worker build in vite.config.ts cannot provide: that config loads the
// Cloudflare plugin and builds a worker bundle. This config is deliberately
// minimal so `vitest run` never boots workerd.
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    environment: "jsdom",
    include: ["tests/ui/**/*.test.tsx"],
    globals: false,
    restoreMocks: true,
  },
});
