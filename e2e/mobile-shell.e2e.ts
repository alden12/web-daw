import { test, expect, type Page } from "@playwright/test";

/**
 * The touch shell (MOBILE-1). At phone/tablet size the app swaps the four-region desktop
 * grid for a pinned transport, a lane strip, one workspace, and a bottom tab bar whose
 * tabs are the desktop's four surfaces - hosting the same panels from the same stores.
 *
 * The gesture layer (pinch, tool model, long-press) is MOBILE-2 and not covered here.
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
const tab = (page: Page, name: string) => tabBar(page).getByRole("tab", { name });
const desktopRail = (page: Page) => page.locator('[class*="grid-area:rail"]');
const shell = (page: Page) => page.locator("[data-device-tier]");
const laneStrip = (page: Page) => page.getByTestId("lane-strip");
const trackHeader = (page: Page) => page.locator("[data-track-id]").first().locator("> div").first();

/**
 * Open the shell's ⋮. Retried because `Menu` dismisses itself on any scroll and a surface
 * that has just mounted may still be restoring its own scroll offset, which can close the
 * popover the instant it opens.
 */
async function openOverflow(page: Page) {
  const menu = page.getByRole("menu").first();
  await expect(async () => {
    // Only tap when it is not already open - the trigger toggles, so a blind retry would
    // close the menu the previous attempt had just managed to open.
    if (!(await menu.isVisible())) await page.getByRole("button", { name: "More controls" }).tap();
    await expect(menu).toBeVisible({ timeout: 800 });
  }).toPass({ timeout: 10_000 });
}

test.describe("phone", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test("swaps in the touch shell: four workspace tabs, one pinned transport", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    await expect(shell(page)).toHaveAttribute("data-device-tier", "phone");
    // The desktop spine is gone entirely - this is a swap, not a reflow.
    await expect(desktopRail(page)).toHaveCount(0);

    // The tabs are the desktop's surfaces, not phone-invented navigation.
    await expect(tabBar(page).getByRole("tab")).toHaveCount(4);
    for (const name of ["Arrangement", "Edit", "Clips", "Devices"]) {
      await expect(tab(page, name)).toBeVisible();
    }

    // One transport, above every tab, and only one.
    await expect(page.getByRole("button", { name: "Record" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /play|stop/i }).first()).toBeVisible();
  });

  test("the tab bar sits in the thumb zone with generous hit targets", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    const bar = (await tabBar(page).boundingBox())!;
    expect(bar.y + bar.height).toBeGreaterThan(PHONE.height - 40);

    for (const item of await tabBar(page).getByRole("tab").all()) {
      const box = (await item.boundingBox())!;
      expect(box.height, "tab height").toBeGreaterThanOrEqual(44);
      expect(box.width, "tab width").toBeGreaterThanOrEqual(44);
    }
  });

  test("each tab hosts one surface, and the transport survives switching", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    await expect(page.locator('[class*="grid-area:timeline"]')).toBeVisible();

    await tab(page, "Edit").tap();
    await expect(page.getByTestId("roll-scroll")).toBeVisible();

    await tab(page, "Clips").tap();
    await expect(page.getByRole("button", { name: /^\+ Clip$/ })).toBeVisible();

    await tab(page, "Devices").tap();
    // "Devices" also names the tab, so assert on something only the rack has.
    await expect(page.getByRole("button", { name: "Save as patch" })).toBeVisible();

    await expect(page.getByRole("button", { name: "Record" })).toHaveCount(1);
  });

  test("the lane strip keeps the selected track visible on every tab but Arrangement", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    // Arrangement *is* the lanes, so no strip there.
    await expect(laneStrip(page)).toHaveCount(0);

    for (const name of ["Edit", "Clips", "Devices"]) {
      await tab(page, name).tap();
      await expect(laneStrip(page), `strip on ${name}`).toBeVisible();
      // It names the selected track, so you can tell what you are editing.
      await expect(laneStrip(page).getByText("Subtractive 1")).toBeVisible();
    }
  });

  test("tapping a track in Arrangement selects it without navigating away", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    await trackHeader(page).tap();

    // Still on Arrangement: the lane strip is what keeps the selection visible, so
    // selection no longer has to imply navigation.
    await expect(tab(page, "Arrangement")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[class*="grid-area:timeline"]')).toBeVisible();
  });

  test("the lane strip is on the same stretch of timeline as the Arrangement tab", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    // Scroll the arrangement well along the time axis, then switch tabs.
    await page.getByTestId("arr-scroll").evaluate((el) => (el.scrollLeft = 600));
    await tab(page, "Edit").tap();
    await expect(laneStrip(page)).toBeVisible();

    // The strip picks up where the arrangement was rather than snapping back to bar 1.
    // Its header sits outside its scroller, so it leads by the header width less.
    const stripScroll = await page.getByTestId("lane-strip-scroll").evaluate((el) => el.scrollLeft);
    expect(stripScroll).toBeGreaterThan(300);
  });

  test("scrolling the arrangement back to the start does not snap forward again", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    const scroller = page.getByTestId("arr-scroll");

    // The shared view offset used to floor at beat 0 and get pushed back into the DOM, so
    // scrolling left into the header gutter yanked you forward to the gutter's edge. The
    // timeline caught on the headers every time.
    await scroller.evaluate((el) => (el.scrollLeft = 500));
    await scroller.evaluate((el) => (el.scrollLeft = 0));
    await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBe(0);

    // ...and anywhere inside the gutter stays put too.
    await scroller.evaluate((el) => (el.scrollLeft = 60));
    await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBe(60);
  });

  // Leaving and returning must keep your place. Inside the header gutter is the case that
  // regressed: the lane strip cannot show a gutter, so restoring its own scroll clamped to
  // 0, and publishing that clamped value overwrote the offset the timeline needed.
  for (const { name, target } of [
    { name: "well along the timeline", target: 500 },
    { name: "inside the header gutter", target: 100 },
  ]) {
    test(`the arrangement keeps its scroll position across a tab switch (${name})`, async ({ page }) => {
      await page.goto("/");
      await dismissStart(page);
      const scroller = () => page.getByTestId("arr-scroll");

      await scroller().evaluate((el, value) => (el.scrollLeft = value), target);
      await expect.poll(() => scroller().evaluate((el) => el.scrollLeft)).toBe(target);

      await tab(page, "Edit").tap();
      await expect(laneStrip(page)).toBeVisible();
      await tab(page, "Arrangement").tap();
      await expect(scroller()).toBeVisible();

      await expect.poll(() => scroller().evaluate((el) => el.scrollLeft)).toBe(target);
    });
  }

  test("undo and redo are in the top bar, and tempo has moved to the overflow menu", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    const undo = page.getByRole("button", { name: "Undo" });
    const redo = page.getByRole("button", { name: "Redo" });
    // Nothing to undo on a fresh project, so both start unavailable.
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();

    // Tempo gave up its slot for them; it lives in the menu now.
    await expect(page.getByRole("spinbutton", { name: /tempo/i })).toHaveCount(0);
    await openOverflow(page);
    await expect(page.getByRole("menuitem", { name: "Tempo" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Make an edit, then undo it: 120 -> 140 -> 120.
    await openOverflow(page);
    await page.getByRole("menuitem", { name: "Tempo" }).click();
    await page.getByRole("menuitemradio", { name: "140 BPM" }).click();
    await expect(undo).toBeEnabled();

    // Undoing the tempo change puts the log back where it started: nothing left to undo,
    // something to redo.
    await undo.tap();
    await expect(undo).toBeDisabled();
    await expect(redo).toBeEnabled();
  });

  test("the lane strip is a title row over a full-width lane, not a header column", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await tab(page, "Edit").tap();

    const strip = laneStrip(page);
    await expect(strip.getByText("Subtractive 1")).toBeVisible();
    // The track's gain is the one per-track control worth reaching for while editing.
    await expect(strip.getByRole("slider", { name: "Track gain" })).toBeVisible();

    // No header column: the lane runs the width of the strip rather than starting after one.
    const stripBox = (await strip.boundingBox())!;
    const laneBox = (await strip.getByTestId("lane").boundingBox())!;
    expect(laneBox.x - stripBox.x, "the lane starts at the strip's left edge").toBeLessThan(4);

    // An instrument track records from the Clips tab, so no record button here.
    await expect(strip.getByRole("button", { name: /record/i })).toHaveCount(0);
  });

  test("the roll has no toolbar of its own - its controls are in the shell's menu", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await tab(page, "Edit").tap();
    await expect(page.getByTestId("roll-scroll")).toBeVisible();

    // The toolbar row is hidden, so its label is not shown...
    await expect(page.getByText("Piano roll", { exact: true })).toBeHidden();

    // ...and the controls turn up in the one overflow menu, above the project's.
    await openOverflow(page);
    // Checkable rows are `menuitemradio`; plain actions are `menuitem`.
    await expect(page.getByRole("menuitemradio", { name: /Snap to grid/i })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Zoom in/i })).toBeVisible();
    // ...and the project group is below the surface's own controls.
    await expect(page.getByRole("menuitemradio", { name: /Metronome/i })).toBeVisible();
  });

  test("the overflow menu follows the active surface", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    // On Arrangement it carries the timeline's own options...
    await openOverflow(page);
    await expect(page.getByRole("menuitem", { name: "Add group" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Count-in/ })).toBeVisible();
    await page.keyboard.press("Escape");

    // ...and on Edit it carries the roll's instead.
    await tab(page, "Edit").tap();
    await openOverflow(page);
    await expect(page.getByRole("menuitem", { name: /Quantize/i }).first()).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Add group" })).toHaveCount(0);
  });

  test("the overflow menu reflects the surface's state, not the shell's last render", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await tab(page, "Edit").tap();
    const velocity = () => page.getByRole("menuitemradio", { name: /Velocity lane/i });

    await openOverflow(page);
    await expect(velocity()).toHaveAttribute("aria-checked", "true");
    await velocity().click();

    // The surface's controls are published as a getter and the shell is *not* re-rendered
    // when the surface's own state changes, so an items array captured at the shell's last
    // render would still tick this row. `Menu` reads the getter while open instead.
    await openOverflow(page);
    await expect(velocity()).toHaveAttribute("aria-checked", "false");
  });

  test("the library opens as a sheet from the left and closes again", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    const sheet = page.getByRole("dialog", { name: "Library" });
    await expect(sheet).toHaveCount(0); // lazily mounted: never opened, never built

    await page.getByRole("button", { name: "Library" }).tap();
    await expect(sheet).toBeVisible();
    // It carries the same view set as the desktop rail.
    await expect(sheet.getByRole("navigation", { name: "Library views" })).toBeVisible();
    await expect(sheet.getByText("Subtractive")).toBeVisible();

    await page.keyboard.press("Escape");
    // Still mounted (so reopening is instant) but inert and out of reach.
    await expect(sheet).toHaveAttribute("inert", "");
  });

  test("the agent opens as a sheet from the right and stays mounted when closed", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    const sheet = page.getByRole("dialog", { name: "Agent" });
    await page.getByRole("button", { name: "Agent" }).tap();
    await expect(sheet).toBeVisible();

    await page.keyboard.press("Escape");
    // Deliberately not unmounted: an interruptible agent run must survive a close.
    await expect(sheet).toHaveCount(1);
    await expect(sheet).toHaveAttribute("inert", "");
  });
});

test.describe("phone, landscape", () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

  test("needs no special case: one surface per tab fits a short screen", async ({ page }) => {
    // A rack taller than the viewport used to squeeze the roll to nothing when the two
    // shared a tab. They no longer do.
    await page.addInitScript(() => localStorage.setItem("web-daw:devices-height", "600"));
    await page.goto("/");
    await dismissStart(page);
    await tab(page, "Edit").tap();

    const roll = (await page.getByTestId("roll-scroll").boundingBox())!;
    expect(roll.height, "the roll has the tab to itself").toBeGreaterThan(150);
    expect(roll.width, "and the full width").toBeGreaterThan(700);
  });

  test("the velocity lane can be collapsed to give the notes the height", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await tab(page, "Edit").tap();

    const lane = page.getByTitle("Velocity - drag a bar");
    await expect(lane).toBeVisible();
    // At ~390px tall the lane plus the ruler is most of what there is, so it folds away.
    await openOverflow(page);
    await page.getByRole("menuitemradio", { name: /Velocity lane/i }).click();
    await expect(lane).toBeHidden();
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

  test("docks the library and agent beside the workspace instead of over it", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await tab(page, "Edit").tap();
    const roll = page.getByTestId("roll-scroll");

    // Already open: a tablet starts with the library docked, so there is nothing to tap.
    const library = page.getByRole("complementary", { name: "Library" });
    await expect(library).toBeVisible();
    // Docked, not overlaid: no dialog, and the workspace is still there beside it.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(roll).toBeVisible();
    const libraryBox = (await library.boundingBox())!;
    const rollBox = (await roll.boundingBox())!;
    expect(libraryBox.x + libraryBox.width, "the library sits left of the workspace").toBeLessThanOrEqual(
      rollBox.x + 1,
    );

    await page.getByRole("button", { name: "Agent", exact: true }).tap();
    const agent = page.getByRole("complementary", { name: "Agent" });
    await expect(agent).toBeVisible();
    // ...and the agent to the right, with all three on screen at once.
    const agentBox = (await agent.boundingBox())!;
    const rollAfter = (await roll.boundingBox())!;
    expect(agentBox.x, "the agent sits right of the workspace").toBeGreaterThanOrEqual(
      rollAfter.x + rollAfter.width - 1,
    );

    // The same button closes it again.
    await page.getByRole("button", { name: "Agent", exact: true }).tap();
    await expect(agent).toHaveCount(0);
  });

  test("opens with the library already docked, and the toggle still closes it", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    const library = page.getByRole("complementary", { name: "Library" });
    // No tap: there is room for it beside the workspace, so a tablet starts with it open.
    await expect(library).toBeVisible();

    await page.getByRole("button", { name: "Library", exact: true }).tap();
    await expect(library).toHaveCount(0);
  });

  test("keeps the tab bar over the workspace, not under the docked panels", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    const library = page.getByRole("complementary", { name: "Library" });
    await expect(library).toBeVisible();

    const libraryBox = (await library.boundingBox())!;
    const barBox = (await tabBar(page).boundingBox())!;
    // The tabs switch the workspace column, so they start where the library ends.
    expect(barBox.x, "the tab bar starts right of the docked library").toBeGreaterThanOrEqual(
      libraryBox.x + libraryBox.width - 1,
    );

    // ...and closing the library hands that width back.
    await page.getByRole("button", { name: "Library", exact: true }).tap();
    await expect(library).toHaveCount(0);
    const barFull = (await tabBar(page).boundingBox())!;
    expect(barFull.width, "the tab bar spans the full width once nothing is docked").toBeGreaterThan(barBox.width);
  });
});

test.describe("desktop", () => {
  test("keeps the four-region grid, its own toolbars and no tab bar", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await expect(shell(page)).toHaveCount(0);
    await expect(desktopRail(page)).toBeVisible();
    await expect(tabBar(page)).toHaveCount(0);
    // The roll keeps its toolbar and the timeline its options menu.
    await expect(page.getByText("Piano roll", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Timeline options" })).toBeVisible();
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
