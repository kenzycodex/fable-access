import { expect, test } from "@playwright/test";
import { ageHold, asCustomer, PIN, sandboxCode, sendTransfer, signIn, typeCode } from "./helpers";

// Each test uses its own seeded customer (api/scripts/e2e_seed.py), so one
// test's transfers never change another's score.

test("a small first transfer passes and is sent", async ({ page }) => {
  await asCustomer(page, "e2e-pass", "Ada Obi");
  await sendTransfer(page, 5_000, { channel: "Mobile App" });
  await expect(page.getByRole("heading", { name: "Transfer sent" })).toBeVisible();
});

test("a first transfer on the riskiest channel is flagged and sent after the PIN", async ({ page }) => {
  await asCustomer(page, "e2e-flag", "Bayo Lawal");
  // Under the NGN 100k "large" line, so session and typing-speed signals stay quiet.
  await sendTransfer(page, 99_000, { channel: "Web" });
  await expect(page.getByText("Please confirm this transfer")).toBeVisible();
  await page.getByRole("button", { name: /verify it's me/i }).click();
  await typeCode(page, "Enter your PIN", PIN);
  await page.waitForURL(/\/demo\/e2ebank\/?$/);
});

test("a blocked transfer held by Ghost can be cancelled", async ({ page }) => {
  await asCustomer(page, "e2e-cancel", "Chioma Eze");
  await sendTransfer(page, 1_000_000, { channel: "Web" });
  await expect(page.getByText("Transfer paused")).toBeVisible();
  await page.getByRole("button", { name: /Send anyway, with protection/ }).click();
  await page.waitForURL(/\/ghost/);
  await expect(page.getByText("Funds on hold")).toBeVisible();
  await page.getByRole("button", { name: "Cancel and get my money back" }).click();
  await page.waitForURL(/\/demo\/e2ebank\/?$/);
});

test("a held transfer is released with passkey, PIN and an emailed code", async ({ page, context }) => {
  // A virtual authenticator stands in for the phone's fingerprint reader.
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await asCustomer(page, "e2e-release", "Dayo Musa");
  // Set up device unlock before any transfer: factors added after a hold never release it.
  await page.goto("/demo/e2ebank/transparency");
  await page.getByRole("button", { name: "Add device" }).click();
  await typeCode(page, "Confirm with your PIN to trust a new device", PIN);
  await expect(page.getByText(/1 added/)).toBeVisible();

  await sendTransfer(page, 1_000_000, { channel: "Web" });
  await page.getByRole("button", { name: /Send anyway, with protection/ }).click();
  await page.waitForURL(/\/ghost/);
  await page.getByRole("button", { name: /release the transfer/i }).click();

  await page.getByRole("button", { name: /Confirm with fingerprint or face/ }).click();
  await typeCode(page, "Enter your PIN", PIN);
  await page.getByRole("button", { name: /Send a code to my email/ }).click();
  const code = await sandboxCode(page);
  await typeCode(page, "6-digit code", code);
  await page.waitForURL(/\/demo\/e2ebank\/?$/);
});

test("a hold nobody releases expires and nothing is sent", async ({ page }) => {
  await asCustomer(page, "e2e-expire", "Efe Okoro");
  await sendTransfer(page, 1_000_000, { channel: "Web" });
  await page.getByRole("button", { name: /Send anyway, with protection/ }).click();
  await page.waitForURL(/\/ghost/);
  ageHold("e2e-expire");
  await page.getByRole("button", { name: /release the transfer/i }).click();
  await expect(page.getByText("Hold ended")).toBeVisible();
  await expect(page.getByText(/expired, so the money stayed in your account/)).toBeVisible();
});

test("an analyst works a flagged case in the console", async ({ page, browser }) => {
  // The customer makes a flagged transfer, then leaves it.
  await asCustomer(page, "e2e-review", "Femi Ade");
  // Under the NGN 100k "large" line, so session and typing-speed signals stay quiet.
  await sendTransfer(page, 99_000, { channel: "Web" });
  await expect(page.getByText("Please confirm this transfer")).toBeVisible();

  const analyst = await (await browser.newContext()).newPage();
  await signIn(analyst, "analyst", "/dashboard/review");
  await analyst.waitForURL(/\/dashboard\/review/);
  await analyst.getByText("Femi Ade").first().click();
  await analyst.getByRole("button", { name: /Legitimate/ }).first().click();
  const confirm = analyst.getByRole("button", { name: /Mark legitimate|Confirm|Resolve/ }).last();
  if (await confirm.isVisible()) await confirm.click();
  await expect(analyst.getByText(/Legitimate/).first()).toBeVisible();
});

test("the review sheet shows the amount's size and sends nothing on Recheck", async ({ page }) => {
  await asCustomer(page, "e2e-pass", "Ada Obi");
  await page.goto("/demo/e2ebank/transfer");
  await page.getByRole("tab", { name: "New account" }).click();
  await page.getByLabel("Account number").fill("0123456780");
  const bank = page.getByLabel("Bank");
  await expect(bank.locator("option").nth(1)).toBeAttached();
  await bank.selectOption({ index: 1 });
  await expect(page.getByText(/Demo name|Verified/).first()).toBeVisible();
  await page.getByLabel("Amount in naira").fill("500000");
  await expect(page.getByText("Hundreds of thousands").first()).toBeVisible();
  await page.getByRole("button", { name: /^Send ₦/ }).click();
  const review = page.getByRole("dialog", { name: "Check before you send" });
  await expect(review.getByText(/can't be reversed/)).toBeVisible();
  await review.getByRole("button", { name: "Recheck" }).click();
  await expect(review).toBeHidden();
  await expect(page).toHaveURL(/\/transfer/);
});
