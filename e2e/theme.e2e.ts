import { test, expect, type Page } from "@playwright/test";

/**
 * Light mode. The palette is CSS (`index.css`) and switching it is one attribute, so what
 * is worth guarding is the wiring around that: the three states resolve the way they are
 * meant to, the choice survives a reload, and a canvas repaints when the colours under it
 * move (canvases hold pixels, not `var()` references, so that one does not come free).
 */

test.use({ viewport: { width: 1320, height: 900 } });

async function dismissStart(page: Page) {
  const start = page.getByRole("button", { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0);
  }
}

const themeAttr = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-theme"));
const token = (page: Page, name: string) =>
  page.evaluate((property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(), name);

async function openAppearance(page: Page) {
  await page
    .getByRole("button", { name: /settings/i })
    .first()
    .click();
  await page.getByRole("tab", { name: "Appearance" }).click();
}

/**
 * Playwright emulates a LIGHT operating system by default, so "no choice" resolves to the
 * light palette here. Every test states the OS it wants rather than leaning on that.
 */
test("with no choice stored, the OS decides and nothing is pinned", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await dismissStart(page);

  // "System" is the absence of a choice, not a third value written to the document: pinning
  // the current OS theme would stop the app following a machine that flips at sunset.
  expect(await themeAttr(page)).toBeNull();
  const onDarkOs = await token(page, "--color-ground");

  await page.emulateMedia({ colorScheme: "light" });
  expect(await token(page, "--color-ground"), "follows the OS with no attribute involved").not.toBe(onDarkOs);
});

test("choosing a theme repaints, and the choice survives a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await dismissStart(page);
  const dark = await token(page, "--color-ground");

  await openAppearance(page);
  await page.getByRole("radio", { name: "Light" }).click();

  await expect.poll(() => themeAttr(page)).toBe("light");
  const light = await token(page, "--color-ground");
  expect(light, "the ground token actually moved, not just the attribute").not.toBe(dark);

  await page.reload();
  await dismissStart(page);
  expect(await themeAttr(page), "the choice is remembered").toBe("light");
  expect(await token(page, "--color-ground")).toBe(light);
});

test("an explicit choice outranks the system, and System hands control back", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await openAppearance(page);

  // The guard that makes the three states resolve: `data-theme="dark"` has to win even when
  // the OS asks for light, which is what the `:not([data-theme="dark"])` in the media query
  // is for. Playwright's default colour scheme is light, so this is that case.
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect.poll(() => themeAttr(page)).toBe("dark");
  const pinnedDark = await token(page, "--color-ground");

  await page.getByRole("radio", { name: "Light" }).click();
  await expect.poll(() => themeAttr(page)).toBe("light");
  expect(await token(page, "--color-ground")).not.toBe(pinnedDark);

  await page.getByRole("radio", { name: "System" }).click();
  await expect.poll(() => themeAttr(page)).toBeNull();
  // Back under the OS preference, which is light here.
  expect(await token(page, "--color-ground")).not.toBe(pinnedDark);
});

/** A colour string as the browser normalises it, so a hex and an rgb() can be compared. */
const asRgb = (page: Page, colour: string) =>
  page.evaluate((value) => {
    const probe = document.createElement("span");
    probe.style.color = value;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, colour);

test("an author's colour is re-lit for a white ground, on both paths at once", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await dismissStart(page);
  const onDark = await token(page, "--color-you");

  await openAppearance(page);
  await page.getByRole("radio", { name: "Light" }).click();
  await expect.poll(() => themeAttr(page)).toBe("light");
  const onLight = await token(page, "--color-you");
  await page.keyboard.press("Escape"); // the settings modal is over the roll

  // The palette is drawn for a near-black ground; on white the same hues drop under the 3:1
  // floor for a UI component, so light mode re-lights them (hue kept, lightness moved).
  expect(onLight, "the voice is re-lit rather than reused").not.toBe(onDark);

  // The bit that actually matters. A voice is resolved twice over: as this CSS var, and in
  // JS by `colorForAuthor` for everything that tints by author. If the two ever disagree you
  // get two different teals in one window, so compare a real author-tinted surface with the
  // variable. A drawn note is `authorNoteStyle`, i.e. the JS path.
  // The seeded project always shows one arrangement clip, and a clip block is tinted through
  // `authorBlockStyle`, so its top accent is the JS path resolving the same author.
  const placement = page.getByTestId("placement").first();
  await expect(placement).toBeVisible();
  const painted = await placement.evaluate((element) => getComputedStyle(element).borderTopColor);
  expect(painted, "the JS-drawn surface matches the CSS variable").toBe(await asRgb(page, onLight));
});
