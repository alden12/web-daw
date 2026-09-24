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
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { allowEmail } from "../server/db/access";

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

describe("the hosted MCP server's HTTP edges", () => {
  const app = async (maxJsonBytes?: number) => {
    const { db } = await makeSyncEnv();
    return createApp(db, { mcp: { registry: new RoomRegistry(db) }, maxJsonBytes });
  };

  it("refuses a call bigger than a project document, before reading it", async () => {
    const response = await (
      await app(1024)
    ).request("http://corrente.test/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ padding: "x".repeat(2048) }),
    });
    expect(response.status).toBe(413);
  });

  it("lets a browser-based MCP client post, and read the sign-in challenge", async () => {
    // One app for both requests: a database takes a couple of seconds to set up on CI, and two
    // of them ran this test past its timeout.
    const server = await app();
    const response = await server.request("http://corrente.test/mcp", {
      method: "OPTIONS",
      headers: { Origin: "https://inspector.example", "Access-Control-Request-Method": "POST" },
    });
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    const challenge = await server.request("http://corrente.test/mcp", { method: "POST" });
    expect(challenge.headers.get("Access-Control-Expose-Headers")).toContain("WWW-Authenticate");
  });
});

describe("OAuth: discovery, and a token for this resource and no other", () => {
  const ISSUER = "https://project.supabase.co/auth/v1";
  const RESOURCE = "https://corrente.test/mcp";
  const EMAIL = "alden@example.com";

  async function withAuth(resource: string | undefined = RESOURCE) {
    const { db } = await makeSyncEnv();
    await allowEmail(db, EMAIL);
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: "ES256", kid: "k" }] });
    const tokenFor = (audience: string) =>
      new SignJWT({ email: EMAIL })
        .setProtectedHeader({ alg: "ES256", kid: "k" })
        .setSubject("user-1")
        .setIssuer(ISSUER)
        .setAudience(audience)
        .setExpirationTime("5m")
        .sign(privateKey);
    const app = createApp(db, {
      auth: { issuer: ISSUER, jwksUrl: `${ISSUER}/.well-known/jwks.json` },
      jwks,
      mcp: { registry: new RoomRegistry(db), resource },
    });
    const initialize = (token?: string) =>
      app.request(RESOURCE, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
        }),
      });
    return { app, tokenFor, initialize };
  }

  it("answers an unauthenticated call with a challenge naming the metadata", async () => {
    const { initialize } = await withAuth();
    const response = await initialize();
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      'resource_metadata="https://corrente.test/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it("names this resource and the Supabase project as its authorization server", async () => {
    const { app } = await withAuth();
    const response = await app.request("http://corrente.test/.well-known/oauth-protected-resource/mcp");
    expect(await response.json()).toMatchObject({ resource: RESOURCE, authorization_servers: [ISSUER] });
  });

  it("accepts a token minted for this resource", async () => {
    const { tokenFor, initialize } = await withAuth();
    expect((await initialize(await tokenFor(RESOURCE))).status).toBe(200);
  });

  it("refuses the app's own sign-in token, which is for the app and not for this", async () => {
    const { tokenFor, initialize } = await withAuth();
    expect((await initialize(await tokenFor("authenticated"))).status).toBe(401);
  });

  it("keeps a connected app's token out of the app's API", async () => {
    const { app, tokenFor } = await withAuth();
    const response = await app.request("https://corrente.test/projects", {
      headers: { authorization: `Bearer ${await tokenFor(RESOURCE)}` },
    });
    expect(response.status).toBe(401);
  });

  it("stays off, rather than open, without its resource URL", async () => {
    const { tokenFor, initialize } = await withAuth(undefined);
    expect((await initialize(await tokenFor("authenticated"))).status).not.toBe(200);
  });
});
