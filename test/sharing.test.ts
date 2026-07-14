/**
 * Project sharing (Auth-C): the "owner or member" access model. A project's owner can invite
 * collaborators by email; access is granted when someone signs in with a provider account whose verified
 * email matches (member rows key on email, matched against the token's `email` claim at query time).
 *
 * The HTTP suite drives the real Hono app over pglite with a real JWT verifier (two/three distinct users
 * via signed tokens carrying an `email` claim). The room suite exercises the realtime authorization gap
 * directly through `RoomRegistry` (owner + member admitted, stranger refused, edits persisted under the
 * real owner).
 */
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet, type JWTVerifyGetKey } from "jose";
import { makeSyncEnv } from "./support/syncEnv";
import { createApp } from "../server/api/app";
import { makeJwtResolver, type AuthConfig } from "../server/api/principal";
import { RoomRegistry } from "../server/api/rooms";
import { addMember, ensureUser, readEdits, writeFile } from "../server/db/store";
import { projects } from "../server/db/schema";
import type { EditCommand } from "../src/audio/commands/types";

const ISSUER = "https://test.supabase.co/auth/v1";
const ALG = "ES256";
const CONFIG: AuthConfig = { jwksUrl: "https://unused.invalid/jwks", issuer: ISSUER };

const PROJECT = JSON.stringify({ groups: [], tracks: [], tempoBpm: 120, lengthBeats: 16, selectedTrackId: null });

/** A signed-token factory: `token(sub, email?)` mints a valid JWT for that subject, optionally with an
 *  `email` claim (the identity member rows are matched against). */
async function authFixture(): Promise<{
  jwks: JWTVerifyGetKey;
  token: (sub: string, email?: string) => Promise<string>;
}> {
  const { publicKey, privateKey } = await generateKeyPair(ALG);
  const jwk = await exportJWK(publicKey);
  const jwks = createLocalJWKSet({ keys: [{ ...jwk, alg: ALG, kid: "k" }] });
  const token = (sub: string, email?: string) =>
    new SignJWT(email ? { email } : {})
      .setProtectedHeader({ alg: ALG, kid: "k" })
      .setIssuer(ISSUER)
      .setAudience("authenticated")
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
  return { jwks, token };
}

const listed = async (res: Response): Promise<{ id: string; role: string }[]> =>
  ((await res.json()) as { projects: { id: string; role: string }[] }).projects;
const listedIds = async (res: Response): Promise<string[]> => (await listed(res)).map((project) => project.id);

describe("sharing HTTP routes (owner or member)", () => {
  async function harness() {
    const { db } = await makeSyncEnv();
    const { jwks, token } = await authFixture();
    const app = createApp(db, { resolvePrincipal: makeJwtResolver(db, CONFIG, jwks) });
    // Header builders. `auth` is a GET/DELETE header set; `authJson` adds the JSON content-type for bodies.
    const auth = async (sub: string, email?: string) => ({ Authorization: `Bearer ${await token(sub, email)}` });
    const authJson = async (sub: string, email?: string) => ({
      ...(await auth(sub, email)),
      "Content-Type": "application/json",
    });
    return { db, app, auth, authJson };
  }

  it("shares a project by email: the invitee sees and edits it, owner stays owner", async () => {
    const { db, app, auth, authJson } = await harness();
    await app.request("/projects/p1/files/project.json", {
      method: "PUT",
      body: PROJECT,
      headers: await auth("alice", "alice@x.com"),
    });

    // Before the invite, bob sees nothing.
    expect(await listedIds(await app.request("/projects", { headers: await auth("bob", "bob@x.com") }))).toEqual([]);

    const share = await app.request("/projects/p1/members", {
      method: "POST",
      body: JSON.stringify({ email: "bob@x.com" }),
      headers: await authJson("alice", "alice@x.com"),
    });
    expect(share.status).toBe(200);

    // Bob now sees it as an editor and can read + append edits + write files.
    const bobList = await listed(await app.request("/projects", { headers: await auth("bob", "bob@x.com") }));
    expect(bobList.map((project) => project.id)).toEqual(["p1"]);
    expect(bobList[0].role).toBe("editor");
    expect(
      (await app.request("/projects/p1/files/project.json", { headers: await auth("bob", "bob@x.com") })).status,
    ).toBe(200);
    const edit = await app.request("/projects/p1/edits", {
      method: "POST",
      body: JSON.stringify({ entries: [{ seq: 0, command: { type: "createTrack" }, author: "bob", time: 1 }] }),
      headers: await authJson("bob", "bob@x.com"),
    });
    expect(edit.status).toBe(200);

    // Alice still owns it; the project row's owner never changed to bob.
    const aliceList = await listed(await app.request("/projects", { headers: await auth("alice", "alice@x.com") }));
    expect(aliceList[0].role).toBe("owner");
    const rows = await db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, "p1"));
    expect(rows[0].ownerId).toBe("alice");
  });

  it("refuses a non-member: 404 on read, 403 on write, empty list", async () => {
    const { app, auth, authJson } = await harness();
    await app.request("/projects/p1/files/project.json", {
      method: "PUT",
      body: PROJECT,
      headers: await auth("alice", "alice@x.com"),
    });

    expect(await listedIds(await app.request("/projects", { headers: await auth("carol", "carol@x.com") }))).toEqual(
      [],
    );
    expect(
      (await app.request("/projects/p1/files/project.json", { headers: await auth("carol", "carol@x.com") })).status,
    ).toBe(404);
    const write = await app.request("/projects/p1/files/meta.json", {
      method: "PUT",
      body: JSON.stringify({ name: "hijack", modifiedAt: "2026-01-01T00:00:00.000Z" }),
      headers: await authJson("carol", "carol@x.com"),
    });
    expect(write.status).toBe(403);
  });

  it("member management is owner-only (403 for a member, 404 for an unknown project)", async () => {
    const { app, auth, authJson } = await harness();
    await app.request("/projects/p1/files/project.json", {
      method: "PUT",
      body: PROJECT,
      headers: await auth("alice", "alice@x.com"),
    });
    await app.request("/projects/p1/members", {
      method: "POST",
      body: JSON.stringify({ email: "bob@x.com" }),
      headers: await authJson("alice", "alice@x.com"),
    });

    // Bob is a member, not the owner: he can't add anyone.
    const byMember = await app.request("/projects/p1/members", {
      method: "POST",
      body: JSON.stringify({ email: "carol@x.com" }),
      headers: await authJson("bob", "bob@x.com"),
    });
    expect(byMember.status).toBe(403);

    // Sharing a project that doesn't exist: 404.
    const missing = await app.request("/projects/nope/members", {
      method: "POST",
      body: JSON.stringify({ email: "x@x.com" }),
      headers: await authJson("alice", "alice@x.com"),
    });
    expect(missing.status).toBe(404);
  });

  it("normalizes the invited email so the match is case-insensitive", async () => {
    const { app, auth, authJson } = await harness();
    await app.request("/projects/p2/files/project.json", {
      method: "PUT",
      body: PROJECT,
      headers: await auth("alice", "alice@x.com"),
    });
    await app.request("/projects/p2/members", {
      method: "POST",
      body: JSON.stringify({ email: "Bob@Example.com" }),
      headers: await authJson("alice", "alice@x.com"),
    });

    // Bob signs in with the lowercase form and still matches; the stored member is normalized.
    expect(
      await listedIds(await app.request("/projects", { headers: await auth("bob", "bob@example.com") })),
    ).toContain("p2");
    const members = (await (
      await app.request("/projects/p2/members", { headers: await auth("alice", "alice@x.com") })
    ).json()) as {
      members: { email: string; role: string }[];
    };
    expect(members.members).toEqual([{ email: "bob@example.com", role: "editor" }]);
  });

  it("rejects an invalid invite email with 400", async () => {
    const { app, auth, authJson } = await harness();
    await app.request("/projects/p3/files/project.json", {
      method: "PUT",
      body: PROJECT,
      headers: await auth("alice", "alice@x.com"),
    });
    const bad = await app.request("/projects/p3/members", {
      method: "POST",
      body: JSON.stringify({ email: "not-an-email" }),
      headers: await authJson("alice", "alice@x.com"),
    });
    expect(bad.status).toBe(400);
  });

  it("revokes a member (they lose access)", async () => {
    const { app, auth, authJson } = await harness();
    await app.request("/projects/p1/files/project.json", {
      method: "PUT",
      body: PROJECT,
      headers: await auth("alice", "alice@x.com"),
    });
    await app.request("/projects/p1/members", {
      method: "POST",
      body: JSON.stringify({ email: "bob@x.com" }),
      headers: await authJson("alice", "alice@x.com"),
    });
    expect(await listedIds(await app.request("/projects", { headers: await auth("bob", "bob@x.com") }))).toEqual([
      "p1",
    ]);

    const revoke = await app.request(`/projects/p1/members/${encodeURIComponent("bob@x.com")}`, {
      method: "DELETE",
      headers: await auth("alice", "alice@x.com"),
    });
    expect(revoke.status).toBe(204);
    expect(await listedIds(await app.request("/projects", { headers: await auth("bob", "bob@x.com") }))).toEqual([]);
  });
});

describe("room authorization (the WS gap)", () => {
  const createTrack = (id: string): EditCommand => ({ type: "createTrack", instrumentType: "subtractive", id });

  it("admits owner + member, refuses a stranger, and persists a member's edit under the owner", async () => {
    const { db } = await makeSyncEnv();
    await ensureUser(db, "alice");
    await writeFile(db, { userId: "alice" }, "p1", "project.json", { kind: "json", json: JSON.parse(PROJECT) });
    await addMember(db, "p1", "bob@x.com", "editor", "alice");
    const registry = new RoomRegistry(db);

    const asOwner = await registry.get("p1", { userId: "alice" });
    expect(asOwner).not.toBeNull();
    const asMember = await registry.get("p1", { userId: "bob", email: "bob@x.com" });
    expect(asMember).toBe(asOwner); // one room per project, keyed by id
    const asStranger = await registry.get("p1", { userId: "carol", email: "carol@x.com" });
    expect(asStranger).toBeNull();

    // A member's edit persists under the project's real owner (alice), not the connecting member.
    await asMember!.applyIncoming({ command: createTrack("t-1"), opId: "op-1", author: "bob" });
    const owned = await db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, "p1"));
    expect(owned[0].ownerId).toBe("alice");
    expect((await readEdits(db, { userId: "alice" }, "p1", -1)).map((entry) => entry.seq)).toEqual([0]);
  });

  it("lets the first subscriber open (create) a not-yet-existing project", async () => {
    const { db } = await makeSyncEnv();
    const registry = new RoomRegistry(db);
    expect(await registry.get("fresh", { userId: "dave", email: "dave@x.com" })).not.toBeNull();
  });
});
