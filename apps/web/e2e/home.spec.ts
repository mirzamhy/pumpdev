import { expect, test, type Page } from "@playwright/test";
import { DEV, MINT, sampleFeed, sampleResult } from "./fixtures";

const recentRow = (score: number) => ({ mint: MINT, name: "Test Coin", symbol: "TEST", score, level: score >= 60 ? "high" : "medium", finishedAt: 1_760_000_100 });

async function mockApi(page: Page, score: number) {
  await page.route("**/api/recent", (route) => route.fulfill({ json: [recentRow(score)] }));
  await page.route("**/api/feed?*", (route) => route.fulfill({ json: sampleFeed }));
  await page.route(`**/api/token/${MINT}`, (route) => route.fulfill({ json: { ...sampleResult, score: { ...sampleResult.score, score } } }));
}

test("explains a trace with a real high-score example", async ({ page }) => {
  await mockApi(page, 75);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Know the dev\s*before the next launch\./);
  const how = page.locator("#how");
  await expect(how.getByText("Real example:")).toContainText("$TEST");
  await expect(how.locator(`a[href="/wallet/${DEV}"]`)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Runner" })).toBeVisible();
  await expect(page.getByText("Patterns are signals, not verdicts.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Live now" }).getByText("$KOREAN")).toBeVisible();
});

test("shows no example addresses when nothing scored high", async ({ page }) => {
  await mockApi(page, 40);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "How a trace works" })).toBeVisible();
  await expect(page.locator("#how").getByText("Real example:")).toHaveCount(0);
  await expect(page.locator('#how a[href^="/wallet/"]')).toHaveCount(0);
});

test("the closing button focuses the search box and search navigates", async ({ page }) => {
  await mockApi(page, 40);
  await page.route("**/api/trace", (route) => route.fulfill({ json: { cached: true, result: sampleResult } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Trace a token" }).click();
  await expect(page.getByLabel("Token or wallet address")).toBeFocused();
  await page.getByLabel("Token or wallet address").fill(MINT);
  await page.getByRole("button", { name: "Trace", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/token/${MINT}$`));
});

test("fits a phone without sideways scrolling", async ({ page }) => {
  await mockApi(page, 75);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.locator("#how").getByText("Real example:")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
