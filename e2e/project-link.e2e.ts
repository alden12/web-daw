import { test, expect, type Page } from "@playwright/test";

/**
 * A project has a link: the URL names whichever project is open, and a URL that names one
 * opens it. The path building/parsing is pure and unit-tested (`test/projectUrl.test.ts`);
 * what needs a browser is that the address bar is actually pointed at the open project and
 * that arriving on such a URL opens it rather than the persisted current one.
 */

async function dismissStart(page: Page) {
  const start = page.getByRole("button", { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0);
  }
}

/** The project menu lives behind the current project's name in the library header. */
const projectMenu = (page: Page) => page.getByRole("button", { name: "Project menu" });

test("the URL names the open project, and opening that URL opens it again", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await page.getByRole("button", { name: "Project", exact: true }).click(); // the view that names the project

  // The address bar is pointed at the project once it has loaded.
  await expect(page).toHaveURL(/\/p\/untitled~/);

  // Renaming carries into the link, because the readable half is built from the name.
  page.once("dialog", (dialog) => void dialog.accept("Deep House Jam"));
  await projectMenu(page).click();
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await expect(page).toHaveURL(/\/p\/deep-house-jam~/);
  const link = page.url();

  // Switching away takes the URL with it, so a link is never stale.
  await projectMenu(page).click();
  await page.getByRole("menuitem", { name: "New project" }).click();
  await expect(page).toHaveURL(/\/p\/untitled~/);

  // Arriving on the link opens *that* project, not the one we were last in - which is the
  // whole point, and the only part of this a browser is needed to prove.
  await page.goto(link);
  await dismissStart(page);
  await expect(page.getByText("Deep House Jam")).toBeVisible();
  await expect(page).toHaveURL(link);
});

test("a link to a project that is not there falls back rather than inventing one", async ({ page }) => {
  // Someone else's project, or one never shared with us. It must not seed a local project
  // under that id - the address bar is rewritten to what actually opened, which is our own.
  await page.goto("/p/someone-elses~p-deadbeef");
  await dismissStart(page);

  await expect(page).toHaveURL(/\/p\/untitled~/);
  await expect(page).not.toHaveURL(/p-deadbeef/);
});
