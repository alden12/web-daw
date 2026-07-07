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
