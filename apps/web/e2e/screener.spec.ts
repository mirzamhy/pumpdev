import { expect, test, type Page } from "@playwright/test";
import { MINT, sampleFeed, sampleResult } from "./fixtures";

async function mockApi(page: Page) {
  const feedUrls: string[] = [];
  await page.route("**/api/recent", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/trace", (route) => route.fulfill({ json: { cached: true, result: sampleResult } }));
  await page.route("**/api/feed?*", (route) => {
    feedUrls.push(route.request().url());
    return route.fulfill({ json: sampleFeed });
  });
  return feedUrls;
}

test("lists live tokens with scores, trace state and flags", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Screener", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Live screener" })).toBeVisible();

  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("$TEST");
  await expect(rows.nth(0)).toContainText("82");
  await expect(rows.nth(0)).toContainText("auto");
  await expect(rows.nth(1)).toContainText("queued");
  await expect(rows.nth(2)).toContainText("copycat ×3");
  await expect(rows.nth(2)).toContainText("dumped");
  await expect(rows.nth(2)).toContainText("–");
  await expect(page.getByText("1200 new tokens in the last hour")).toBeVisible();
  await expect(page.getByText("50% of traced scored high risk")).toBeVisible();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
});

test("switches tabs and filters", async ({ page }) => {
  const feedUrls = await mockApi(page);
  await page.goto("/screener");
  await expect(page.locator("tbody tr")).toHaveCount(3);
  await page.getByRole("tab", { name: "Hot" }).click();
  await expect(page.getByRole("tab", { name: "Hot" })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => feedUrls.some((u) => u.includes("tab=hot"))).toBe(true);
  await page.getByLabel("Hide high risk").check();
  await expect.poll(() => feedUrls.some((u) => u.includes("tab=hot") && u.includes("hideHigh=1"))).toBe(true);
});

test("opens a token from its row", async ({ page }) => {
  await mockApi(page);
  await page.goto("/screener");
  await page.locator("tbody tr").first().locator("td").nth(2).click();
  await expect(page).toHaveURL(new RegExp(`/token/${MINT}$`));
  await expect(page.getByRole("heading", { name: /Test Coin/ })).toBeVisible();
});

test("explains an empty traced tab", async ({ page }) => {
  await page.route("**/api/feed?*", (route) => route.fulfill({ json: { items: [], stats: { ...sampleFeed.stats, highRiskShare: null } } }));
  await page.goto("/screener");
  await page.getByRole("tab", { name: "Traced" }).click();
  await expect(page.getByText(/Nothing traced yet/)).toBeVisible();
});

test("shows cards on a phone", async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/screener");
  await expect(page.getByRole("list", { name: "New tokens" }).getByRole("listitem")).toHaveCount(3);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
