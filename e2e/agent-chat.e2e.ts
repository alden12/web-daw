import { test, expect, type Page } from "@playwright/test";

/**
 * The in-app agent chat (phase 1). The provider call is stubbed at the network
 * (`/api/agent/chat`) so these are deterministic regardless of whether a key is set:
 * one asserts a rendered assistant reply, one asserts a surfaced proxy error. The real
 * browser -> proxy -> Gemini path is verified manually with a key in `.env`.
 */
test.use({ viewport: { width: 1320, height: 900 } });

async function dismissStart(page: Page) {
  const start = page.getByRole("button", { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0);
  }
}

async function openAgent(page: Page) {
  await page.goto("/");
  await dismissStart(page);
  await page.getByRole("button", { name: /expand agent panel/i }).click();
  await expect(page.getByRole("textbox", { name: /message the agent/i })).toBeVisible();
}

test("expands the panel and shows the chat composer", async ({ page }) => {
  await openAgent(page);
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
});

test("renders the assistant reply from the provider", async ({ page }) => {
  await page.route("**/api/agent/chat", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { role: "assistant", content: "Try a syncopated hat." } }] }),
    }),
  );

  await openAgent(page);
  await page.getByRole("textbox", { name: /message the agent/i }).fill("give me a groove idea");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  // The message echoes (in the transcript; it also titles the session, hence .first()).
  await expect(page.getByText("give me a groove idea", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Try a syncopated hat.", { exact: true })).toBeVisible();
});

test("surfaces a proxy error (e.g. the missing-key notice)", async ({ page }) => {
  await page.route("**/api/agent/chat", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "AGENT_API_KEY is not set. Add it to .env (see .env.example)." }),
    }),
  );

  await openAgent(page);
  await page.getByRole("textbox", { name: /message the agent/i }).fill("hello there");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await expect(page.getByText("hello there", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/AGENT_API_KEY/i)).toBeVisible();
});
