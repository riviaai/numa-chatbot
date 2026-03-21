import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3456",
    headless: true,
  },
  webServer: {
    command: "node ../server.js",
    port: 3456,
    reuseExistingServer: true,
    timeout: 15_000,
  },
});
