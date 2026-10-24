import { expect, test, type Page } from "@playwright/test";
import { BANK, signInOperator } from "./helpers";

// Every operator page opens for a platform owner without a script error or an
// error screen, at desktop and at phone width.
const PAGES = ["", "/institutions", `/institutions/${BANK}`, "/institutions/new", "/engine", "/secrets", "/integrations",
  "/assistant", "/team", "/audit", "/account"];

async function walk(page: Page, label: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
  await signInOperator(page);
  for (const p of PAGES) {
    await page.goto(`/operator${p}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading").first(), `${label} ${p}`).toBeVisible();
    await expect(page.getByText(/Something went wrong|Application error/i), `${label} ${p}`).toHaveCount(0);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(wide, `${label} ${p} scrolls sideways`).toBeLessThanOrEqual(1);
  }
  expect(errors).toEqual([]);
}

test("every operator page opens cleanly on a desktop", async ({ page }) => {
  await walk(page, "desktop");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
  test("every operator page opens cleanly on a phone", async ({ page }) => {
    await walk(page, "phone");
  });
});
