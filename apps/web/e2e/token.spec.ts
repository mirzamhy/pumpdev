import { expect, test, type Page } from "@playwright/test";
import { MINT, sampleResult } from "./fixtures";

async function mockApi(page: Page) {
  await page.route("**/api/recent", (route) => route.fulfill({ json: [] }));
  await page.route("https://api.geckoterminal.com/**", (route) => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/trace", (route) => route.fulfill({ json: { cached: true, result: sampleResult } }));
}

test("search leads to a scored token page with the funding graph", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await page.getByLabel("Token or wallet address").fill(MINT);
  await page.getByRole("button", { name: "Trace", exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`/token/${MINT}$`));
  await expect(page.getByRole("heading", { name: /Test Coin/ })).toBeVisible();
  await expect(page.getByText("50", { exact: true })).toBeVisible();
  await expect(page.getByText("Dev has sold or moved 70% of their tokens.")).toBeVisible();
  await expect(page.locator(".react-flow")).toBeVisible();
  await expect(page.getByText("Dev (deployer)").first()).toBeVisible();
});

test("shows holders with a bubble map, clusters and flags", async ({ page }) => {
  await mockApi(page);
  await page.goto(`/token/${MINT}`);
  await expect(page.getByRole("heading", { name: "Holders" })).toBeVisible();
  await expect(page.getByText("214")).toBeVisible();
  await expect(page.getByRole("img", { name: /Bubble map of the top 4 holders; 1 cluster/ })).toBeVisible();
  await expect(page.getByText("Cluster 1: 2 wallets hold 11.0%")).toBeVisible();
  await expect(page.getByText("bundle", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("launch block", { exact: true })).toBeVisible();
});

test("rejects an invalid address inline", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await page.getByLabel("Token or wallet address").fill("hello");
  await page.getByRole("button", { name: "Trace", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("That doesn't look like a Solana address.");
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("shows the timeline instead of the graph", async ({ page }) => {
    await mockApi(page);
    await page.goto(`/token/${MINT}`);
    await expect(page.getByRole("button", { name: /Dev \(deployer\)/ })).toBeVisible();
    await expect(page.locator(".react-flow")).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
});
