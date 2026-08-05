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
/** One of the sheet's Edit / Clips / Rack segments. Scoped, so it cannot match the desktop's editor tabs. */
const segment = (page: Page, name: string) => sheet(page).getByRole("tab", { name });
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

    // Tempo gave up its slot for them; it lives in the menu now.
    await expect(page.getByRole("spinbutton", { name: /tempo/i })).toHaveCount(0);
    await openOverflow(page);
    await expect(page.getByRole("menuitem", { name: "Tempo" })).toBeVisible();
    await page.keyboard.press("Escape");

    await openOverflow(page);
    await page.getByRole("menuitem", { name: "Tempo" }).click();
    await page.getByRole("menuitemradio", { name: "140 BPM" }).click();
    await expect(undo).toBeEnabled();

    await undo.tap();
    await expect(undo).toBeDisabled();
    await expect(redo).toBeEnabled();
  });

  test("the roll has no toolbar of its own - its controls are in the shell's menu", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await segment(page, "Edit").tap();
    await expect(page.getByTestId("roll-scroll")).toBeVisible();

    // The toolbar row is hidden, so its label is not shown...
    await expect(page.getByText("Piano roll", { exact: true })).toBeHidden();

    // ...and the controls turn up in the one overflow menu, above the project's.
    await openOverflow(page);
    await expect(page.getByRole("menuitemradio", { name: /Snap to grid/i })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Zoom in/i })).toBeVisible();
    await expect(page.getByRole("menuitemradio", { name: /Metronome/i })).toBeVisible();
  });

  /**
   * Un-tabbing meant the arrangement and the editor are mounted *at the same time*, so both
   * would publish to the shell's ⋮ and whichever mounted later would silently win. The
   * detent decides instead: parked, the arrangement keeps its own controls.
   */
  test("the overflow menu follows whichever surface is in front", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    // Parked: the timeline's own options, even though the editor is mounted behind the sheet.
    await setDetent(page, "peek");
    await openOverflow(page);
    await expect(page.getByRole("menuitem", { name: "Add group" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Raised: the roll's instead.
    await setDetent(page, "half");
    await segment(page, "Edit").tap();
    await openOverflow(page);
    await expect(page.getByRole("menuitem", { name: /Quantize/i }).first()).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Add group" })).toHaveCount(0);
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

    // Count-in belongs to the arrangement, so it is reachable while the sheet is parked.
    await setDetent(page, "peek");
    await openOverflow(page);
    await page.getByRole("menuitem", { name: "Count-in" }).click();
    await page.getByRole("menuitemradio", { name: "No count-in" }).click();
    await setDetent(page, "half");

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

  test("the octave range grows in whole rows, and stops where the sheet does", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await setDetent(page, "full");

    const grow = page.getByRole("button", { name: /More octaves/ });
    const rows = () => pads(page).locator("[data-pad-row]").count();
    expect(await rows()).toBe(1);
    for (let press = 0; press < 8 && !(await grow.isDisabled()); press++) await grow.tap();

    // It stops at four rows, and - the part only a browser can tell you - what it stopped at
    // still fits inside the sheet rather than under its bottom edge.
    expect(await rows()).toBe(4);
    expect(await padsOverflow(page)).toBeLessThanOrEqual(0);

    // Parking the sheet takes the room away, so the rows go with it; the count is a request,
    // not a promise, and raising the sheet again honours it.
    await setDetent(page, "half");
    expect(await rows()).toBeLessThan(4);
    expect(await padsOverflow(page)).toBeLessThanOrEqual(0);
    await setDetent(page, "full");
    expect(await rows()).toBe(4);
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

  test("the agent opens as a sheet from the right and stays mounted when closed", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    const panel = page.getByRole("dialog", { name: "Agent" });
    await page.getByRole("button", { name: "Agent" }).tap();
    await expect(panel).toBeVisible();

    await page.keyboard.press("Escape");
    // Deliberately not unmounted: an interruptible agent run must survive a close.
    await expect(panel).toHaveCount(1);
    await expect(panel).toHaveAttribute("inert", "");
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

  test("docks the library and agent beside the workspace instead of over it", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    // Already open: a tablet starts with the library docked, so there is nothing to tap.
    const library = page.getByRole("complementary", { name: "Library" });
    await expect(library).toBeVisible();
    // Docked, not a sheet: no scrim, and it sits beside the workspace rather than over it.
    await expect(page.getByRole("dialog", { name: "Library" })).toHaveCount(0);

    await page.getByRole("button", { name: "Agent" }).tap();
    const agent = page.getByRole("complementary", { name: "Agent" });
    await expect(agent).toBeVisible();

    const libraryBox = (await library.boundingBox())!;
    const agentBox = (await agent.boundingBox())!;
    expect(libraryBox.x, "library on the left").toBeLessThan(TABLET.width / 2);
    expect(agentBox.x, "agent on the right").toBeGreaterThan(TABLET.width / 2);
  });

  test("opens with the library already docked, and the toggle still closes it", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);

    const library = page.getByRole("complementary", { name: "Library" });
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
