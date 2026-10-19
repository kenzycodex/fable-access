import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { BANK, asCustomer, sendTransfer } from "./helpers";

// Every sandbox screen at phone width: nothing wider than the screen, so no
// sideways scrolling. Screenshots land in test-results/mobile for review.
const PHONE = { width: 360, height: 780 };
test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

const SHOTS = "test-results/mobile";
mkdirSync(SHOTS, { recursive: true });

async function fits(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const wide = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > window.innerWidth + 1 && getComputedStyle(el).position !== "fixed";
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
    return { scroll: doc.scrollWidth, width: window.innerWidth, wide };
  });
  expect(overflow.scroll, `${name} scrolls sideways: ${overflow.wide.join(" | ")}`).toBeLessThanOrEqual(overflow.width);

  // The page can still scroll (no sheet left the body locked), and its last
  // content clears the bottom navigation once scrolled to the end.
  const end = await page.evaluate(async () => {
    const locked = getComputedStyle(document.body).overflow === "hidden" && !document.querySelector("[role=dialog]");
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 150));
    const nav = [...document.querySelectorAll("nav")].find((el) => getComputedStyle(el).position === "fixed");
    const main = document.querySelector("main");
    // The lowest visible thing on the page, wherever it sits in the markup.
    let lowest: Element | null = null;
    let bottom = 0;
    for (const el of main ? main.querySelectorAll("*") : []) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.height === 0 || style.visibility === "hidden" || style.position === "fixed") continue;
      if (el.closest("details:not([open])") && !el.closest("summary")) continue; // collapsed, not shown
      if (r.bottom > bottom) [bottom, lowest] = [r.bottom, el];
    }
    return {
      locked,
      navTop: nav ? nav.getBoundingClientRect().top : window.innerHeight,
      lastBottom: bottom,
      lowest: lowest ? `${lowest.tagName.toLowerCase()} "${(lowest.textContent ?? "").trim().slice(0, 40)}" ${String((lowest as HTMLElement).className).slice(0, 60)}` : "",
    };
  });
  expect(end.locked, `${name}: the page is scroll-locked with no dialog open`).toBe(false);
  expect(end.lastBottom, `${name}: the end of the page hides behind the bottom navigation: ${end.lowest}`).toBeLessThanOrEqual(end.navTop + 1);
}

test("every sandbox screen fits a phone", async ({ page }) => {
  await asCustomer(page, "e2e-mobile", "Grace Uche");
  await fits(page, "home");

  for (const screen of ["transfer", "history", "cards", "add-money", "notifications", "transparency"]) {
    await page.goto(`/demo/${BANK}/${screen}`);
    await fits(page, screen);
  }

  // The review sheet before sending.
  await page.goto(`/demo/${BANK}/transfer`);
  await page.getByRole("tab", { name: "New account" }).click();
  await page.getByLabel("Account number").fill("0123456781");
  const bank = page.getByLabel("Bank");
  await expect(bank.locator("option").nth(1)).toBeAttached();
  await bank.selectOption({ index: 1 });
  await expect(page.getByText(/Demo name|Verified/).first()).toBeVisible();
  await page.getByLabel("Amount in naira").fill("25000");
  await page.getByRole("button", { name: /^Send ₦/ }).click();
  await expect(page.getByRole("dialog", { name: "Check before you send" })).toBeVisible();
  await fits(page, "review-sheet");
  await page.getByRole("button", { name: "Recheck" }).click();

  // A blocked transfer: the result screen, then a Ghost hold.
  await sendTransfer(page, 1_000_000, { channel: "Web" });
  await fits(page, "result-blocked");
  await page.getByRole("button", { name: /Send anyway, with protection/ }).click();
  await page.waitForURL(/\/ghost/);
  await fits(page, "ghost");

  // A transfer's own page, from history.
  await page.goto(`/demo/${BANK}/history`);
  const first = page.locator("a[href*='/tx/'], tr[role='link'], [data-tx-id]").first();
  if (await first.count()) {
    await first.click();
    await page.waitForURL(/\/tx\//);
    await fits(page, "transaction");
  }
});
