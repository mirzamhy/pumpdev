import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:5174" },
  webServer: {
    // Separate port so a running dev server on 5173 does not get reused with a live API behind it.
    command: "pnpm exec vite --port 5174 --strictPort",
    url: "http://localhost:5174",
    reuseExistingServer: false,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
