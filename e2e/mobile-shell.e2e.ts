import { test, expect, type Page } from "@playwright/test";

/**
 * The touch shell (MOBILE-1): at phone/tablet size the app swaps the four-region
 * desktop grid for a pinned transport + one view + a bottom tab bar, hosting the same
 * panels from the same stores. These guard the swap itself and the tab navigation -
 * the gesture layer (pinch, tools, sheets) is MOBILE-2 and not covered here.
 */

const PHONE = { width: 390, height: 844 };

/** Dismiss the audio-start modal so the shell is interactive. */
async function dismissStart(page: Page) {
  const start = page.getByRole("button", { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0);
  }
}

const tabBar = (page: Page) => page.getByRole("tablist", { name: "Views" });
const desktopRail = (page: Page) => page.locator('[class*="grid-area:rail"]');
const shell = (page: Page) => page.locator("[data-device-tier]");

test.describe("phone", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test("swaps in the touch shell: no desktop rail, a pinned transport, bottom tabs", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    await expect(shell(page)).toHaveAttribute("data-device-tier", "phone");
    // The desktop spine is gone entirely - this is a swap, not a reflow.
    await expect(desktopRail(page)).toHaveCount(0);
    await expect(page.locator('[class*="grid-area:library"]')).toHaveCount(0);

    // The transport is pinned above the views, so it is reachable from every tab.
    await expect(page.getByRole("button", { name: /play|stop/i }).first()).toBeVisible();
    await expect(tabBar(page)).toBeVisible();
    await expect(tabBar(page).getByRole("tab")).toHaveCount(5);
  });

  test("the tab bar sits in the thumb zone and every tab has a generous hit target", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    const bar = (await tabBar(page).boundingBox())!;
    // Pinned to the bottom of the viewport (allowing for the safe-area padding).
    expect(bar.y + bar.height).toBeGreaterThan(PHONE.height - 40);

    for (const tab of await tabBar(page).getByRole("tab").all()) {
      const box = (await tab.boundingBox())!;
      // The touch-target floor: comfortably past the ~44px both platforms recommend.
      expect(box.height, "tab height").toBeGreaterThanOrEqual(44);
      expect(box.width, "tab width").toBeGreaterThanOrEqual(44);
    }
  });

  test("tabs switch the hosted panel, and the transport survives the switch", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    // Arrange is the landing tab: the timeline is on show.
    await expect(page.locator('[class*="grid-area:timeline"]')).toBeVisible();

    await tabBar(page).getByRole("tab", { name: "Library" }).tap();
    await expect(page.locator('[class*="grid-area:library"]')).toBeVisible();
    await expect(page.locator('[class*="grid-area:timeline"]')).toHaveCount(0);
    // The library's view switcher comes across as a horizontal strip.
    await expect(page.getByRole("navigation", { name: "Library views" })).toBeVisible();

    await tabBar(page).getByRole("tab", { name: "Agent" }).tap();
    await expect(page.locator('[class*="grid-area:agent"]')).toBeVisible();

    await tabBar(page).getByRole("tab", { name: "Mix" }).tap();
    await expect(page.getByTestId("tree-track").first()).toBeVisible();

    // One transport for the whole shell, and it outlived three tab switches.
    await expect(page.getByRole("button", { name: /play|stop/i }).first()).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: /beats per bar/i })).toHaveCount(1);
  });

  test("track headers scroll away with the lanes instead of pinning a column", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    const header = page.locator("[data-track-id]").first().locator("> div").first();
    const before = (await header.boundingBox())!;
    expect(before.x).toBeGreaterThanOrEqual(0);

    // Scroll the arrangement right; a pinned header would stay put at x = 0.
    await page.getByTestId("arr-scroll").evaluate((el) => (el.scrollLeft = 400));
    await expect.poll(async () => (await header.boundingBox())!.x).toBeLessThan(before.x - 100);
  });

  test("the clip rail sits above the roll, not beside it, so the roll gets the width", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await tabBar(page).getByRole("tab", { name: "Edit" }).tap();

    const rail = (await page.getByRole("button", { name: /^\+ Clip$/ }).boundingBox())!;
    const roll = (await page.getByTestId("roll-scroll").boundingBox())!;
    // Stacked: the rail is entirely above the roll, and the roll spans the viewport.
    expect(rail.y + rail.height).toBeLessThanOrEqual(roll.y + 1);
    expect(roll.width).toBeGreaterThan(PHONE.width - 40);
  });

  test("tapping a track in the timeline follows it into the Edit tab", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await expect(page.locator('[class*="grid-area:timeline"]')).toBeVisible();

    await page.locator("[data-track-id]").first().locator("> div").first().tap();

    await expect(tabBar(page).getByRole("tab", { name: "Edit" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("roll-scroll")).toBeVisible();
  });

  test("tapping empty lane space stays put - it drops a paste marker", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    // Well to the right of any placement on the first track's lane.
    const lane = (await page.locator("[data-track-id]").first().boundingBox())!;
    await page.touchscreen.tap(lane.x + lane.width - 20, lane.y + lane.height / 2);

    await expect(tabBar(page).getByRole("tab", { name: "Arrange" })).toHaveAttribute("aria-selected", "true");
  });

  test("the timeline does not render a second transport under the pinned one", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    // Arrange hosts the timeline, whose toolbar carries the transport on desktop.
    await expect(page.locator('[class*="grid-area:timeline"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Record" })).toHaveCount(1);
  });
});

test.describe("phone, landscape", () => {
  // A phone turned sideways is ~390px tall, which is where the device rack's fixed,
  // persisted height used to take the whole body and leave the editor zero pixels.
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

  test("the device rack cannot squeeze the piano roll out of existence", async ({ page }) => {
    // Persist a rack taller than the entire viewport before the app boots.
    await page.addInitScript(() => localStorage.setItem("web-daw:devices-height", "600"));
    await page.goto("/");
    await dismissStart(page);
    await tabBar(page).getByRole("tab", { name: "Edit" }).tap();

    const roll = (await page.getByTestId("roll-scroll").boundingBox())!;
    expect(roll.height, "the roll keeps a workable minimum").toBeGreaterThan(50);
    // ...and the clip rail is still reachable.
    await expect(page.getByRole("button", { name: /^\+ Clip$/ })).toBeVisible();
  });

  test("the device rack sits beside the roll, not under it, so neither is a sliver", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await tabBar(page).getByRole("tab", { name: "Edit" }).tap();

    const roll = (await page.getByTestId("roll-scroll").boundingBox())!;
    const rack = (await page.getByText("Devices", { exact: true }).boundingBox())!;
    // Side by side: the rack starts to the right of the roll and they share the rows.
    expect(rack.x).toBeGreaterThanOrEqual(roll.x + roll.width - 1);
    expect(roll.height, "a stacked layout is what made these slivers").toBeGreaterThan(120);
  });
});

test.describe("tablet", () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true });

  test("gets the touch shell too, tiered as tablet", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await expect(shell(page)).toHaveAttribute("data-device-tier", "tablet");
    await expect(tabBar(page)).toBeVisible();
  });
});

test.describe("desktop", () => {
  test("keeps the four-region grid at full width", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await expect(shell(page)).toHaveCount(0);
    await expect(desktopRail(page)).toBeVisible();
    await expect(tabBar(page)).toHaveCount(0);
  });

  test("a window too narrow for the grid falls back to the touch shell", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await expect(desktopRail(page)).toBeVisible();

    // No touch hardware here - width alone is enough once the grid has no room.
    await page.setViewportSize({ width: 700, height: 900 });
    await expect(shell(page)).toHaveAttribute("data-device-tier", "phone");
    await expect(desktopRail(page)).toHaveCount(0);

    // ...and it swaps back, so this is a live tier, not a load-time decision.
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(desktopRail(page)).toBeVisible();
    await expect(tabBar(page)).toHaveCount(0);
  });
});
