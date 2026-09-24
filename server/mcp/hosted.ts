/**
 * The hosted MCP server (AGENT-28): the same tools as the local one, editing a project stored on the
 * sync service instead of a browser tab.
 *
 * **Edits go into the project's room**, the one an open tab subscribes to, so whatever Claude does
 * lands live in any browser that has the project open - and is saved, logged and undoable like any
 * other edit, authored as the agent for the person driving it. Nothing here touches audio.
 *
 * **Each tool call reads a scratch copy of the room's project.** The tools were written against a
 * mirror of a tab's project and apply each edit to it straight after sending, so the next call sees
 * it before the tab echoes back. Handed the room's own store, that write would apply every edit a
 * second time outside the log. A copy per call takes the write harmlessly, and the real edit reaches
 * the room through `send`.
 *
 * **Stateless.** One server per HTTP request, so the project is chosen per call: every tool takes an
 * optional `project`, defaulting to the caller's most recently edited one. Selection is the one thing
 * a tool relies on between calls, so it is remembered per person and project for the process's life.
 */
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ProjectStore } from "../../src/audio/project/projectStore";
import type { EditCommand } from "../../src/audio/commands/types";
import { agentAuthor } from "../../src/audio/commands/authors";
import { listPatchSummaries, patchDetails, patchTrackCommand } from "../../src/audio/patches/patchTools";
import type { HistoryMethod, PatchMethod, ServerToBrowser } from "../../src/audio/mcp/protocol";
import type { Room, RoomRegistry } from "../api/rooms";
import { listProjects, type Accessor } from "../db/store";
import type { Db } from "../db/types";
import { makeToolContext, type ToolHost } from "./context";
import { registerDawTools } from "./tools";
import { fail, ok } from "./shared";
import type { DawTarget, Reply } from "./target";

/** Tools that make sound or narrate live. Both need an open tab, which the hosted server has none of. */
const TAB_ONLY_TOOLS = new Set(["play", "stop", "note_on", "note_off", "play_note", "play_sequence", "note"]);

/** What each tool call selected last, per person and project. Lost on restart, which costs a default. */
const selections = new Map<string, { trackId?: string; clipId?: string }>();

const projectArg = {
  project: z
    .string()
    .optional()
    .describe("project id or name; defaults to your most recently edited project (see list_projects)"),
};

type Handler = (...args: unknown[]) => unknown;
type ToolConfig = { inputSchema?: Record<string, z.ZodTypeAny> } & Record<string, unknown>;

export interface HostedMcpOptions {
  db: Db;
  registry: RoomRegistry;
  principal: Accessor;
  log?: (line: string) => void;
}

export function createHostedMcp({ db, registry, principal, log = console.error }: HostedMcpOptions): McpServer {
  const author = agentAuthor(principal.email ?? principal.userId);
  let room: Room | null = null;
  let selectionKey = "";
  let scratch = new ProjectStore(false);

  /** Open the project a call names (or the default), or say why not. */
  const openProject = async (project?: string): Promise<string | null> => {
    const projects = await listProjects(db, principal);
    const wanted = project?.trim().toLowerCase();
    const chosen =
      wanted === undefined
        ? projects[0]
        : (projects.find((candidate) => candidate.id === project) ??
          projects.find((candidate) => candidate.name.toLowerCase() === wanted));
    if (!chosen)
      return wanted === undefined
        ? "You have no projects yet - create one in Corrente first."
        : `No project "${project}". Use list_projects.`;
    const opened = await registry.get(chosen.id, principal);
    if (!opened) return `You do not have access to "${chosen.name}".`;
    room = opened;
    selectionKey = `${principal.userId}:${chosen.id}`;
    // A fresh copy every call rather than one cached per room: the server keeps nothing between
    // requests anyway, a project is plain data (samples are referenced, not copied) so this costs a
    // few milliseconds against a network round trip and a model turn, and it can never read stale.
    // If a big project ever shows it in a profile, cache per room and rebuild when `headSeq` moves.
    scratch = new ProjectStore(false);
    scratch.load(opened.snapshot());
    const selection = selections.get(selectionKey);
    if (selection?.trackId) scratch.selectTrack(selection.trackId);
    if (selection?.trackId && selection.clipId) scratch.selectClip(selection.trackId, selection.clipId);
    return null;
  };

  const remember = (selection: { trackId?: string; clipId?: string }) =>
    selections.set(selectionKey, { ...selections.get(selectionKey), ...selection });

  /** The messages that are not edits. Selection is kept here; the rest need a tab (see TAB_ONLY_TOOLS). */
  const notEdits: Partial<{
    [K in ServerToBrowser["type"]]: (message: Extract<ServerToBrowser, { type: K }>) => boolean;
  }> = {
    selectTrack: (message) => {
      remember({ trackId: message.trackId, clipId: undefined });
      scratch.selectTrack(message.trackId);
      return true;
    },
    selectClip: (message) => {
      remember({ trackId: message.trackId, clipId: message.clipId });
      scratch.selectClip(message.trackId, message.clipId);
      return true;
    },
    noteOn: () => false,
    noteOff: () => false,
    allNotesOff: () => false,
    transport: () => false,
    note: () => false,
  };

  /** Apply an edit to the room: saved, logged, broadcast to open tabs. Returns the opId it went in as. */
  const applyEdit = (command: EditCommand): string | null => {
    if (!room) return null;
    const opId = randomUUID();
    room.applyIncoming({ command, opId, author }).catch((error: unknown) => {
      log(
        `[corrente] hosted MCP: ${command.type} failed to persist: ${error instanceof Error ? error.message : error}`,
      );
    });
    return opId;
  };

  const historyMethods: Partial<Record<HistoryMethod, (params: Record<string, unknown>) => Reply>> = {
    commit: (params) => {
      const message = String(params.message ?? "").trim() || "Checkpoint";
      const id = applyEdit({ type: "commit", message } as EditCommand);
      return id
        ? { ok: true, result: { id, message, author, time: Date.now(), auto: false, entryCount: 0 } }
        : { ok: false, error: "No project is open." };
    },
  };

  const patchMethods: Record<PatchMethod, (params: Record<string, unknown>) => unknown> = {
    list: () => listPatchSummaries(),
    get: (params) => patchDetails(String(params.patch ?? "")),
    apply: (params) => {
      const command = patchTrackCommand(String(params.patch ?? ""), params.name as string | undefined);
      if (!applyEdit(command)) throw new Error("No project is open.");
      return { trackId: command.id, name: command.name };
    },
    save: () => {
      throw new Error("Saving a patch needs Corrente open: your patches live in your browser.");
    },
  };

  const target: DawTarget = {
    get project() {
      return scratch;
    },
    send: (message) => {
      const handler = notEdits[message.type] as ((message: ServerToBrowser) => boolean) | undefined;
      return handler ? handler(message) : applyEdit(message as EditCommand) !== null;
    },
    connected: () => room !== null,
    requestHistory: async (method, params = {}) =>
      historyMethods[method]?.(params) ?? {
        ok: false,
        error: `${method} is not available on the hosted server yet - open the project in Corrente for it.`,
      },
    requestPatch: async (method, params = {}) => {
      try {
        return { ok: true, result: patchMethods[method](params) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };

  const server = new McpServer({ name: "corrente", version: "0.1.0" });

  /** Every tool gains `project`, and opens it before running; tab-only tools are left out. */
  const host: ToolHost = {
    registerTool: ((name: string, config: ToolConfig, handler: Handler) => {
      if (TAB_ONLY_TOOLS.has(name)) return undefined;
      return server.registerTool(
        name,
        { ...config, inputSchema: { ...config.inputSchema, ...projectArg } },
        async (args: { project?: string }, extra: unknown) => {
          const problem = await openProject(args.project);
          if (problem) return fail(problem);
          return (config.inputSchema ? handler(args, extra) : handler(extra)) as ReturnType<typeof ok>;
        },
      );
    }) as unknown as ToolHost["registerTool"],
  };

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "List your Corrente projects, most recently edited first. Every other tool takes an optional `project` (id or name) and defaults to the first of these.",
    },
    async () => ok(JSON.stringify(await listProjects(db, principal), null, 2)),
  );
  registerDawTools(makeToolContext(host, target));
  return server;
}
