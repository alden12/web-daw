import { test, expect, type Page } from '@playwright/test';

/**
 * Piano-roll mouse editing: the default project seeds one instrument track
 * (selected), so the roll is visible on load with an empty clip. Adds a note by
 * clicking, moves it with a pointer drag, deletes the selection, and confirms a
 * note survives a reload (it lives in the project snapshot). The two-voice feed
 * records each gesture as a single entry.
 *
 * The grid is larger than the viewport and has sticky overlays (ruler on top,
 * velocity lane on the bottom), so we click absolute viewport coordinates in the
 * safe band near the grid's top rather than using element-relative positions.
 */

// A tall viewport so the piano-roll panel has room (otherwise the sticky velocity
// lane covers most of the short grid and swallows clicks).
test.use({ viewport: { width: 1280, height: 1100 } });

async function dismissStart(page: Page) {
  const start = page.getByRole('button', { name: /start audio/i });
  if (await start.count()) await start.click();
}

/** A viewport point a little way into the grid from its top-left (clear of the sticky ruler/lane). */
async function gridPoint(page: Page, dx: number, dy: number) {
  const box = (await page.getByTestId('piano-grid').boundingBox())!;
  return { x: box.x + dx, y: box.y + dy };
}

test('add, move and delete notes with the mouse; a note persists across reload', async ({ page }) => {
  await page.goto('/');
  await dismissStart(page);

  await expect(page.getByTestId('piano-grid')).toBeVisible();
  await expect(page.getByTestId('note')).toHaveCount(0);

  // Click an empty cell -> add one note.
  const p1 = await gridPoint(page, 120, 40);
  await page.mouse.click(p1.x, p1.y);
  await expect(page.getByTestId('note')).toHaveCount(1);
  await expect(page.getByText('Added note')).toBeVisible();

  // Drag the note body to move it (one "Edited" entry, not a duplicate note).
  const box = (await page.getByTestId('note').first().boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByText(/Edited 1 note/)).toBeVisible();
  await expect(page.getByTestId('note')).toHaveCount(1);

  // The note stays selected after the drag -> Delete removes it.
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('note')).toHaveCount(0);
  await expect(page.getByText(/Removed 1 note/)).toBeVisible();

  // Add again and confirm it survives a reload (persisted in the snapshot).
  const p2 = await gridPoint(page, 80, 60);
  await page.mouse.click(p2.x, p2.y);
  await expect(page.getByTestId('note')).toHaveCount(1);
  await page.waitForTimeout(400); // let the debounced autosave flush
  await page.reload();
  await dismissStart(page);
  await expect(page.getByTestId('note')).toHaveCount(1);
});

test('dragging the loop handle changes the loop length', async ({ page }) => {
  await page.goto('/');
  await dismissStart(page);

  // Zoom all the way out (time) so the whole loop + handle fit without scrolling.
  const zoomOut = page.getByTitle('Zoom out (time)');
  for (let i = 0; i < 8; i++) await zoomOut.click();

  const handle = page.getByRole('slider', { name: 'Loop length' });
  await expect(handle).toBeVisible();
  const before = (await handle.boundingBox())!;

  // Drag the loop handle left to shorten the loop.
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x - 80, before.y + before.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByText(/Set loop length/)).toBeVisible();

  const after = (await handle.boundingBox())!;
  expect(after.x).toBeLessThan(before.x);
});
