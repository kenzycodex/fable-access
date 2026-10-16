import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Browser end-to-end tests (e2e/). They start their own API on a throwaway
// database and their own Next dev server, so they never touch real data.
//
//   pnpm exec playwright install chromium   # once
//   pnpm test:e2e
const API_PORT = process.env.E2E_API_PORT ?? "8766";
const WEB_PORT = process.env.E2E_WEB_PORT ?? "3101";
const DB = process.env.FABLE_E2E_DB ?? path.join(os.tmpdir(), "fable-e2e.db");
process.env.FABLE_E2E_DB = DB;

const apiEnv = {
  ...process.env,
  FABLE_DB_PATH: DB,
  E2E_API_PORT: API_PORT,
  ENVIRONMENT: "development",
  FABLE_SESSION_SECRET: "e2e-session-secret",
  FABLE_RATE_LIMIT_MAX: "100000",
  // No real mail, SMS or AI provider: the sandbox inbox carries the codes.
  SMTP_USERNAME: "",
  SMTP_PASSWORD: "",
  ANTHROPIC_API_KEY: "",
  OPENAI_API_KEY: "",
  WEBAUTHN_RP_ID: "localhost",
  WEBAUTHN_ORIGINS: `http://localhost:${WEB_PORT}`,
  FABLE_CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command: "node e2e/start-api.mjs",
      url: `http://localhost:${API_PORT}/health`,
      env: apiEnv as Record<string, string>,
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: `pnpm exec next dev -p ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/dashboard/login`,
      env: { ...process.env, NEXT_PUBLIC_FABLE_API_URL: `http://localhost:${API_PORT}`, PAYSTACK_SECRET_KEY: "" } as Record<string, string>,
      timeout: 240_000,
      reuseExistingServer: false,
    },
  ],
});
