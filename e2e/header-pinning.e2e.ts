import { test, expect, type Page } from "@playwright/test";
import { dismissStart } from "./support/app";

/**
 * Whether the arrangement's header column is pinned or scrolls away with the lanes, which is
 * decided by the room the timeline has rather than by which shell is hosting it. The rule is
 * pure and unit-tested (`test/pinHeaders.test.ts`); what needs a browser is that the width it
 * reads is the *timeline's*, so docking a panel beside the arrangement changes the answer.
 */

/** The header cell of the first lane - the thing that is either sticky or not. */
const headerPosition = (page: Page) =>
  page
    .locator("[data-track-id]")
    .first()
    .locator("> div")
    .first()
    .evaluate((el) => getComputedStyle(el).position);

test.describe("tablet", () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true });

  test("the headers scroll away while a panel is docked beside the arrangement", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await expect.poll(() => headerPosition(page)).toBe("sticky");

    // Docking the agent leaves the timeline ~690px - a 220px pinned column there is a header
    // with a sliver beside it, not an arrangement.
    await page.getByRole("button", { name: "Agent" }).tap();
    await expect(page.getByRole("complementary", { name: "Agent" })).toBeVisible();
    await expect.poll(() => headerPosition(page)).not.toBe("sticky");

    // Close it and the room comes back, so the headers pin again - the point being that the
    // answer follows the layout rather than the device.
    // The top bar's ✦ (the docked panel has an "Agent" control of its own).
    await page.getByRole("button", { name: "Agent" }).first().tap();
    await expect(page.getByRole("complementary", { name: "Agent" })).toHaveCount(0);
    await expect.poll(() => headerPosition(page)).toBe("sticky");
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  test("keeps its headers pinned, having the width for them", async ({ page }) => {
    await page.goto("/");
    await dismissStart(page);
    await expect.poll(() => headerPosition(page)).toBe("sticky");
  });
});
