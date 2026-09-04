import { test, expect, type Page } from "@playwright/test";

/**
 * The touch shell (MOBILE-1, restructured by MOBILE-5). At phone/tablet size the app swaps
 * the four-region desktop grid for a pinned transport, the arrangement, and an **editor
 * sheet** over it that is dragged or thrown between three detents.
 *
 * The throw maths itself (velocity fitting, projection, snapping) is pure and covered by
 * unit tests in `test/detents.test.ts`; what is worth a browser is the wiring - that the
 * arrangement stays live behind the sheet, that each detent leaves the surfaces a usable
 * and *reachable* box, and that exactly one surface owns the shell's ⋮.
 *
 * The gesture layer (pinch, long-press) is MOBILE-2 and not covered here.
 */

const PHONE = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };
const TABLET = { width: 1024, height: 768 };

/** Dismiss the audio-start modal so the shell is interactive. */
async function dismissStart(page: Page) {
  const start = page.getByRole("button", { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0);
  }
}

const shell = (page: Page) => page.locator("[data-device-tier]");
const desktopRail = (page: Page) => page.locator('[class*="grid-area:rail"]');
const sheet = (page: Page) => page.getByTestId("editor-sheet");
/**
 * One of the sheet's Edit / Clips / Rack segments. Scoped, so it cannot match the desktop's
 * editor tabs. A `radio` rather than a `tab`: the switch is a `Segmented` now, which says
 * "these are the options and this is the one you are on" instead of three separate buttons.
 */
const segment = (page: Page, name: string) => sheet(page).getByRole("radio", { name });
const grabber = (page: Page) => page.getByRole("slider", { name: "Editor height" });
const trackHeader = (page: Page) => page.locator("[data-track-id]").first().locator("> div").first();
const detentOf = (page: Page) => sheet(page).getAttribute("data-detent");
const pads = (page: Page) => page.locator('[data-section="pads"]');
const pad = (page: Page, name: string) => pads(page).getByRole("button", { name, exact: true });

/** How far the pads hang below the sheet's own bottom edge. Anything over 0 is a clipped pad. */
const padsOverflow = (page: Page) =>
  page.evaluate(() => {
    const section = document.querySelector('[data-section="pads"]')!.getBoundingClientRect();
    const sheetBox = document.querySelector('[data-testid="editor-sheet"]')!.getBoundingClientRect();
    return Math.round(section.bottom - sheetBox.bottom);
  });

/** Press a pad and hold it, so the note has a length to record. */
async function holdPad(page: Page, name: string, ms: number) {
  const box = (await pad(page, name).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

/**
 * Step the sheet to a detent from the keyboard. Deterministic where a synthetic flick is
 * not - the velocity projection has its own unit tests, so the browser only needs to prove
 * that landing on a detent lays the surfaces out correctly.
 */
async function setDetent(page: Page, target: "peek" | "half" | "full") {
  const order = ["peek", "half", "full"];
  await grabber(page).focus();
  for (let step = 0; step < order.length; step++) {
    const current = await detentOf(page);
    if (current === target) break;
    await page.keyboard.press(order.indexOf(current!) < order.indexOf(target) ? "ArrowUp" : "ArrowDown");
  }
  await expect.poll(() => detentOf(page)).toBe(target);
  // Wait for the settle to *commit* rather than for a fixed time. `data-detent` flips the
  // instant the key is pressed, but the sheet is still mid-spring and laid out at
  // `height: 100%` with a transform until it comes to rest - so measuring on the attribute
  // alone reads the travelling size, and any fixed timeout is only as good as the longest
  // throw in the suite. Committed layout is the honest signal that it has landed.
  await expect.poll(() => sheet(page).evaluate((el) => (el as HTMLElement).style.height)).not.toBe("100%");
}

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

  test("swaps in the touch shell: the arrangement, with an editor sheet over it", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    await expect(shell(page)).toHaveAttribute("data-device-tier", "phone");
    // The desktop spine is gone entirely - this is a swap, not a reflow.
    await expect(desktopRail(page)).toHaveCount(0);

    // The arrangement is the background, not one option among four.
    await expect(page.locator('[class*="grid-area:timeline"]')).toBeVisible();
    await expect(sheet(page)).toBeVisible();
    // The tab bar it replaced is gone, and with it the "which surface am I on" question.
    await expect(page.getByRole("tablist", { name: "Views" })).toHaveCount(0);

    // One transport, above everything, and only one.
    await expect(page.getByRole("button", { name: "Record" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /play|stop/i }).first()).toBeVisible();
  });

  test("opens at Half, showing the track that is already selected", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    // There is always a track and a clip selected, so there is always something to edit and
    // showing it presumes nothing. Opening parked read as the editor having failed to open.
    await expect.poll(() => detentOf(page)).toBe("half");
    await expect(segment(page, "Edit")).toBeVisible();
    await expect(page.getByTestId("roll-scroll")).toBeVisible();

    // Still a sheet over a live arrangement, not a full-screen editor.
    const box = (await sheet(page).boundingBox())!;
    expect(box.height, "leaves the arrangement half the screen").toBeLessThan(PHONE.height * 0.7);
    expect(box.y + box.height, "and sits on the bottom edge").toBeGreaterThan(PHONE.height - 4);
  });

  test("parked is a lip, not a panel", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await setDetent(page, "peek");

    // Parked still names the track and offers the surfaces - that is what teaches the drag.
    await expect(segment(page, "Edit")).toBeVisible();
    const box = (await sheet(page).boundingBox())!;
    expect(box.height, "parked is a lip").toBeLessThan(PHONE.height * 0.25);
    expect(box.y + box.height, "and it sits on the bottom edge").toBeGreaterThan(PHONE.height - 4);
  });

  test("opens on the lane headers, not on beat 0", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    // Phone portrait scrolls its header column rather than sticking it, so beat 0 is the
    // *right* edge of the track names. Opening there hides them before you have touched
    // anything; the shared offset starts unset so the surface opens at its left edge.
    await expect.poll(() => page.getByTestId("arr-scroll").evaluate((el) => el.scrollLeft)).toBe(0);
    await expect(page.locator("[data-track-id]").first()).toBeVisible();
  });

  test("choosing a track while parked raises the sheet back to Half", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await setDetent(page, "peek");

    await page.getByRole("button", { name: "Library", exact: true }).tap();
    // The row's "+", not the row itself: a primary tap applies the instrument to the
    // selected track, where "+" adds a new one and selects it.
    await page.getByRole("button", { name: "Add a Sampler track", exact: true }).tap();
    await page.keyboard.press("Escape");

    // A new selection is a request to edit that track, so the sheet meets you at Half.
    await expect.poll(() => detentOf(page)).toBe("half");
    await expect(sheet(page).getByText("sampler", { exact: true })).toBeVisible();
  });

  test("tapping the already-selected lane raises it too", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await setDetent(page, "peek");

    // `selectTrack` is a no-op when the id already matches, so on a one-track project - the
    // state every new project starts in - watching the selection alone can never fire.
    await trackHeader(page).tap();
    await expect.poll(() => detentOf(page)).toBe("half");
  });

  test("scrolling the arrangement while parked is not a request to edit", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await setDetent(page, "peek");

    await page.getByTestId("arr-scroll").evaluate((el) => (el.scrollLeft = 400));
    await page.waitForTimeout(300);
    // Hence a click handler rather than a pointerdown: a scroll leaves no click behind.
    expect(await detentOf(page)).toBe("peek");
  });

  test("the roll centres on the notes at whatever height the sheet settles at", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    // Centred means the same content row sits at the middle of the viewport whatever the
    // viewport's height is - so this sum is the invariant, not the scroll offset.
    const centredOn = () =>
      page.getByTestId("roll-scroll").evaluate((el) => Math.round(el.scrollTop + el.clientHeight / 2));

    await setDetent(page, "half");
    const atHalf = await centredOn();
    await setDetent(page, "full");

    // Polled, not read once: the re-fit waits for the run of resizes to stop, so it lands a
    // beat after the sheet commits its layout. Reading immediately catches the pre-fit value.
    //
    // The roll is mounted while the sheet is parked (0px tall) and is held at the full
    // workspace height mid-throw, so fitting at either of those moments centres for a
    // viewport that is not the one you end up with. Only the settled height is true.
    await expect
      .poll(async () => Math.abs((await centredOn()) - atHalf), { message: `centred on ${atHalf} at Half` })
      .toBeLessThanOrEqual(2);
  });

  test("the roll stops re-centring once you have scrolled it yourself", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await setDetent(page, "full");

    const roll = page.getByTestId("roll-scroll");
    await roll.evaluate((el) => (el.scrollTop = el.scrollHeight - el.clientHeight));
    const parked = await roll.evaluate((el) => Math.round(el.scrollTop));

    await setDetent(page, "half");
    // Re-fitting on every resize is what keeps Half honest; handing over on the first real
    // scroll is what keeps it from overriding you afterwards.
    expect(await roll.evaluate((el) => Math.round(el.scrollTop))).toBe(parked);
  });

  test("picking a surface raises the sheet, so nothing is more than one tap away", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await setDetent(page, "peek");

    await segment(page, "Edit").tap();
    await expect.poll(() => detentOf(page)).toBe("half");
    await expect(page.getByTestId("roll-scroll")).toBeVisible();
  });

  test("each segment hosts one surface, and the transport survives switching", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    await segment(page, "Edit").tap();
    await expect(page.getByTestId("roll-scroll")).toBeVisible();

    await segment(page, "Clips").tap();
    await expect(page.getByRole("button", { name: /^\+ Clip$/ })).toBeVisible();

    await segment(page, "Rack").tap();
    await expect(page.getByRole("button", { name: "Save as patch" })).toBeVisible();

    await expect(page.getByRole("button", { name: "Record" })).toHaveCount(1);
  });

  /**
   * The bug that made the sheet unusable on a device: it was laid out at the full workspace
   * height and merely translated down, so at Half the roll's scroller was ~800px tall inside
   * a ~400px window. It never overflowed, so it never scrolled, and every row below the fold
   * was unreachable. "Transform while moving, commit layout on settle" is what fixes it.
   */
  test("every detent leaves the editor a box that fits on screen and scrolls", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    for (const detent of ["half", "full"] as const) {
      await setDetent(page, detent);
      await segment(page, "Edit").tap();
      // Wait on the surface itself rather than measuring into a re-render.
      await expect(page.getByTestId("roll-scroll")).toBeVisible();

      const sheetBox = (await sheet(page).boundingBox())!;
      expect(sheetBox.y + sheetBox.height, `sheet bottom at ${detent}`).toBeLessThanOrEqual(PHONE.height + 1);

      const roll = await page.getByTestId("roll-scroll").evaluate((el) => ({
        bottom: Math.round(el.getBoundingClientRect().bottom),
        canScroll: el.scrollHeight > el.clientHeight,
      }));
      expect(roll.bottom, `roll bottom at ${detent}`).toBeLessThanOrEqual(PHONE.height);
      expect(roll.canScroll, `roll scrolls at ${detent}`).toBe(true);
    }
  });

  test("the arrangement stays behind the sheet, and gets the band above it", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    const timeline = page.locator('[class*="grid-area:timeline"]');

    await setDetent(page, "peek");
    const parked = (await timeline.boundingBox())!;
    await setDetent(page, "full");
    const raised = (await timeline.boundingBox())!;

    // It is not merely occluded - it lays out in what is left, so its own scrollers stay
    // on screen rather than sitting underneath the sheet.
    expect(raised.height, "the arrangement gives up height to the sheet").toBeLessThan(parked.height);
    expect(raised.height, "but never disappears").toBeGreaterThan(40);
    const sheetBox = (await sheet(page).boundingBox())!;
    expect(raised.y + raised.height).toBeLessThanOrEqual(sheetBox.y + 2);
  });

  test("tapping a track selects it without moving the sheet - it is not modal", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await setDetent(page, "half");

    await trackHeader(page).tap();

    // The whole reason this cannot be an off-the-shelf bottom sheet: the arrangement behind
    // stays live, so selection never has to imply navigation.
    await expect.poll(() => detentOf(page)).toBe("half");
    await expect(page.locator('[class*="grid-area:timeline"]')).toBeVisible();
  });

  test("the arrangement keeps its scroll position when the sheet moves", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    const scroller = () => page.getByTestId("arr-scroll");

    await scroller().evaluate((el) => (el.scrollLeft = 500));
    await expect.poll(() => scroller().evaluate((el) => el.scrollLeft)).toBe(500);

    // Raising the sheet resizes the arrangement, which is exactly when a restored offset
    // is easiest to lose.
    await setDetent(page, "full");
    await setDetent(page, "peek");
    await expect.poll(() => scroller().evaluate((el) => el.scrollLeft)).toBe(500);
  });

  test("scrolling the arrangement back to the start does not snap forward again", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    const scroller = page.getByTestId("arr-scroll");

    // The shared view offset used to floor at beat 0 and get pushed back into the DOM, so
    // scrolling left into the header gutter yanked you forward to the gutter's edge.
    await scroller.evaluate((el) => (el.scrollLeft = 500));
    await scroller.evaluate((el) => (el.scrollLeft = 0));
    await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBe(0);

    await scroller.evaluate((el) => (el.scrollLeft = 60));
    await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBe(60);
  });

  test("dragging the header moves the sheet and it settles on a detent", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await setDetent(page, "peek");

    // The whole header is the drag surface, not just the grabber pill.
    const header = (await sheet(page).boundingBox())!;
    const startX = header.x + header.width / 2;
    const startY = header.y + 20;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    for (let step = 1; step <= 8; step++) await page.mouse.move(startX, startY - step * 40);
    await page.mouse.up();

    // Dragged well up and released: it lands on a detent rather than wherever it was let go.
    await expect.poll(() => detentOf(page)).not.toBe("peek");
    await page.waitForTimeout(500);
    const box = (await sheet(page).boundingBox())!;
    expect(box.y + box.height, "still anchored to the bottom edge").toBeGreaterThan(PHONE.height - 4);
  });

  test("the arrangement pins the selected lane once the sheet covers it", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await trackHeader(page).tap();
    await setDetent(page, "full");

    // At Full only a sliver of arrangement is left, and it should be the lane being edited -
    // the job LaneStrip used to do from a second copy of the grid.
    const pinned = await page.getByTestId("arr-scroll").evaluate((el) => {
      const row = el.querySelector("[data-track-id]") as HTMLElement | null;
      if (!row) return null;
      const offset = row.offsetTop - el.scrollTop;
      return { visible: offset >= 0 && offset < el.clientHeight, band: el.clientHeight };
    });
    expect(pinned?.visible, "the selected lane is in view").toBe(true);
    expect(pinned?.band, "and the band really is a sliver").toBeLessThan(PHONE.height * 0.3);
  });

  test("undo and redo are in the top bar, and tempo has moved to the overflow menu", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    const undo = page.getByRole("button", { name: "Undo" });
    const redo = page.getByRole("button", { name: "Redo" });
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();

    // Tempo gave up its slot for them; it lives in the menu now, as a field rather than a
    // list of presets - a range of 20-300 cannot honestly be a submenu, and the curated
    // subset it used to be made the phone less capable than the desktop field it stood in for.
    await expect(page.getByRole("spinbutton", { name: /tempo/i })).toHaveCount(0);
    await openOverflow(page);
    const tempo = page.getByRole("spinbutton", { name: "Tempo" });
    await expect(tempo).toBeVisible();

    // A value no preset list would have offered.
    await tempo.fill("173");
    await expect(undo).toBeEnabled();
    await page.keyboard.press("Escape");
    await openOverflow(page);
    await expect(page.getByRole("spinbutton", { name: "Tempo" })).toHaveValue("173");

    // ...and the nudge buttons, so changing it by one costs no keyboard.
    await page.getByRole("button", { name: "Tempo up" }).click();
    await expect(page.getByRole("spinbutton", { name: "Tempo" })).toHaveValue("174");
    await page.keyboard.press("Escape");

    await undo.tap();
    await expect(redo).toBeEnabled();
  });

  /**
   * The menu is one list of every mounted surface's controls, not the front-most one's. At
   * Half you are looking at the timeline and the roll at once, so a menu that followed focus
   * was hiding controls for a panel in plain view - and hiding count-in and groove behind
   * parking the sheet at any detent at all (MOBILE-11).
   */
  test("the overflow menu holds every surface's controls at once, under headings", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await segment(page, "Edit").tap();
    await setDetent(page, "half");

    await openOverflow(page);
    const menu = page.getByRole("menu").first();
    await expect(menu.getByText("Arrangement", { exact: true })).toBeVisible();
    await expect(menu.getByText("Notes", { exact: true })).toBeVisible();
    await expect(menu.getByText("Project", { exact: true })).toBeVisible();

    // The arrangement's, the roll's and the project's, all reachable without changing detent.
    await expect(page.getByRole("menuitem", { name: "Add group" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Count-in" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Quantize", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitemradio", { name: /Metronome/i })).toBeVisible();

    // Both surfaces offer a "Snap to grid", which is exactly why the headings are there.
    await expect(page.getByRole("menuitemradio", { name: /Snap to grid/i })).toHaveCount(2);

    // And a row sits under the heading it belongs to: count-in and groove are project
    // settings, so they are in the project's group and not the arrangement's (MOBILE-11).
    const order = await menu.evaluate((popover) =>
      [...popover.children].map((row) => row.textContent?.replace(/[✓◂▸]/g, "").trim()),
    );
    // The headings are uppercased in CSS, so the text is still title case here.
    const groupOf = (row: string) =>
      order
        .slice(0, order.indexOf(row))
        .filter((entry) => ["Arrangement", "Notes", "Project"].includes(entry ?? ""))
        .pop();
    expect(groupOf("Add group")).toBe("Arrangement");
    expect(groupOf("Velocity lane")).toBe("Notes");
    expect(groupOf("Count-in")).toBe("Project");
    expect(groupOf("Groove")).toBe("Project");
  });

  test("beats per bar is a field too, so the whole 1-32 range is reachable", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    await openOverflow(page);
    await page.getByRole("menuitem", { name: /Meter/ }).click();
    const beats = page.getByRole("spinbutton", { name: "Beats per bar" });
    await expect(beats).toBeVisible();
    // 11/4 was not on the old preset list, and is inside the schema's range.
    await beats.fill("11");
    await expect(page.getByRole("menuitem", { name: "Meter · 11/4" })).toBeVisible();
  });

  test("the roll has no toolbar of its own - its controls are in the shell's menu", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await segment(page, "Edit").tap();
    await expect(page.getByTestId("roll-scroll")).toBeVisible();

    // The toolbar row is hidden, so its label is not shown...
    await expect(page.getByText("Piano roll", { exact: true })).toBeHidden();

    // ...and the controls turn up in the one overflow menu, above the project's. Zoom folds
    // into a submenu there: it is a fallback for the pinch gesture, and three surfaces share
    // this list, so a row it does not spend is a row another surface can have.
    await openOverflow(page);
    await expect(page.getByRole("menuitemradio", { name: /Snap to grid/i }).first()).toBeVisible();
    await expect(page.getByRole("menuitemradio", { name: /Metronome/i })).toBeVisible();
    await page.getByRole("menuitem", { name: "Zoom", exact: true }).last().click();
    await expect(page.getByRole("menuitem", { name: "Taller rows" })).toBeVisible();
  });

  /**
   * A group is present because its surface is *mounted*, not because it is in front - which
   * is the whole simplification. Switching to the rack really does unmount the roll, so its
   * group goes: those rows act on a panel that is not there.
   */
  test("a surface's group comes and goes with the surface, not with the detent", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    // Parked, with the editor behind the sheet: both groups, because both are mounted.
    await setDetent(page, "peek");
    await openOverflow(page);
    await expect(page.getByRole("menuitem", { name: "Add group" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Quantize", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    // The rack replaces the roll, so the Notes group leaves with it - the arrangement's stays.
    await setDetent(page, "half");
    await segment(page, "Rack").tap();
    await openOverflow(page);
    await expect(page.getByRole("menuitem", { name: "Add group" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Quantize", exact: true })).toHaveCount(0);
    await expect(page.getByRole("menu").first().getByText("Notes", { exact: true })).toHaveCount(0);
  });

  test("the overflow menu reflects the surface's state, not the shell's last render", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await segment(page, "Edit").tap();
    const velocity = () => page.getByRole("menuitemradio", { name: /Velocity lane/i });

    // Off to start with on touch, where the lane costs a row of pads.
    await openOverflow(page);
    await expect(velocity()).toHaveAttribute("aria-checked", "false");
    await velocity().click();

    // The surface's controls are published as a getter and the shell is *not* re-rendered
    // when the surface's own state changes, so an items array captured at the shell's last
    // render would still show this row unticked. `Menu` reads the getter while open instead.
    await openOverflow(page);
    await expect(velocity()).toHaveAttribute("aria-checked", "true");
  });

  test("the library opens as a sheet from the left and closes again", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    const panel = page.getByRole("dialog", { name: "Library" });
    await expect(panel).toHaveCount(0); // lazily mounted: never opened, never built

    await page.getByRole("button", { name: "Library", exact: true }).tap();
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("navigation", { name: "Library views" })).toBeVisible();
    await expect(panel.getByText("Subtractive")).toBeVisible();

    await page.keyboard.press("Escape");
    // Still mounted (so reopening is instant) but inert and out of reach.
    await expect(panel).toHaveAttribute("inert", "");
  });

  test("picking from the library closes it, so you can see what it just did", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    const panel = page.getByRole("dialog", { name: "Library" });
    const sheetSubtitle = sheet(page).getByText("subtractive", { exact: true });
    await expect(sheetSubtitle).toBeVisible();

    await page.getByRole("button", { name: "Library", exact: true }).tap();
    await panel.getByRole("button", { name: "FM", exact: true }).tap();

    // The sheet it changed is behind the library on a phone, so the library gets out of the
    // way: without this the instrument swaps under a full-screen panel and nothing happens.
    await expect(panel).toHaveAttribute("inert", "");
    await expect(sheet(page).getByText("fm", { exact: true })).toBeVisible();
  });

  test("the pads sit under the roll, in the key they say they are in", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    // In C major the in-scale pads are the white keys, closing on the octave above - the
    // closing tonic is what gives the leading tone a gap to sit in.
    const names = await pads(page)
      .locator("[data-pitch]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    expect(names).toEqual(["C#3", "D#3", "F#3", "G#3", "A#3", "C3", "D3", "E3", "F3", "G3", "A3", "B3", "C4"]);
    // Under the roll, not beside it: you play a phrase and watch it land without moving.
    const roll = (await page.getByTestId("roll-scroll").boundingBox())!;
    expect((await pads(page).boundingBox())!.y).toBeGreaterThan(roll.y);
  });

  test("playing the pads records a take - the phone can capture, not just arrange", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    // Count-in is a project setting and sits with them, reachable with the sheet up over the
    // arrangement whose toolbar menu used to be its only home on touch (MOBILE-11).
    await openOverflow(page);
    await page.getByRole("menuitem", { name: "Count-in" }).click();
    await page.getByRole("menuitemradio", { name: "No count-in" }).click();

    const record = page.getByRole("button", { name: "Record", exact: true });
    await record.tap();
    await expect(record).toHaveAttribute("aria-pressed", "true");

    // Held with the mouse rather than tapped: a tap has no duration, and a note's duration
    // is the thing being captured.
    await holdPad(page, "C3", 140);
    await holdPad(page, "E3", 140);
    await expect(page.getByTestId("ghost-note")).toHaveCount(2);

    await record.tap();
    await expect(record).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("lane").getByText("Take 1")).toBeVisible();
  });

  test("sliding sideways runs the notes under your finger, without latching them", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    const from = (await pad(page, "C3").boundingBox())!;
    const to = (await pad(page, "E3").boundingBox())!;
    const lane = from.y + from.height / 2;
    await page.mouse.move(from.x + from.width / 2, lane);
    await page.mouse.down();
    await expect(pad(page, "C3")).toHaveAttribute("aria-pressed", "true");

    // Along the row, so the axis lock reads it as a slide rather than as the sustain drag.
    await page.mouse.move(to.x + to.width / 2, lane, { steps: 8 });
    await expect(pad(page, "E3"), "the note follows the finger").toHaveAttribute("aria-pressed", "true");
    await expect(pad(page, "C3"), "and the one it left goes quiet").toHaveAttribute("aria-pressed", "false");

    // A slide never latches: it committed to the other axis on its first 8px, so letting go
    // leaves nothing sounding however far down the row it wandered.
    await page.mouse.up();
    await expect(pad(page, "E3")).toHaveAttribute("aria-pressed", "false");
  });

  test("the pads stay under whichever surface is showing, so you can play while you tweak", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    for (const name of ["Clips", "Rack"]) {
      await segment(page, name).tap();
      await expect(pads(page).locator("[data-pad-row]")).toHaveCount(1);
      expect(await padsOverflow(page)).toBeLessThanOrEqual(0);
    }

    // And they still play from there, which is the point: hearing what a device does to a
    // note without leaving the device to play one.
    const box = (await pad(page, "C3").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(pad(page, "C3")).toHaveAttribute("aria-pressed", "true");
    await page.mouse.up();
    await expect(pad(page, "C3")).toHaveAttribute("aria-pressed", "false");
  });

  test("dragging down off a pad latches it, and the next note lets it go", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    const box = (await pad(page, "C3").boundingBox())!;
    // From the pad's top edge, so a 50px drag is still on screen at the bottom of the sheet.
    await page.mouse.move(box.x + box.width / 2, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 54, { steps: 4 });
    await page.mouse.up();
    await expect(pad(page, "C3"), "still sounding with nothing holding it").toHaveAttribute("aria-pressed", "true");

    // Playing a new note releases the held ones - the simple rule, shipped knowing you can
    // then only hold *instead of* playing.
    await pad(page, "E3").tap();
    await expect(pad(page, "C3")).toHaveAttribute("aria-pressed", "false");
  });

  test("the octave range grows in whole rows, and the roll grows with the sheet too", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await setDetent(page, "half");

    const grow = page.getByRole("button", { name: /More octaves/ });
    const rows = () => pads(page).locator("[data-pad-row]").count();
    const rollHeight = async () => (await page.getByTestId("roll-scroll").boundingBox())!.height;
    expect(await rows()).toBe(1);

    /** Ask for octaves until the sheet stops giving them, and report what it settled on. */
    const fill = async () => {
      for (let press = 0; press < 10 && !(await grow.isDisabled()); press++) await grow.tap();
      // The part only a browser can tell you: what it stopped at still fits inside the
      // sheet rather than under its bottom edge.
      expect(await padsOverflow(page)).toBeLessThanOrEqual(0);
      return { rows: await rows(), roll: await rollHeight() };
    };

    const half = await fill();
    await setDetent(page, "full");
    const full = await fill();

    // Both surfaces grow, which is the point: the pads take a *share* of the editor, so
    // raising the sheet buys rows and notes rather than spending it all on pads. A flat
    // reserve for the roll left it the same sliver at every detent, and a ratio is what says
    // "materially more" - the bug this guards is a roll that comes back the same size.
    //
    // Deliberately not an absolute pixel figure. Rows fit in whole steps, so how much room is
    // left over for the roll depends on the pad row height, and an absolute threshold silently
    // encodes that: shortening the accidentals by 4px packs one more row into the same share
    // and takes the difference out of exactly this number.
    expect(full.rows).toBeGreaterThan(half.rows);
    expect(full.roll).toBeGreaterThan(half.roll * 1.1);
    expect(half.roll, "the roll is readable even at Half, with the pads filled").toBeGreaterThan(120);

    // The count is a request, not a promise: dropping back gives the rows away and raising
    // the sheet again honours what was asked for, without asking again.
    await setDetent(page, "half");
    expect(await rows()).toBe(half.rows);
    await setDetent(page, "full");
    expect(await rows()).toBe(full.rows);
  });

  test("a long submenu stays on screen instead of running off the bottom", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    // The pads' key menu sits at the bottom of the sheet and its Key list is twelve rows,
    // which opened level with its own row would put most of them under the fold.
    await page.getByRole("button", { name: "Key and scale" }).tap();
    await page.getByRole("menuitem", { name: "Key" }).click();
    const submenu = page.getByRole("menu").last(); // the flyout, nested inside the popover
    const box = (await submenu.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(PHONE.height);
  });

  test("the agent shares the library panel rather than opening a second one", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    const composer = page.getByRole("textbox", { name: /message the agent/i });
    const librarySearch = page.getByRole("searchbox", { name: /search the library/i });

    // Not in the top bar any more: a phone has one bar for the whole app, and the agent is
    // the control you open deliberately rather than reach for mid-gesture.
    await expect(page.getByRole("button", { name: "Agent" })).toHaveCount(0);

    await page.getByRole("button", { name: "Library" }).tap();
    await expect(librarySearch).toBeVisible();

    // It fills the library's own column - there is no second sheet over the top of it.
    await page.getByRole("button", { name: "Agent" }).tap();
    await expect(composer).toBeVisible();
    await expect(librarySearch).toBeHidden();
    await expect(page.getByRole("dialog", { name: "Agent" })).toHaveCount(0);

    // Back to a library view, and the conversation survives it: an agent run is interruptible
    // and long-lived, so looking something up must not throw away what is in flight.
    // `includeHidden`, because a hidden subtree is out of the accessibility tree and the
    // default `getByRole` would report it as gone when it is only out of sight.
    await page.getByRole("button", { name: "Instruments" }).tap();
    await expect(librarySearch).toBeVisible();
    await expect(composer).toBeHidden();
    await expect(page.getByRole("textbox", { name: /message the agent/i, includeHidden: true })).toHaveCount(1);
  });
});

test.describe("phone, landscape", () => {
  test.use({ viewport: LANDSCAPE, hasTouch: true, isMobile: true });

  test("gets its own detents, because it is wide but very short", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    await setDetent(page, "full");
    // Of the *workspace*, which is what a detent is a fraction of - the viewport also
    // holds the top bar, so measuring against that folds in a constant and tells you less.
    const share = await sheet(page).evaluate((el) => el.clientHeight / (el.parentElement?.clientHeight ?? 1));
    // Its Full covers more than a portrait phone's 0.86, or the sliver left over on a
    // ~390px-tall screen would be too small to be worth leaving.
    expect(share).toBeGreaterThan(0.9);
  });

  test("needs no special case: the editor has the sheet to itself", async ({ page }) => {
    // A rack taller than the viewport used to squeeze the roll to nothing when the two
    // shared a surface. They no longer do.
    await page.addInitScript(() => localStorage.setItem("web-daw:devices-height", "600"));
    await page.goto("/");
    await dismissStart(page);
    await setDetent(page, "full");
    await segment(page, "Edit").tap();

    // The pads do share it, and at ~390px tall they take most of what the roll had. That is
    // what their disclosure is for: collapsing them hands the height straight back.
    await pads(page).getByRole("button", { expanded: true }).tap();
    const roll = (await page.getByTestId("roll-scroll").boundingBox())!;
    expect(roll.height, "the roll has the sheet to itself").toBeGreaterThan(120);
    expect(roll.width, "and the full width").toBeGreaterThan(700);
  });

  test("the velocity lane starts folded away on touch, and the menu brings it back", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await setDetent(page, "full");
    await segment(page, "Edit").tap();

    // 56px of lane is a whole row of pads, and velocity still reads as note fill strength -
    // so on touch the lane is off until it is asked for.
    const lane = page.getByTitle("Velocity - drag a bar");
    await expect(lane).toBeHidden();
    await openOverflow(page);
    await page.getByRole("menuitemradio", { name: /Velocity lane/i }).click();
    await expect(lane).toBeVisible();
  });

  test("says there is no room to play rather than showing half a pad", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    // ~133px of editor at Half is not one row of pads plus the controls to drive it, however
    // the numbers are shuffled. Full is, once the controls fold into the section's header.
    await setDetent(page, "half");
    await expect(pads(page)).toContainText("Raise the sheet to play");
    await expect(pads(page).locator("[data-pitch]")).toHaveCount(0);

    await setDetent(page, "full");
    await expect(pads(page).locator("[data-pad-row]")).toHaveCount(1);
    expect(await padsOverflow(page)).toBeLessThanOrEqual(0);
    // Landscape is short but wide, so the header has the width to take the controls.
    await expect(pads(page).getByRole("button", { name: "Key and scale" })).toBeVisible();
  });
});

test.describe("tablet", () => {
  test.use({ viewport: TABLET, hasTouch: true, isMobile: true });

  test("gets the touch shell too, tiered as tablet", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await expect(shell(page)).toHaveAttribute("data-device-tier", "tablet");
    await expect(sheet(page)).toBeVisible();
    await expect(desktopRail(page)).toHaveCount(0);
  });

  test("docks the library beside the workspace, and the agent shares that column", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    // Already open: a tablet starts with the library docked, so there is nothing to tap.
    const library = page.getByRole("complementary", { name: "Library" });
    await expect(library).toBeVisible();
    // Docked, not a sheet: no scrim, and it sits beside the workspace rather than over it.
    await expect(page.getByRole("dialog", { name: "Library" })).toHaveCount(0);

    const libraryBox = (await library.boundingBox())!;
    expect(libraryBox.x, "library on the left").toBeLessThan(TABLET.width / 2);

    // The agent takes over that same column rather than claiming a second one on the right.
    // A tablet has the width for two, but not for two *and* a workspace worth editing in.
    await page.getByRole("button", { name: "Agent" }).tap();
    await expect(page.getByRole("textbox", { name: /message the agent/i })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Agent" })).toHaveCount(0);

    const withAgentBox = (await library.boundingBox())!;
    expect(withAgentBox.x, "still the left column").toBe(libraryBox.x);
    expect(withAgentBox.width, "and the same width").toBe(libraryBox.width);
  });

  test("opens with the library already docked, and the toggle still closes it", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    const library = page.getByRole("complementary", { name: "Library" });
    await expect(library).toBeVisible();

    // Picking does *not* close it here, unlike the phone's sheet: docked, it is beside the
    // track it changes rather than over it, so there is nothing to get out of the way of and
    // picking several things in a row keeps working.
    await library.getByRole("button", { name: "FM", exact: true }).tap();
    await expect(sheet(page).getByText("fm", { exact: true })).toBeVisible();
    await expect(library).toBeVisible();

    await page.getByRole("button", { name: "Library", exact: true }).tap();
    await expect(library).toHaveCount(0);
  });

  test("keeps the sheet over the workspace, not under the docked panels", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    const library = page.getByRole("complementary", { name: "Library" });
    await expect(library).toBeVisible();
    const libraryBox = (await library.boundingBox())!;
    const sheetBox = (await sheet(page).boundingBox())!;

    // The sheet belongs to the workspace column: a docked panel owns its full height, so
    // the sheet must start where the panel ends rather than sliding underneath it.
    expect(sheetBox.x, "sheet starts after the docked library").toBeGreaterThanOrEqual(
      libraryBox.x + libraryBox.width - 1,
    );
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("keeps the four-region grid, its own toolbars and no editor sheet", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await expect(shell(page)).toHaveCount(0);
    await expect(desktopRail(page)).toBeVisible();
    await expect(sheet(page)).toHaveCount(0);
  });

  test("a window too narrow for the grid falls back to the touch shell", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await expect(desktopRail(page)).toBeVisible();

    await page.setViewportSize({ width: 700, height: 900 });
    await expect(shell(page)).toBeVisible();
    await expect(sheet(page)).toBeVisible();
    await expect(desktopRail(page)).toHaveCount(0);
  });
});
