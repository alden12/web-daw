import { test, expect, type Page } from "@playwright/test";

/**
 * The in-app agent chat (phase 1). The agent calls the selected provider's
 * OpenAI-compatible endpoint directly from the browser with the user's own key (BYOK), so
 * these stub the provider at the network (`**\/chat/completions`) and seed a dummy key in
 * localStorage. They cover a rendered reply, the no-key prompt, a surfaced provider error,
 * switching provider in Settings (routes to OpenAI), and retry. The real browser ->
 * provider path is verified manually with a real key in Settings.
 */
test.use({ viewport: { width: 1320, height: 900 } });

const AGENT_CONFIG_KEY = "web-daw:agent-config:v2";

/** Seed a BYOK key so the provider actually calls out (and the route stub is hit). */
async function seedKey(page: Page) {
  await page.addInitScript(
    ([storageKey]) => {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ provider: "gemini", keys: { gemini: "test-key" }, models: {} }),
      );
    },
    [AGENT_CONFIG_KEY],
  );
}

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
  await seedKey(page);
  await openAgent(page);
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();
});

test("prompts for an API key when none is set", async ({ page }) => {
  // No key seeded: the empty state offers Settings, and sending surfaces the no-key error.
  await openAgent(page);
  await expect(page.getByRole("button", { name: /open settings/i })).toBeVisible();

  await page.getByRole("textbox", { name: /message the agent/i }).fill("hello");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/no api key set/i)).toBeVisible();
});

test("renders the assistant reply from the provider", async ({ page }) => {
  await page.route("**/chat/completions", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { role: "assistant", content: "Try a syncopated hat." } }] }),
    }),
  );

  await seedKey(page);
  await openAgent(page);
  await page.getByRole("textbox", { name: /message the agent/i }).fill("give me a groove idea");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  // The message echoes (in the transcript; it also titles the session, hence .first()).
  await expect(page.getByText("give me a groove idea", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Try a syncopated hat.", { exact: true })).toBeVisible();
});

test("renders the assistant reply as markdown, not raw text", async ({ page }) => {
  const markdown = '## Plan\n\nUse a **punchy** kick.\n\n```json\n{"note":60}\n```';
  await page.route("**/chat/completions", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { role: "assistant", content: markdown } }] }),
    }),
  );

  await seedKey(page);
  await openAgent(page);
  await page.getByRole("textbox", { name: /message the agent/i }).fill("plan a beat");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  // Markdown structures render as elements (a heading, bold, a fenced code block), not as
  // literal "##"/"**"/backticks.
  await expect(page.getByRole("heading", { name: "Plan" })).toBeVisible();
  await expect(page.locator(".md strong", { hasText: "punchy" })).toBeVisible();
  await expect(page.locator(".md pre code")).toContainText('{"note":60}');
});

test("surfaces a provider error", async ({ page }) => {
  await page.route("**/chat/completions", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "The model is overloaded. Please try again later." } }),
    }),
  );

  await seedKey(page);
  await openAgent(page);
  await page.getByRole("textbox", { name: /message the agent/i }).fill("hello there");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await expect(page.getByText("hello there", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/model is overloaded/i)).toBeVisible();
});

test("selecting a provider in settings routes the request to it", async ({ page }) => {
  let hitUrl = "";
  await page.route("**/chat/completions", (route) => {
    hitUrl = route.request().url();
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { role: "assistant", content: "Hi from OpenAI." } }] }),
    });
  });

  await page.goto("/");
  await dismissStart(page);

  // Configure OpenAI through the Settings UI (no key seeded - we set it here).
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Provider").selectOption("openai");
  await page.getByLabel("API key").fill("sk-test-openai");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // The next request must go to OpenAI's endpoint, not the default (Gemini).
  await page.getByRole("button", { name: /expand agent panel/i }).click();
  await page.getByRole("textbox", { name: /message the agent/i }).fill("hello");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Hi from OpenAI.")).toBeVisible();
  expect(hitUrl).toContain("api.openai.com");
});

test("a failed message can be retried and succeeds", async ({ page }) => {
  let calls = 0;
  await page.route("**/chat/completions", (route) => {
    calls += 1;
    if (calls === 1) {
      route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "upstream boom" }) });
    } else {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ choices: [{ message: { role: "assistant", content: "Recovered!" } }] }),
      });
    }
  });

  await seedKey(page);
  await openAgent(page);
  await page.getByRole("textbox", { name: /message the agent/i }).fill("do it");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  // The failure surfaces with a retry affordance on the message.
  await expect(page.getByText("upstream boom")).toBeVisible();
  const retryButton = page.getByRole("button", { name: /retry/i });
  await expect(retryButton).toBeVisible();

  // Retrying re-runs the same message and this time it lands.
  await retryButton.click();
  await expect(page.getByText("Recovered!")).toBeVisible();
});
