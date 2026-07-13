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

const libPanel = (page: Page) => page.locator('[class*="grid-area:library"]');
const libWidth = (page: Page) => libPanel(page).evaluate((el) => el.getBoundingClientRect().width);

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
  expect(await libWidth(page)).toBeGreaterThan(150);

  // Clicking the active (Instruments) icon collapses the panel away (only the rail
  // remains, which is now its own full-height column).
  await page.getByRole("button", { name: "Instruments" }).click();
  await expect(libPanel(page)).toHaveCount(0);

  // Collapse persists across a reload.
  await page.reload();
  await dismissStart(page);
  await expect(libPanel(page)).toHaveCount(0);

  // Selecting a different view reopens the panel on that view.
  await page.getByRole("button", { name: "Samples" }).click();
  await expect.poll(() => libWidth(page)).toBeGreaterThan(150);
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

test("the workbench tab bar shows MCP; the header menu has undo/redo", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  // MCP status moved to the workbench tab bar's indicator area.
  await expect(page.getByText("MCP")).toBeVisible();
  // Undo/redo live in the library header's main (Project) menu.
  await page.getByRole("button", { name: "Project menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Undo" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Redo" })).toBeVisible();
});

test("the project switcher creates a project that survives a reload", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  // Open the Project view, then its switcher menu: one project is listed (checked).
  await page.getByRole("button", { name: "Projects" }).click();
  await page.getByRole("button", { name: "Project menu" }).click();
  await expect(page.getByRole("menuitemradio")).toHaveCount(1);
  await page.getByRole("menuitem", { name: "New project" }).click();
  await page.waitForTimeout(500); // let the create + save settle

  // The second project persists across a reload (the Projects view is persisted too).
  await page.reload();
  await dismissStart(page);
  await page.getByRole("button", { name: "Project menu" }).click();
  await expect(page.getByRole("menuitemradio")).toHaveCount(2);
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
