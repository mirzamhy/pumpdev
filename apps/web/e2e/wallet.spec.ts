import { expect, test } from "@playwright/test";
import { DEV, MINT, sampleWallet } from "./fixtures";

test("shows the developer cluster: label, stats, graph and merged launches", async ({ page }) => {
  await page.route(`**/api/wallet/${DEV}`, (route) => route.fulfill({ json: sampleWallet }));
  await page.goto(`/wallet/${DEV}`);
  await expect(page.getByRole("heading", { name: "Rugger pattern" })).toBeVisible();
  await expect(page.getByText("2 of 2 launches died with the dev exiting.")).toBeVisible();
  await expect(page.getByText("Launches known")).toBeVisible();
  await expect(page.getByRole("group", { name: /Wallet graph: 1 funders, 1 wallets with the same funder, 1 repeat early buyers, 2 launches/ })).toBeVisible();
  const table = page.getByRole("table");
  await expect(table.getByRole("link", { name: /\$TEST/ })).toHaveAttribute("href", `/token/${MINT}`);
  await expect(table.getByText("recycled socials")).toBeVisible();
  await expect(table.getByText("dead, dev exited")).toBeVisible();
  await expect(page.getByRole("link", { name: /Same funder/ }).first()).toBeVisible();
});

test("explains an unknown wallet", async ({ page }) => {
  await page.route(`**/api/wallet/${DEV}`, (route) =>
    route.fulfill({ json: { ...sampleWallet, known: false, deployed: [], feedLaunches: [], chain: [], archetype: { kind: "unclear", evidence: [] } } }),
  );
  await page.goto(`/wallet/${DEV}`);
  await expect(page.getByText(/hasn't appeared in any trace or in the live feed/)).toBeVisible();
});
