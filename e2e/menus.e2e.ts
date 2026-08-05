import { test, expect, type Page } from "@playwright/test";

/**
 * Kebab (⋮) context menus: the arrangement toolbar's add menu creates a group or a
 * track in a chosen group, the group row's ⋮ adds a track into that group, and each
 * track/group row's ⋮ deletes it. These replace the old "+ Group" and × buttons.
 */

test.use({ viewport: { width: 1320, height: 900 } });

async function dismissStart(page: Page) {
  const start = page.getByRole("button", { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0); // wait for the start overlay to clear (engine.start awaits worklets)
  }
}

test("add a track via the toolbar group picker and delete it via the row menu", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  const trackMenus = page.getByRole("button", { name: "Track actions" });
  const before = await trackMenus.count();

  // Toolbar menu -> New MIDI track in (submenu) -> New group.
  await page.getByRole("button", { name: "Timeline options" }).click();
  await page.getByRole("menuitem", { name: "New MIDI track in" }).hover();
  await page.getByRole("menuitem", { name: "New group" }).click();
  await expect(trackMenus).toHaveCount(before + 1);

  // A track row's ⋮ -> Delete track.
  await trackMenus.first().click();
  await page.getByRole("menuitem", { name: "Delete track" }).click();
  await expect(trackMenus).toHaveCount(before);
});

test("a group row menu adds a MIDI track into that group", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  const trackMenus = page.getByRole("button", { name: "Track actions" });
  const before = await trackMenus.count();

  await page.getByRole("button", { name: "Group actions" }).first().click();
  await page.getByRole("menuitem", { name: "Add MIDI track" }).click();
  await expect(trackMenus).toHaveCount(before + 1);
});

test("a row menu near the bottom edge flips above and stays inside the viewport", async ({ page }) => {
  // A short viewport puts the arrangement's track ⋮ near the bottom, so a menu opened
  // straight below it would run off-screen; it must flip above the trigger and clamp.
  await page.setViewportSize({ width: 1320, height: 260 });
  await page.goto("/");
  await dismissStart(page);

  const trigger = page.getByRole("button", { name: "Track actions" }).first();
  const triggerBox = (await trigger.boundingBox())!;
  await trigger.click();
  const box = (await page.getByRole("menu").first().boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.y, "menu flips above the trigger near the bottom edge").toBeLessThan(triggerBox.y);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height + 0.5);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width + 0.5);
});

/**
 * Placement. The geometry itself is pure and unit-tested in `test/menuPlacement.test.ts`
 * across every position in a phone viewport; what needs a browser is that the component
 * asks the right questions - that each level is portaled and measured, so none of them is
 * clipped by, or scrolled inside, the one that opened it.
 */
const popovers = (page: Page) => page.locator("[data-menu-popover]");

/** Every open popover, boxed, with whether it is inside the viewport and whether it scrolls. */
const popoverBoxes = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-menu-popover]")].map((popover) => {
      const box = popover.getBoundingClientRect();
      return {
        inside: box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight,
        scrolls: popover.scrollHeight > popover.clientHeight + 1,
        rows: popover.querySelectorAll('[role^="menuitem"]').length,
      };
    }),
  );

/**
 * What a real device does when the finger lifts: the touch pointer is destroyed, so the
 * browser fires pointerout/pointerleave up the tap target's ancestors. Playwright's `tap`
 * does not, which is exactly why the bug this covers reached a phone - hover handlers that
 * did not filter touch closed the submenu 140ms after it was tapped open.
 */
async function liftFinger(page: Page, name: string) {
  await page.evaluate((rowName) => {
    const row = [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent?.includes(rowName));
    if (!row) throw new Error(`no menu row matching ${rowName}`);
    row.dispatchEvent(new PointerEvent("pointerout", { pointerType: "touch", bubbles: true }));
    row.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "touch" }));
    row.closest("[data-menu-popover]")?.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "touch" }));
  }, name);
}

test.describe("placement", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("a third level opens, on screen, and its choice lands", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    // Meter -> Beats per bar -> 7 is the deepest menu in the app, and the one that broke:
    // a flyout given `overflow-y: auto` clips the flyout *it* opens, so the third level
    // answered a tap with a scrollbar and nothing else.
    await page.getByRole("button", { name: "More controls" }).tap();
    await page.getByRole("menuitem", { name: /^Meter/ }).tap();
    await page.getByRole("menuitem", { name: "Beats per bar" }).tap();
    // Hover is a mouse idea, and a tap ends with the same events a hover-out does. A flyout
    // opened by a tap has to survive the finger that opened it leaving.
    await liftFinger(page, "Beats per bar");
    await page.waitForTimeout(300);

    const levels = await popoverBoxes(page);
    expect(levels, "three levels open at once").toHaveLength(3);
    levels.forEach((level) => expect(level.inside, "every level inside the viewport").toBe(true));

    await page.getByRole("menuitemradio", { name: "7", exact: true }).tap();
    await expect(popovers(page)).toHaveCount(0); // choosing dismisses the whole tree
    await page.getByRole("button", { name: "More controls" }).tap();
    await expect(page.getByRole("menuitem", { name: /^Meter/ })).toContainText("7/4");
  });

  test("a menu too tall for the viewport scrolls instead of running off it", async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto("/");
    await dismissStart(page);

    await page.getByRole("button", { name: "More controls" }).tap();
    const [overflow] = await popoverBoxes(page);
    expect(overflow.rows, "more rows than a 390px-tall viewport can show").toBeGreaterThan(10);
    expect(overflow.inside).toBe(true);
    expect(overflow.scrolls).toBe(true);

    // Scrolling *inside* the menu is the menu being used, not the page moving under it -
    // and the popover closes on any other scroll, so the two have to be told apart.
    await popovers(page)
      .first()
      .evaluate((popover) => popover.scrollBy(0, 120));
    await expect(popovers(page)).toHaveCount(1);
  });
});
