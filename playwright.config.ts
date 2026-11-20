import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const testDb = process.env.TEST_DATABASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  // Resets, migrates and seeds the TEST database before the server starts serving.
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, trace: "off" },
  // Admin specs write to the catalogue (Journeys D and E create products), so they run after the
  // public specs, which assert exact counts on the seeded data.
  projects: [
    {
      name: "desktop",
      testIgnore: /journey-[de]\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    { name: "mobile", testIgnore: /journey-[de]\.spec\.ts/, use: { ...devices["Pixel 7"] } },
    {
      name: "admin-desktop",
      testMatch: /journey-[de]\.spec\.ts/,
      dependencies: ["desktop", "mobile"],
      // Separate login rate-limit buckets per project (the limiter keys on address + email).
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        extraHTTPHeaders: { "x-forwarded-for": "192.0.2.10" },
      },
    },
    {
      name: "admin-mobile",
      testMatch: /journey-[de]\.spec\.ts/,
      dependencies: ["desktop", "mobile"],
      use: { ...devices["Pixel 7"], extraHTTPHeaders: { "x-forwarded-for": "192.0.2.11" } },
    },
  ],
  webServer: {
    command: `pnpm build && pnpm start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      DATABASE_URL: testDb ?? "",
      ENABLE_DEMO_DATA: "true",
      NODE_ENV: "production",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-test-secret-not-for-production-use-0000",
      STORAGE_LOCAL_DIR: "storage/e2e-uploads",
    },
  },
});
