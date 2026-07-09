import { test, expect, type Page } from "@playwright/test";

/**
 * Agent chat sessions: a conversation is saved, "New chat" starts a fresh one, the
 * switcher swaps between them, and they survive a reload (localStorage). The provider is
 * stubbed at the network so replies are deterministic.
 */
test.use({ viewport: { width: 1320, height: 900 } });

async function dismissStart(page: Page) {
  const start = page.getByRole("button", { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0);
  }
}

async function stubReply(page: Page, text: string) {
  await page.route("**/api/agent/chat", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { role: "assistant", content: text } }] }),
    }),
  );
}

async function openAgent(page: Page) {
  await page.goto("/");
  await dismissStart(page);
  await page.getByRole("button", { name: /expand agent panel/i }).click();
}

test("saves a session, starts a new one, switches back, and persists across reload", async ({ page }) => {
  await stubReply(page, "Sure thing.");
  await openAgent(page);

  // First session: send a message. Its text becomes the session title, and the
  // assistant reply (transcript-only text) confirms the turn landed.
  await page.getByRole("textbox", { name: /message the agent/i }).fill("write a bassline");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Sure thing.")).toBeVisible();
  await expect(page.getByRole("button", { name: /switch chat session/i })).toContainText("write a bassline");

  // New chat: the transcript clears and the title resets.
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByText("Sure thing.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /switch chat session/i })).toContainText("New chat");

  // Switch back to the first session via the switcher: its history returns.
  await page.getByRole("button", { name: /switch chat session/i }).click();
  await page.getByText("write a bassline").click();
  await expect(page.getByText("Sure thing.")).toBeVisible();

  // Persists across a reload. The panel's expanded state persists too, so only click
  // the expand control if it is present.
  await page.reload();
  await dismissStart(page);
  const expand = page.getByRole("button", { name: /expand agent panel/i });
  if (await expand.count()) await expand.click();
  await expect(page.getByText("Sure thing.")).toBeVisible();
});
