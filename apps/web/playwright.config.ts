import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:5179" },
  webServer: {
    // Own port: 5173 is the dev server (live API behind it) and 5174 is often taken by other local projects.
    command: "pnpm exec vite --port 5179 --strictPort",
    url: "http://localhost:5179",
    reuseExistingServer: false,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
