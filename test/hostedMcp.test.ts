/**
 * The hosted MCP server (AGENT-28): the same tools as the local one, over HTTP, editing a project
 * stored on the sync service through its room - so an agent's edit is saved, logged, authored as the
 * agent, and broadcast to any tab that has the project open.
 */
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { makeSyncEnv, seedEdits } from "./support/syncEnv";
import { createApp } from "../server/api/app";
import { RoomRegistry, type RoomClient } from "../server/api/rooms";
import type { ServerMessage } from "../src/contract/ws";

type TextResult = { isError?: boolean; content: { type: string; text: string }[] };

async function hosted() {
  const { db } = await makeSyncEnv();
  await seedEdits(db, "p1", 1); // one track, so the project exists and is the caller's
  const registry = new RoomRegistry(db);
  const app = createApp(db, { mcp: { registry } });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://corrente.test/mcp"), {
      fetch: (url, init) => Promise.resolve(app.request(String(url), init)),
    }),
  );
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as TextResult;
  const room = (await registry.get("p1", { userId: "local" }))!;
  return { client, call, room };
}

const trackIds = (room: { snapshot(): { tracks: { id: string }[] } }) =>
  room.snapshot().tracks.map((track) => track.id);

describe("the hosted MCP server", () => {
  it("lists the caller's projects", async () => {
    const { call } = await hosted();
    const projects = JSON.parse((await call("list_projects")).content[0].text) as { id: string }[];
    expect(projects.map((project) => project.id)).toEqual(["p1"]);
  });

  it("edits the room, once, and a tab subscribed to it hears the edit as the agent's", async () => {
    const { call, room } = await hosted();
    const heard: ServerMessage[] = [];
    const tab: RoomClient = { send: (message) => heard.push(message) };
    await room.subscribe(tab);
    const before = trackIds(room).length;

    const result = await call("create_track", { instrument: "subtractive", name: "Bass" });

    expect(result.isError).toBeFalsy();
    expect(trackIds(room)).toHaveLength(before + 1);
    // The family group arrives first when the track brings a new one; the track is what matters here.
    const applied = heard.find((message) => message.type === "editApplied" && message.command.type === "createTrack");
    expect(applied).toMatchObject({ author: "agent:local" });
  });

  it("remembers the selected track between calls, since each request is a fresh server", async () => {
    const { call, room } = await hosted();
    const created = await call("create_track", { instrument: "subtractive", name: "Lead" });
    const trackId = /t-[0-9a-f]{8}/.exec(created.content[0].text)![0];

    await call("select_track", { track: trackId });
    const added = await call("add_note", { pitch: 60, start: 0 });

    expect(added.isError).toBeFalsy();
    const track = room.snapshot().tracks.find((candidate) => candidate.id === trackId)!;
    const notes = "clips" in track ? track.clips.flatMap((clip) => ("notes" in clip ? clip.notes : [])) : [];
    expect(notes).toHaveLength(1);
  });

  it("leaves out the tools that need a tab to make sound", async () => {
    const { client } = await hosted();
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain("create_track");
    expect(names).not.toContain("play");
    expect(names).not.toContain("play_note");
  });

  it("says which project it could not find, rather than editing another", async () => {
    const { call } = await hosted();
    const result = await call("list_tracks", { project: "nope" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No project "nope"');
  });
});
