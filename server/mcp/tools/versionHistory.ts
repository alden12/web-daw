/** MCP tools: Version history (commit DAG; lives in the tab, queried over RPC). */
import { z } from "zod";
import type { HistoryMethod } from "../../../src/audio/mcp/protocol";
import { ok, fail } from "../shared";
import type { ToolContext } from "../context";
import type { Reply } from "../target";

export function registerVersionHistoryTools({ server, target }: ToolContext): void {
  // A commit is a durable, named snapshot of the whole project. The history is a
  // DAG: list_history walks it newest-first, diff reads the musical changes
  // between two commits, commit stamps a new version, revert_to rolls back
  // (append-only, git-revert style). An agent's commits/reverts are authored as the agent.
  type HistoryEntry = { id: string; message: string; author: string; time: number; auto: boolean; entryCount: number };

  /** Run a history RPC; map transport/tab errors to a tool failure. */
  const runHistory = async (
    method: HistoryMethod,
    params?: Record<string, unknown>,
  ): Promise<Reply | { tabError: string }> => {
    try {
      return await target.requestHistory(method, params);
    } catch (err) {
      return { tabError: err instanceof Error ? err.message : String(err) };
    }
  };

  server.registerTool(
    "commit",
    {
      title: "Commit version",
      description:
        "Stamp a named version (checkpoint) of the whole project, capturing every change since the last commit. Returns the new commit id, or notes there was nothing to commit.",
      inputSchema: { message: z.string().min(1).describe("a short, human-readable description of this version") },
    },
    async ({ message }) => {
      const r = await runHistory("commit", { message });
      if ("tabError" in r) return fail(r.tabError);
      if (!r.ok) return fail(r.error ?? "Commit failed.");
      const summary = r.result as HistoryEntry | null;
      return summary
        ? ok(`Committed "${summary.message}" (id ${summary.id}).`)
        : ok("Nothing to commit - no changes since the last version.");
    },
  );

  server.registerTool(
    "list_history",
    {
      title: "List history",
      description:
        "List the project version history (commits) newest-first: id, message, author, auto/named, and change count.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe("max commits to return (default 100)"),
      },
    },
    async ({ limit }) => {
      const r = await runHistory("history", { limit });
      if ("tabError" in r) return fail(r.tabError);
      if (!r.ok) return fail(r.error ?? "Could not read history.");
      return ok(JSON.stringify(r.result, null, 2));
    },
  );

  server.registerTool(
    "diff",
    {
      title: "Diff versions",
      description:
        "Show the readable musical changes for a commit (vs its parent), or between two commits if `from` is given. Ids come from list_history.",
      inputSchema: {
        to: z.string().describe("the commit to inspect (its id from list_history)"),
        from: z.string().optional().describe("compare against this commit instead of the parent"),
      },
    },
    async ({ to, from }) => {
      const r = await runHistory("diff", { toId: to, fromId: from });
      if ("tabError" in r) return fail(r.tabError);
      if (!r.ok) return fail(r.error ?? "Could not diff.");
      const changes = (r.result as string[]) ?? [];
      return ok(changes.length ? changes.join("\n") : "No musical changes between these versions.");
    },
  );

  server.registerTool(
    "revert_to",
    {
      title: "Revert to version",
      description:
        "Roll the project back to a past commit. Append-only (git-revert style): it records a new version restoring the old state, so nothing is lost. Id comes from list_history.",
      inputSchema: { commit: z.string().describe("the commit id to restore (from list_history)") },
    },
    async ({ commit }) => {
      const r = await runHistory("revert", { commitId: commit });
      if ("tabError" in r) return fail(r.tabError);
      if (!r.ok) return fail(r.error ?? "Revert failed.");
      const summary = r.result as HistoryEntry | null;
      return summary ? ok(`Reverted: "${summary.message}" (id ${summary.id}).`) : fail(`Unknown commit "${commit}".`);
    },
  );
}
