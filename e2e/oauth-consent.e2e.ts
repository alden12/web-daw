/**
 * The consent route (AGENT-28) is its own page, not the app: an app asking to connect to the hosted
 * MCP server lands on it. In e2e sign-in is off, so it can only say so - which is enough to show the
 * route renders the consent screen rather than booting the DAW over it.
 */
import { test, expect } from "@playwright/test";

test("the consent route shows the consent screen, not the app", async ({ page }) => {
  await page.goto("/oauth/consent?authorization_id=abc");
  await expect(page.getByRole("heading", { name: "That request has expired" })).toBeVisible();
  await expect(page.getByText("Sign-in is not configured on this server.")).toBeVisible();
  await expect(page.getByTestId("lane")).toHaveCount(0);
});

test("the consent route without a request says there is nothing to approve", async ({ page }) => {
  await page.goto("/oauth/consent");
  await expect(page.getByRole("heading", { name: "Nothing to approve" })).toBeVisible();
});
