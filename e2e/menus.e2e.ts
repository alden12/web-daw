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
 * Placement runs *after* whatever triggers it (a tap, a viewport change), so reading boxes
 * straight afterwards can catch a popover mid-flight: present, but not yet moved back inside
 * the viewport. `toHaveCount` retries the count and nothing else, which is what let a bare
 * `getBoundingClientRect` read flake. Poll the geometry, then hand it back settled.
 */
async function settledPopoverBoxes(page: Page, count: number) {
  await expect
    .poll(
      async () => {
        const boxes = await popoverBoxes(page);
        return boxes.length === count && boxes.every((box) => box.inside);
      },
      { message: `${count} popover(s) open and inside the viewport` },
    )
    .toBe(true);
  return popoverBoxes(page);
}

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

    // Meter -> Beat unit -> 8 is a deepest-in-the-app chain, and the shape that broke: a
    // flyout given `overflow-y: auto` clips the flyout *it* opens, so the third level
    // answered a tap with a scrollbar and nothing else.
    await page.getByRole("button", { name: "More controls" }).tap();
    await page.getByRole("menuitem", { name: /^Meter/ }).tap();
    await page.getByRole("menuitem", { name: "Beat unit" }).tap();
    // Hover is a mouse idea, and a tap ends with the same events a hover-out does. A flyout
    // opened by a tap has to survive the finger that opened it leaving.
    await liftFinger(page, "Beat unit");

    // Polls, so no fixed wait for the flyout to open and settle.
    const levels = await settledPopoverBoxes(page, 3);
    expect(levels, "three levels open at once").toHaveLength(3);

    await page.getByRole("menuitemradio", { name: "8", exact: true }).tap();
    await expect(popovers(page)).toHaveCount(0); // choosing dismisses the whole tree
    await page.getByRole("button", { name: "More controls" }).tap();
    await expect(page.getByRole("menuitem", { name: /^Meter/ })).toContainText("4/8");
  });

  /**
   * A resize used to close the menu, which is fine for a rotated phone and wrong for the one
   * resize that matters here: a virtual keyboard. Tapping the tempo field would have shut the
   * menu the field is in, before a digit could be typed. Each popover re-places instead.
   */
  test("a resize re-places the menu rather than closing it", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    await page.getByRole("button", { name: "More controls" }).tap();
    await page.getByRole("spinbutton", { name: "Tempo" }).tap();
    // What the keyboard does to the viewport, without needing a keyboard.
    await page.setViewportSize({ width: 390, height: 500 });

    // The resize triggers a re-place, so the box has to be read once that has run.
    await settledPopoverBoxes(page, 1);
    await page.getByRole("spinbutton", { name: "Tempo" }).fill("96");
    await expect(page.getByRole("spinbutton", { name: "Tempo" })).toHaveValue("96");
  });

  test("a menu too tall for the viewport scrolls instead of running off it", async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto("/");
    await dismissStart(page);

    await page.getByRole("button", { name: "More controls" }).tap();
    const [overflow] = await settledPopoverBoxes(page, 1);
    expect(overflow.rows, "more rows than a 390px-tall viewport can show").toBeGreaterThan(10);
    expect(overflow.scrolls).toBe(true);

    // Scrolling *inside* the menu is the menu being used, not the page moving under it -
    // and the popover closes on any other scroll, so the two have to be told apart.
    await popovers(page)
      .first()
      .evaluate((popover) => popover.scrollBy(0, 120));
    await expect(popovers(page)).toHaveCount(1);
  });
});
