import { test, expect, type Page } from '@playwright/test';

/**
 * Editable arrangement timeline: the default project seeds one instrument track
 * with a single placement of its clip at the start, so one block is visible on
 * load. Exercises the mouse gestures - create (drag empty lane), move (drag body),
 * split (double-click), delete (select + Delete), mark (click empty lane) - and the
 * arrangement ruler's loop-region handle, then confirms a placed clip survives a
 * reload (it lives in the project snapshot). Each gesture records a single
 * two-voice feed entry.
 */

// A wide, tall viewport so the lanes have room to the right of the seed block and
// the timeline panel is not cramped.
test.use({ viewport: { width: 1320, height: 900 } });

async function dismissStart(page: Page) {
  const start = page.getByRole('button', { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0); // wait for the start overlay to clear (engine.start awaits worklets)
  }
}

const placements = (page: Page) => page.getByTestId('placement');

/** Zoom the arrangement out a few notches so blocks are compact and empty lane shows. */
async function zoomOut(page: Page) {
  const btn = page.getByTitle('Zoom out', { exact: true });
  for (let i = 0; i < 3; i++) await btn.click();
}

test('place, move, split and delete clips in the arrangement', async ({ page }) => {
  await page.goto('/');
  await dismissStart(page);
  await zoomOut(page);

  // The seed track shows exactly one placement on load.
  await expect(placements(page)).toHaveCount(1);

  // Drag across the empty lane to the right of the seed -> create + place a clip.
  const seed = (await placements(page).first().boundingBox())!;
  const y = seed.y + seed.height / 2;
  await page.mouse.move(seed.x + seed.width + 40, y);
  await page.mouse.down();
  await page.mouse.move(seed.x + seed.width + 160, y, { steps: 8 });
  await page.mouse.up();
  await expect(placements(page)).toHaveCount(2);
  await expect(page.getByText('Placed clip')).toBeVisible();

  // Drag the seed block's body to the right -> move (one "Moved clip" entry).
  const before = (await placements(page).first().boundingBox())!;
  await page.mouse.move(before.x + 6, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + 90, before.y + before.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByText('Moved clip')).toBeVisible();
  await expect(placements(page)).toHaveCount(2);
  expect((await placements(page).first().boundingBox())!.x).toBeGreaterThan(before.x);

  // Double-click a block at its middle -> split into two windows over the clip.
  const toSplit = (await placements(page).first().boundingBox())!;
  await page.mouse.dblclick(toSplit.x + toSplit.width / 2, toSplit.y + toSplit.height / 2);
  await expect(page.getByText('Split clip')).toBeVisible();
  await expect(placements(page)).toHaveCount(3);

  // Select a block and press Delete -> remove it from the arrangement.
  await placements(page).first().click();
  await page.keyboard.press('Delete');
  await expect(page.getByText('Removed clip from arrangement')).toBeVisible();
  await expect(placements(page)).toHaveCount(2);
});

test('copy and paste a placement', async ({ page }) => {
  await page.goto('/');
  await dismissStart(page);
  await zoomOut(page);

  await expect(placements(page)).toHaveCount(1);
  await placements(page).first().click(); // select the seed placement
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('ControlOrMeta+v');
  await expect(placements(page)).toHaveCount(2);
});

test('drag on an empty lane creates a new empty clip sized to the drag', async ({ page }) => {
  await page.goto('/');
  await dismissStart(page);
  await zoomOut(page);

  // Drag across empty lane to the right of the seed block.
  const seed = (await placements(page).first().boundingBox())!;
  const y = seed.y + seed.height / 2;
  await page.mouse.move(seed.x + seed.width + 40, y);
  await page.mouse.down();
  await page.mouse.move(seed.x + seed.width + 200, y, { steps: 10 });
  await page.mouse.up();

  await expect(page.getByText('New clip')).toBeVisible(); // a fresh clip was created
  await expect(placements(page)).toHaveCount(2); // and placed
});

test('a track can be renamed inline', async ({ page }) => {
  await page.goto('/');
  await dismissStart(page);

  const name = page.getByTestId('arr-scroll').getByText('Subtractive 1', { exact: true });
  await name.dblclick();
  const input = page.getByTestId('arr-scroll').getByRole('textbox');
  await input.fill('My Bass');
  await input.press('Enter');
  await expect(page.getByTestId('arr-scroll').getByText('My Bass')).toBeVisible();
});

test('drag a clip from the rail onto its lane places it', async ({ page }) => {
  await page.goto('/');
  await dismissStart(page);

  await expect(placements(page)).toHaveCount(1); // the seed placement of clip A

  // HTML5 drag-and-drop: dispatch dragstart on the chip, then dragover + drop on
  // the lane sharing one DataTransfer (Playwright's mouse drag does not drive
  // native DnD reliably). The drop x sets the beat.
  const chip = page.getByTitle(/drag onto the lane/).first();
  const lane = page.getByTestId('lane').first();
  const box = (await lane.boundingBox())!;
  const x = box.x + 420;
  const y = box.y + box.height / 2;
  await page.evaluate(
    ([src, tgt, px, py]) => {
      const dt = new DataTransfer();
      const opts = (cx: number, cy: number) => ({ bubbles: true, cancelable: true, dataTransfer: dt, clientX: cx, clientY: cy });
      (src as Element).dispatchEvent(new DragEvent('dragstart', opts(0, 0)));
      (tgt as Element).dispatchEvent(new DragEvent('dragover', opts(px as number, py as number)));
      (tgt as Element).dispatchEvent(new DragEvent('drop', opts(px as number, py as number)));
      (src as Element).dispatchEvent(new DragEvent('dragend', opts(0, 0)));
    },
    [await chip.elementHandle(), await lane.elementHandle(), x, y] as const,
  );

  await expect(placements(page)).toHaveCount(2);
  await expect(page.getByText('Placed clip')).toBeVisible();
});

test('a group can be renamed inline', async ({ page }) => {
  await page.goto('/');
  await dismissStart(page);

  // The seed subtractive track is filed into the "Synths" group.
  const group = page.getByTestId('arr-scroll').getByText('Synths', { exact: true });
  await group.dblclick();
  const input = page.getByTestId('arr-scroll').getByRole('textbox');
  await input.fill('Leads');
  await input.press('Enter');
  await expect(page.getByTestId('arr-scroll').getByText('Leads', { exact: true })).toBeVisible();
});

test('the arrangement ruler sets the loop region', async ({ page }) => {
  await page.goto('/');
  await dismissStart(page);
  await zoomOut(page);

  // Scope to the arrangement scroller (the piano roll also renders a ruler).
  const end = page.getByTestId('arr-scroll').getByRole('slider', { name: 'Loop length' });
  const box = (await end.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 60, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByText(/Set loop length/)).toBeVisible();
});

test('clicking sets a paste marker and paste lands there', async ({ page }) => {
  await page.goto('/');
  await dismissStart(page);
  await zoomOut(page);

  await expect(placements(page)).toHaveCount(1);
  const seed = (await placements(page).first().boundingBox())!;
  const y = seed.y + seed.height / 2;

  // Copy the seed placement, drop a marker far to the right, paste -> lands there.
  await placements(page).first().click();
  await page.keyboard.press('ControlOrMeta+c');
  await page.mouse.click(seed.x + seed.width + 160, y);
  await page.keyboard.press('ControlOrMeta+v');

  await expect(placements(page)).toHaveCount(2);
  const lefts = await placements(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).getBoundingClientRect().left));
  expect(Math.max(...lefts)).toBeGreaterThan(seed.x + seed.width); // pasted at the marker, right of the seed
});

test('a placed clip persists across reload', async ({ page }) => {
  await page.goto('/');
  await dismissStart(page);
  await zoomOut(page);

  // Drag to create a clip, then confirm it survives a reload.
  const seed = (await placements(page).first().boundingBox())!;
  const y = seed.y + seed.height / 2;
  await page.mouse.move(seed.x + seed.width + 40, y);
  await page.mouse.down();
  await page.mouse.move(seed.x + seed.width + 160, y, { steps: 8 });
  await page.mouse.up();
  await expect(placements(page)).toHaveCount(2);

  await page.waitForTimeout(400); // let the debounced autosave flush
  await page.reload();
  await dismissStart(page);
  await expect(placements(page)).toHaveCount(2);
});
