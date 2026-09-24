/** MCP tools: Activity feed annotation. */
import { z } from "zod";
import { ok, fail } from "../shared";
import type { ToolContext } from "../context";

export function registerFeedTools({ server, target }: ToolContext): void {
  server.registerTool(
    "note",
    {
      title: "Note in the activity feed",
      description:
        'Post a short line of narration to the activity feed describing what you are about to do or why (e.g. "building a dreamy pad for the chorus"). Purely a feed annotation - it changes nothing and is not undoable. Use it to give the user context as you work.',
      inputSchema: { text: z.string().min(1).max(200) },
    },
    async ({ text }) =>
      target.send({ type: "note", text }) ? ok("Noted in the feed.") : fail("No DAW tab connected."),
  );
}
