import { test, expect, type Page } from "@playwright/test";

/**
 * The activity rail + toolbar (the VSCode-style spine). Guards: the rail switches
 * the single library view; clicking the active icon collapses the panel to the
 * rail and it persists across a reload; the toolbar carries undo/redo + MCP; the
 * Project view creates a project that survives a reload; and an empty Sampler
 * picker reveals the Samples view.
 */

test.use({ viewport: { width: 1320, height: 900 } });

async function dismissStart(page: Page) {
  const start = page.getByRole("button", { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0);
  }
}

const libWidth = (page: Page) =>
  page.locator('[class*="grid-area:library"]').evaluate((el) => el.getBoundingClientRect().width);

test("the rail switches the single library view", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  // Instruments is the default view (its title shows in the panel header).
  await expect(page.getByText("Instruments", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Effects" }).click();
  await expect(page.getByText("Effects", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Activity" }).click();
  await expect(page.getByRole("combobox", { name: "Activity view" })).toBeVisible();
});

test("clicking the active rail icon collapses the panel to the rail, and it persists", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  expect(await libWidth(page)).toBeGreaterThan(200);

  // Clicking the active (Instruments) icon collapses the panel to just the rail.
  await page.getByRole("button", { name: "Instruments" }).click();
  await expect.poll(() => libWidth(page)).toBeLessThan(60);

  // Collapse persists across a reload.
  await page.reload();
  await dismissStart(page);
  await expect.poll(() => libWidth(page)).toBeLessThan(60);

  // Selecting a different view reopens the panel on that view.
  await page.getByRole("button", { name: "Samples" }).click();
  await expect.poll(() => libWidth(page)).toBeGreaterThan(200);
  await expect(page.getByText("Samples", { exact: true })).toBeVisible();
});

test("typing in search jumps to the Search view with grouped results", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  await page.getByRole("searchbox", { name: "Search the library" }).fill("sampler");
  // The panel switches to the Search view (its title) and the Sampler instrument matches.
  await expect(page.getByText("Search", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sampler", exact: true })).toBeVisible();
});

test("the panel header carries the MCP status and an undo/redo menu", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await expect(page.getByText("MCP")).toBeVisible();
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByRole("menuitem", { name: "Undo" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Redo" })).toBeVisible();
});

test("the Project view creates a project that survives a reload", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  await page.getByRole("button", { name: "Projects" }).click();
  const rows = page.getByTestId("project-row");
  await expect(rows).toHaveCount(1);

  await page.getByRole("button", { name: "+ New project" }).click();
  await expect(rows).toHaveCount(2);

  await page.reload();
  await dismissStart(page);
  // The Projects view is still active after reload (the view is persisted), so both
  // projects should be listed without re-selecting it.
  await expect(page.getByTestId("project-row")).toHaveCount(2);
});

test("an empty Sampler picker reveals the Samples view", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  // Add a Sampler track (Instruments view is the default), then clear its sample.
  await page.getByRole("button", { name: "Sampler", exact: true }).click();
  const picker = page.getByRole("combobox", { name: /Sample/ });
  await picker.selectOption({ label: "None" });

  // The empty picker offers a "browse the library" affordance that jumps to Samples.
  await page.getByRole("button", { name: "Browse samples in the library" }).click();
  await expect(page.getByText("Samples", { exact: true })).toBeVisible();
});
