import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

export const BANK = "e2ebank";
export const PASSWORD = "e2e-password-123";
export const PIN = "2580";

/** Sign in to the console as `role` and open the sandbox app. */
export async function signIn(page: Page, role: "owner" | "analyst" = "owner", next = "/demo") {
  await page.goto(`/dashboard/login?next=${encodeURIComponent(next)}`);
  await page.locator('input[type="email"]').fill(`${role}@${BANK}.test`);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
}

/** Open the sandbox app as one of the seeded test customers. */
export async function asCustomer(page: Page, reference: string, name: string) {
  await signIn(page);
  await page.waitForURL(new RegExp(`/demo/${BANK}`), { timeout: 120_000 });
  const switcher = page.getByRole("button", { name: /Switch customer/ }).first();
  await expect(switcher).toBeVisible();
  await switcher.click();
  await page.getByRole("button", { name: new RegExp(`Ref ${reference}$`) }).last().click();
  await expect(page.getByRole("button", { name: new RegExp(`Signed in as ${name}`) }).first()).toBeVisible();
}

/** Send money to a new account from the transfer page. */
export async function sendTransfer(page: Page, amount: number, opts: { channel?: "Mobile App" | "USSD" | "Web" } = {}) {
  await page.goto(`/demo/${BANK}/transfer`);
  await page.getByRole("tab", { name: "New account" }).click();
  await page.getByLabel("Account number").fill(String(1_000_000_000 + Math.floor(Math.random() * 8_999_999_999)).slice(0, 10));
  const bank = page.getByLabel("Bank");
  await expect(bank.locator("option").nth(1)).toBeAttached();
  await bank.selectOption({ index: 1 });
  await expect(page.getByText(/Demo name|Verified/).first()).toBeVisible();
  if (opts.channel) await page.getByRole("tab", { name: new RegExp(`^${opts.channel}`) }).click();
  await page.getByLabel("Amount in naira").fill(String(amount));
  await page.getByRole("button", { name: /^Send ₦/ }).click();
  // The review sheet: nothing is sent until the customer confirms.
  const review = page.getByRole("dialog", { name: "Check before you send" });
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: "Confirm" }).click();
  await page.waitForURL(/\/result/);
}

/** Type into a one-box PIN or code input by its label. */
export async function typeCode(page: Page, label: string | RegExp, digits: string) {
  const input = page.getByLabel(label).last();
  await input.click({ force: true });
  await input.pressSequentially(digits);
}

/** The newest code in the sandbox inbox box the dialog shows. */
export async function sandboxCode(page: Page): Promise<string> {
  const box = page.getByRole("status").filter({ hasText: "Sandbox code" }).last();
  await expect(box).toBeVisible();
  const text = (await box.textContent()) ?? "";
  const match = text.match(/(\d{6})/);
  if (!match) throw new Error(`No code in the sandbox box: ${text}`);
  return match[1];
}

function python(): string {
  if (process.env.FABLE_E2E_PYTHON) return process.env.FABLE_E2E_PYTHON;
  const api = path.resolve(__dirname, "..", "api");
  const venv = process.platform === "win32" ? path.join(api, ".venv", "Scripts", "python.exe") : path.join(api, ".venv", "bin", "python");
  return existsSync(venv) ? venv : "python";
}

/** Close a customer's hold window in the throwaway database. */
export function ageHold(reference: string) {
  execFileSync(python(), ["scripts/e2e_age_hold.py", reference], {
    cwd: path.resolve(__dirname, "..", "api"),
    env: { ...process.env, FABLE_DB_PATH: process.env.FABLE_E2E_DB },
    stdio: "inherit",
  });
}
