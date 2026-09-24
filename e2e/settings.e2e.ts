/**
 * The settings panel: one size with the categories down the side, and it reopens on the tab you left
 * it on. On a phone it is a list of categories first, then a page with a way back.
 */
import { test, expect } from "@playwright/test";
import { dismissStart } from "./support/app";

const openSettings = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: "Account and settings" }).click();

test("reopens on the tab you left it on, even after a reload", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await openSettings(page);
  await page.getByRole("tab", { name: "Recording" }).click();
  await page.getByRole("button", { name: "Close settings" }).click();

  await page.reload();
  await dismissStart(page);
  await openSettings(page);
  await expect(page.getByRole("tab", { name: "Recording" })).toHaveAttribute("aria-selected", "true");
});

test("keeps its size whichever tab is showing", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await openSettings(page);
  const dialog = page.getByRole("dialog");
  await page.getByRole("tab", { name: "Appearance" }).click();
  const small = await dialog.locator("> div").boundingBox();
  await page.getByRole("tab", { name: "Recording" }).click();
  const large = await dialog.locator("> div").boundingBox();
  expect(large?.height).toBe(small?.height);
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the logo opens a list of categories, and a category opens with a way back", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await page.getByRole("button", { name: "Library" }).tap();
    await page.getByRole("button", { name: "Account and settings" }).tap();

    await page.getByRole("tab", { name: "Appearance" }).tap();
    await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "MIDI" })).toBeHidden();

    await page.getByRole("button", { name: "All settings" }).tap();
    await expect(page.getByRole("tab", { name: "MIDI" })).toBeVisible();
  });
});
