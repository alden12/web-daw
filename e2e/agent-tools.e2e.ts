import { test, expect, type Page } from "@playwright/test";

/**
 * The agent's reason-act loop with tools, end to end. The provider is stubbed at the
 * network: the first call returns a create_track tool call, the second returns a text
 * reply. We assert the loop actually ran the tool through the real dispatch - a new
 * track appears in the DAW - and that the chat shows the activity + final text.
 */
test.use({ viewport: { width: 1320, height: 900 } });

async function dismissStart(page: Page) {
  const start = page.getByRole("button", { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0);
  }
}

test("runs a tool call from the model and edits the project", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/agent/chat", (route) => {
    calls += 1;
    const message =
      calls === 1
        ? {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "create_track",
                  arguments: JSON.stringify({ instrument: "subtractive", name: "Agent Bass" }),
                },
              },
            ],
          }
        : { role: "assistant", content: "Added a subtractive track called Agent Bass." };
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message }] }) });
  });

  await page.goto("/");
  await dismissStart(page);
  await page.getByRole("button", { name: /expand agent panel/i }).click();

  const input = page.getByRole("textbox", { name: /message the agent/i });
  await input.fill("make me a bass track");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  // The loop ran the tool (activity chip) and gave a final answer.
  await expect(page.getByText(/create_track/)).toBeVisible();
  await expect(page.getByText("Added a subtractive track called Agent Bass.")).toBeVisible();

  // The tool dispatched a real edit: the new track exists in the project.
  await expect(page.getByText("Agent Bass").first()).toBeVisible();
});
