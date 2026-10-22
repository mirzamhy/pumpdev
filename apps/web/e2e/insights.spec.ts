import { expect, test, type Page } from "@playwright/test";
import { MINT, sampleResult, sampleRisky } from "./fixtures";

async function mockTrace(page: Page, result = sampleResult) {
  await page.route("**/api/recent", (route) => route.fulfill({ json: [] }));
  await page.route("https://api.geckoterminal.com/**", (route) => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/trace", (route) => route.fulfill({ json: { cached: true, result } }));
}

test("token page shows socials with reuse warnings and dev habits", async ({ page }) => {
  await mockTrace(page);
  await page.goto(`/token/${MINT}`);
  const socials = page.locator("section", { has: page.getByRole("heading", { name: "Socials" }) });
  await expect(socials.getByText("Same website as")).toBeVisible();
  await expect(socials.getByRole("link", { name: "$OLDTEST" })).toBeVisible();
  await expect(socials.getByRole("link", { name: "Tweet by @elonmusk" })).toHaveAttribute("rel", "noopener noreferrer nofollow");
  await expect(socials.getByText("Links to a single post, not a project account")).toBeVisible();
  await expect(socials.getByText("4 other tokens link the same tweet.")).toBeVisible();

  const habits = page.locator("section", { has: page.getByRole("heading", { name: "Dev habits" }) });
  await expect(habits.getByText("6 (4 dead, 0 migrated)")).toBeVisible();
  await expect(habits.getByText("7 min")).toBeVisible();
  await expect(habits.getByText("3 of 5")).toBeVisible();
  await expect(habits.getByText("2 (0.4 SOL)")).toBeVisible();
  await expect(habits.getByText(/60 most recent transactions/)).toBeVisible();
});

test("older results without socials still render", async ({ page }) => {
  await mockTrace(page, { ...sampleResult, socials: undefined, devProfile: undefined });
  await page.goto(`/token/${MINT}`);
  await expect(page.getByText("Socials were not checked for this trace.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Test Coin/ })).toBeVisible();
});

test("never links non-web socials", async ({ page }) => {
  const socials = { ...sampleResult.socials!, website: "javascript:alert(1)", reuse: [] };
  await mockTrace(page, { ...sampleResult, socials });
  await page.goto(`/token/${MINT}`);
  await expect(page.getByText("javascript:alert(1)")).toBeVisible();
  await expect(page.locator('a[href^="javascript"]')).toHaveCount(0);
});

test("risky wallets page lists patterns with neutral copy", async ({ page }) => {
  await page.route("**/api/risky", (route) => route.fulfill({ json: sampleRisky }));
  await page.route("**/api/recent", (route) => route.fulfill({ json: [] }));
  await page.route("https://api.geckoterminal.com/**", (route) => route.fulfill({ json: { data: [] } }));
  await page.goto("/");
  await page.getByRole("link", { name: "Risky wallets" }).click();
  await expect(page.getByRole("heading", { name: "Risky wallets" })).toBeVisible();
  await expect(page.getByText("not accusations", { exact: false })).toBeVisible();
  await expect(page.getByText("12 launches died with the dev exiting, out of 15 seen")).toBeVisible();
  await expect(page.getByText("Funded 3 devs with 7 dead launches")).toBeVisible();
  await expect(page.getByText("No wallet bought early in three traced launches yet.")).toBeVisible();
  await expect(page.getByText("Launched 40 tokens")).toBeVisible();
  await page.getByRole("link", { name: "7xKX…gAsU" }).click();
  await expect(page).toHaveURL(/\/wallet\/7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU$/);
});

test("risky wallets page fits a phone", async ({ page }) => {
  await page.route("**/api/risky", (route) => route.fulfill({ json: sampleRisky }));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/risky");
  await expect(page.getByText("Launched 40 tokens")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

test("embeds the most liquid pool's chart, or explains when there is none", async ({ page }) => {
  await mockTrace(page);
  await page.route("https://api.geckoterminal.com/**", (route) =>
    route.fulfill({
      json: {
        data: [
          { attributes: { address: "GcuC4NcSyfQeiwEeHZWCdpyyE2E7t1PJ16c7xZQnJUtm", reserve_in_usd: "0.0" } },
          { attributes: { address: "5CdxX19Gd3fafA5tNJGK6XqNAb7yERRDRVDmEJJWibdy", reserve_in_usd: "2283.8" } },
          { attributes: { address: "javascript:alert(1)", reserve_in_usd: "999999" } },
        ],
      },
    }),
  );
  await page.route("https://www.geckoterminal.com/**", (route) => route.fulfill({ body: "<html><body>chart</body></html>", contentType: "text/html" }));
  await page.goto(`/token/${MINT}`);
  const frame = page.getByTitle("Market cap chart");
  await expect(frame).toHaveAttribute("src", /geckoterminal\.com\/solana\/pools\/5CdxX19Gd3fafA5tNJGK6XqNAb7yERRDRVDmEJJWibdy\?embed=1/);
  await expect(page.getByRole("link", { name: "DexScreener ↗" })).toHaveAttribute("href", `https://dexscreener.com/solana/${MINT}`);
});

test("says when GeckoTerminal has not listed the token yet", async ({ page }) => {
  await mockTrace(page);
  await page.goto(`/token/${MINT}`);
  await expect(page.getByText("GeckoTerminal has not listed this token yet.", { exact: false })).toBeVisible();
});
