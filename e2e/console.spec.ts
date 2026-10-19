import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

// Every console page opens for an owner without a script error or an error
// screen, at desktop and at phone width.
const PAGES = [
  "", "/review", "/transactions", "/customers", "/alerts", "/agents", "/agents/copilot", "/agents/shield",
  "/agents/ghost", "/intelligence", "/compliance", "/report", "/settings", "/settings/branding", "/settings/data",
  "/settings/developers", "/settings/go-live", "/settings/policy", "/settings/security", "/settings/team",
];

async function walk(page: Page, label: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
  await signIn(page, "owner", "/dashboard");
  await page.waitForURL(/\/dashboard\/?$/);
  for (const path of PAGES) {
    await page.goto(`/dashboard${path}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading").first(), `${label} ${path}`).toBeVisible();
    await expect(page.getByText(/Something went wrong|Application error/i), `${label} ${path}`).toHaveCount(0);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(wide, `${label} ${path} scrolls sideways`).toBeLessThanOrEqual(1);
  }
  expect(errors).toEqual([]);
}

test("every console page opens cleanly on a desktop", async ({ page }) => {
  await walk(page, "desktop");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
  test("every console page opens cleanly on a phone", async ({ page }) => {
    await walk(page, "phone");
  });
});

test("an owner sees the data-rights card on a customer, and erasing needs the reference", async ({ page }) => {
  await signIn(page, "owner", "/dashboard/customers");
  await page.waitForURL(/\/dashboard\/customers/);
  await page.locator("tr", { hasText: "e2e-mobile" }).first().click();
  await page.waitForURL(/\/dashboard\/customers\/.+/);
  await expect(page.getByText("Their data")).toBeVisible();
  await page.getByRole("button", { name: "Erase this customer" }).click();
  await page.getByLabel("Customer reference").fill("not-the-reference");
  await page.getByRole("button", { name: "Erase", exact: true }).click();
  await expect(page.getByText(/Type the customer's reference exactly/)).toBeVisible();
});
