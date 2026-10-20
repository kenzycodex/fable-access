import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// The homepage hero fits the first screen on common laptop and desktop sizes:
// the badge, the headline and the "Open The Sandbox" button are all visible
// without scrolling. On a phone and a tablet it never scrolls sideways.
// Screenshots land in test-results/hero for review.
const SHOTS = "test-results/hero";
mkdirSync(SHOTS, { recursive: true });

async function hero(page: Page) {
  await page.goto("/");
  // A first visit shows the cookie banner over the bottom of the screen; the
  // hero is measured as a visitor sees it once they have answered it.
  const reject = page.getByRole("button", { name: "Reject" });
  if (await reject.isVisible().catch(() => false)) await reject.click();
  const badge = page.getByTestId("hero-badge");
  const headline = page.getByRole("heading", { level: 1, name: /Stop Fraud Fast\.\s*Three AI Agents\./ });
  // The navbar has an "Open the Sandbox" link too; the hero button is the one in main.
  const button = page.getByRole("main").getByRole("link", { name: "Open The Sandbox" });
  for (const part of [badge, headline, button]) await expect(part).toBeVisible();
  // Let the reveal animations finish before measuring.
  await page.waitForTimeout(1200);
  return { badge, headline, button };
}

for (const [width, height] of [[1366, 768], [1440, 900], [1536, 864], [1920, 1080]] as const) {
  test(`the hero fits the first screen at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const parts = await hero(page);
    for (const [name, part] of Object.entries(parts)) {
      const box = await part.boundingBox();
      expect(box, `${name} has a box`).not.toBeNull();
      expect(box!.y, `${name} starts on screen`).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height, `${name} ends inside the first screen`).toBeLessThanOrEqual(height);
    }
    await page.screenshot({ path: `${SHOTS}/hero-${width}x${height}.png` });
  });
}

for (const [width, height] of [[360, 780], [768, 1024]] as const) {
  test(`the hero has no sideways scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const { headline, button } = await hero(page);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(wide, "sideways scroll").toBeLessThanOrEqual(1);
    for (const part of [headline, button]) {
      const box = (await part.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    await page.screenshot({ path: `${SHOTS}/hero-${width}px.png` });
  });
}
