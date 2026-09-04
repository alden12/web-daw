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

/**
 * The URL must never name a project with another project's name.
 *
 * `setCurrentProject` repoints the repository synchronously, but the live store keeps the
 * previous project until a load finishes a couple of OPFS writes later. Pairing the new id
 * with the store's still-old name wrote `/p/deep-house-jam~<new id>` in that window.
 *
 * The test above only catches it when the window happens to outlast an assertion timeout,
 * which is why it passed locally for months and failed on CI. Throttling the CPU turns the
 * race into a certainty, so this is the one that actually guards it.
 */
test("switching projects never puts one project's name on another's link", async ({ page }) => {
  // Boot at full speed. Throttling from the start made this test fail on CI for a reason that
  // had nothing to do with the bug: a runner is already slow, and 20x on top of that spent the
  // whole timeout getting the app up. The throttle belongs around the race, not the fixture.
  await page.goto("/");
  await dismissStart(page);
  await page.getByRole("button", { name: "Project", exact: true }).click();
  await expect(page).toHaveURL(/\/p\/untitled~/);

  page.once("dialog", (dialog) => void dialog.accept("Deep House Jam"));
  await projectMenu(page).click();
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await expect(page).toHaveURL(/\/p\/deep-house-jam~/);
  const renamedId = page.url().split("~")[1];

  // Now slow the machine down, for the switch alone. The window being widened is the one
  // between repointing the repository and the store finishing the load, so this is all it has
  // to cover - and a rate this high is affordable when it is only spanning a couple of clicks.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 20 });

  // Sample densely across the switch rather than checking the settled value: the bug is a
  // transient, and a transient that reaches the address bar is one a user can copy.
  const seen = new Set<string>();
  const sampler = setInterval(() => {
    try {
      seen.add(new URL(page.url()).pathname);
    } catch {
      // between navigations; nothing to sample
    }
  }, 15);
  await projectMenu(page).click();
  await page.getByRole("menuitem", { name: "New project" }).click();
  await expect(page).toHaveURL(/\/p\/untitled~/, { timeout: 30000 });
  clearInterval(sampler);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  const mismatched = [...seen].filter((path) => path.startsWith("/p/deep-house-jam~") && !path.endsWith(renamedId));
  expect(mismatched, "a URL naming the new project with the old project's name").toEqual([]);
});

test("a sign-in round trip comes back to the project it left", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await page.getByRole("button", { name: "Project", exact: true }).click();

  page.once("dialog", (dialog) => void dialog.accept("Deep House Jam"));
  await projectMenu(page).click();
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await expect(page).toHaveURL(/\/p\/deep-house-jam~/);
  const path = new URL(page.url()).pathname;

  // Switch away, so opening the remembered path has to do real work.
  await projectMenu(page).click();
  await page.getByRole("menuitem", { name: "New project" }).click();
  await expect(page).toHaveURL(/\/p\/untitled~/);

  // An OAuth return lands on the bare origin with the path in the tab's memory - `redirectTo`
  // is the origin, because Supabase silently falls back to its configured Site URL for any
  // path it has not been told to allow. This is that return, without the provider.
  await page.addInitScript((remembered) => sessionStorage.setItem("web-daw:auth-return", remembered), path);
  await page.goto("/");
  await dismissStart(page);

  await expect(page.getByText("Deep House Jam")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${path.replace("~", "\\~")}$`));
});

test("a link to a project that is not there falls back rather than inventing one", async ({ page }) => {
  // Someone else's project, or one never shared with us. It must not seed a local project
  // under that id - the address bar is rewritten to what actually opened, which is our own.
  await page.goto("/p/someone-elses~p-deadbeef");
  await dismissStart(page);

  await expect(page).toHaveURL(/\/p\/untitled~/);
  await expect(page).not.toHaveURL(/p-deadbeef/);
});
