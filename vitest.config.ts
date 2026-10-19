import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit and component tests (src/**/*.test.ts[x]). Browser flows are in e2e/
// (Playwright).
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
