import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet, type JWTVerifyGetKey } from "jose";
import { makeSyncEnv } from "./support/syncEnv";
import { createApp } from "../server/api/app";
import { makeJwtResolver, type AuthConfig } from "../server/api/principal";
import { files, projects } from "../server/db/schema";

const put = (app: Awaited<ReturnType<typeof makeSyncEnv>>["app"], path: string, body: string) =>
  app.request(`/projects/${path}`, { method: "PUT", body });

/** The project ids from a `GET /projects` response (the list now carries name/modifiedAt/role too). */
const listedIds = async (res: Response): Promise<string[]> =>
  ((await res.json()) as { projects: { id: string }[] }).projects.map((project) => project.id);

// Minimal but validly-shaped bundle documents (the server shape-checks JSON writes).
const PROJECT = JSON.stringify({ groups: [], tracks: [], tempoBpm: 120, lengthBeats: 16, selectedTrackId: null });
const commit = (id: string) =>
  JSON.stringify({
    id,
    parent: null,
    author: "you",
    message: "",
    time: 0,
    auto: true,
    entryCount: 0,
    entries: [],
    lastSeq: 0,
  });

describe("sync API routes", () => {
  it("creates a project on first file write and lists it", async () => {
    const { app } = await makeSyncEnv();
    expect(await listedIds(await app.request("/projects"))).toEqual([]);

    const res = await put(app, "p1/files/project.json", PROJECT);
    expect(res.status).toBe(204);

    expect(await listedIds(await app.request("/projects"))).toEqual(["p1"]);
  });

  it("reads back written content and reports existence via HEAD", async () => {
    const { app } = await makeSyncEnv();
    await put(app, "p1/files/project.json", PROJECT);

    const read = await app.request("/projects/p1/files/project.json");
    expect(read.status).toBe(200);
    // jsonb may reorder keys, so compare parsed values, not the raw string.
    expect(await read.json()).toEqual(JSON.parse(PROJECT));

    expect((await app.request("/projects/p1/files/project.json", { method: "HEAD" })).status).toBe(200);
    expect((await app.request("/projects/p1/files/missing.json", { method: "HEAD" })).status).toBe(404);
    expect((await app.request("/projects/p1/files/missing.json")).status).toBe(404);
  });

  it("stores JSON files as queryable jsonb, not opaque bytes", async () => {
    const { app, db } = await makeSyncEnv();
    await put(app, "p-demo/files/project.json", PROJECT);

    const rows = await db
      .select({ json: files.json, bytes: files.bytes })
      .from(files)
      .where(and(eq(files.projectId, "p-demo"), eq(files.path, "project.json")));
    expect(rows[0]?.json).toEqual(JSON.parse(PROJECT));
    expect(rows[0]?.bytes).toBeNull();
  });

  it("stores binary files as bytes, not json", async () => {
    const { app, db } = await makeSyncEnv();
    const res = await app.request("/projects/p-demo/files/samples/abc", {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(res.status).toBe(204);

    const rows = await db
      .select({ json: files.json, bytes: files.bytes })
      .from(files)
      .where(and(eq(files.projectId, "p-demo"), eq(files.path, "samples/abc")));
    expect(rows[0]?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(rows[0]?.json).toBeNull();
  });

  it("rejects an invalid-JSON text write with 400", async () => {
    const { app } = await makeSyncEnv();
    expect((await put(app, "p-demo/files/project.json", "not json{")).status).toBe(400);
  });

  it("rejects a wrong-shaped JSON document with 422 (don't trust the client)", async () => {
    const { app } = await makeSyncEnv();
    expect((await put(app, "p-demo/files/project.json", '{"tracks":"not an array"}')).status).toBe(422);
    expect((await put(app, "p-demo/files/manifest.json", '{"projectId":"p"}')).status).toBe(422);
    // The schema now deep-validates the tree: a track missing its `kind` discriminant is rejected,
    // where the old shallow (array-of-unknown) check let it through.
    const badTrack = JSON.stringify({
      groups: [],
      tracks: [{ id: "t1" }],
      tempoBpm: 120,
      lengthBeats: 16,
      selectedTrackId: null,
    });
    expect((await put(app, "p-demo/files/project.json", badTrack)).status).toBe(422);
    // A valid shape still writes.
    expect((await put(app, "p-demo/files/project.json", PROJECT)).status).toBe(204);
  });

  it("stores a meta.json write but does not sync the name column (retired; the authority owns the index)", async () => {
    const { app, db } = await makeSyncEnv();
    // meta.json is still accepted + stored (the client OPFS/export path uses it), but syncMeta is retired:
    // projects.name is maintained by the realtime authority (setProjectName on a renameProject edit), not
    // by a client meta.json PUT, so the queryable name stays the default here.
    expect(
      (
        await put(
          app,
          "p1/files/meta.json",
          JSON.stringify({ name: "My Beat", modifiedAt: "2026-01-01T00:00:00.000Z" }),
        )
      ).status,
    ).toBe(204);

    const rows = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, "p1"));
    expect(rows[0]?.name).toBe("Untitled");
    // The file itself is retrievable (still a valid bundle file for OPFS/export round-trips).
    const back = await app.request("/projects/p1/files/meta.json");
    expect(JSON.parse(await back.text()).name).toBe("My Beat");
  });

  it("soft-deletes: the project drops from listings but its files remain", async () => {
    const { app, db } = await makeSyncEnv();
    await put(app, "p1/files/project.json", PROJECT);

    expect((await app.request("/projects/p1", { method: "DELETE" })).status).toBe(204);
    expect(await listedIds(await app.request("/projects"))).toEqual([]);

    // The row is retained (recoverable), and deletedAt is stamped.
    const fileRows = await db.select().from(files).where(eq(files.projectId, "p1"));
    expect(fileRows).toHaveLength(1);
    const projectRows = await db.select({ deletedAt: projects.deletedAt }).from(projects).where(eq(projects.id, "p1"));
    expect(projectRows[0]?.deletedAt).not.toBeNull();
  });

  it("refuses to overwrite a commit (append-only history)", async () => {
    const { app } = await makeSyncEnv();
    expect((await put(app, "p1/files/history/commits/c1.json", commit("c1"))).status).toBe(204);

    const second = await put(app, "p1/files/history/commits/c1.json", commit("c1"));
    expect(second.status).toBe(409);

    // Non-commit files (the working snapshot) stay overwritable.
    expect((await put(app, "p1/files/project.json", PROJECT)).status).toBe(204);
    expect((await put(app, "p1/files/project.json", PROJECT)).status).toBe(204);
  });

  it("keeps a committed file immutable: a second, different write is refused and does not overwrite", async () => {
    const { app } = await makeSyncEnv();
    const first = JSON.stringify({ ...JSON.parse(commit("c1")), message: "first" });
    const second = JSON.stringify({ ...JSON.parse(commit("c1")), message: "tampered" });
    expect((await put(app, "p1/files/history/commits/c1.json", first)).status).toBe(204);
    expect((await put(app, "p1/files/history/commits/c1.json", second)).status).toBe(409);

    // The stored commit is still the first write - the atomic insert never overwrote it.
    const read = await (await app.request("/projects/p1/files/history/commits/c1.json")).json();
    expect(read.message).toBe("first");
  });

  it("validates by path, not Content-Type: a JSON doc can't be smuggled in as opaque bytes", async () => {
    const { app } = await makeSyncEnv();
    // Claiming octet-stream must NOT skip shape validation for a JSON path.
    const res = await app.request("/projects/p1/files/project.json", {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: '{"tracks":"not an array"}',
    });
    expect(res.status).toBe(422);
  });

  it("rejects an oversized body with 413 (json + sample caps)", async () => {
    const jsonEnv = await makeSyncEnv({ maxJsonBytes: 50 });
    // PROJECT is well over 50 bytes, so the JSON cap trips before the handler reads it.
    expect((await put(jsonEnv.app, "p1/files/project.json", PROJECT)).status).toBe(413);

    const sampleEnv = await makeSyncEnv({ maxSampleBytes: 3 });
    const big = await sampleEnv.app.request("/projects/p1/files/samples/abc", {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array([1, 2, 3, 4]),
    });
    expect(big.status).toBe(413);
  });

  it("never writes a traversal path as a normal file", async () => {
    const { app } = await makeSyncEnv();
    // `..` is normalized away by URL parsing before routing (so it unroutes -> not a write);
    // the validator is defense-in-depth behind that. Either way it must not succeed.
    expect((await put(app, "p1/files/../secret", "x")).status).not.toBe(204);
  });

  it("rejects a malformed file path (path validator)", async () => {
    const { app } = await makeSyncEnv();
    expect((await put(app, "p1/files/bad+name.json", "x")).status).toBe(400);
  });

  it("scopes projects to their owner", async () => {
    // Two apps over the SAME db, different principals: one owner's project is invisible
    // to the other.
    const { db } = await makeSyncEnv({ ownerId: "a" });
    const appA = createApp(db, { ownerId: "a" });
    const appB = createApp(db, { ownerId: "b" });
    await appA.request("/projects/p1/files/project.json", { method: "PUT", body: PROJECT });

    expect(await listedIds(await appA.request("/projects"))).toEqual(["p1"]);
    expect(await listedIds(await appB.request("/projects"))).toEqual([]);
  });

  it("runs open in dev-stub mode (no credential required)", async () => {
    const { app } = await makeSyncEnv();
    expect((await app.request("/projects")).status).toBe(200);
  });

  it("sends CORS headers so the browser app (a different origin) can read responses", async () => {
    const { app } = await makeSyncEnv();
    const res = await app.request("/projects", { headers: { Origin: "http://localhost:5155" } });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");

    // A preflight for a PUT is answered without hitting auth/routing.
    const preflight = await app.request("/projects/p1/files/project.json", {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:5155", "Access-Control-Request-Method": "PUT" },
    });
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  describe("real auth (JWT)", () => {
    const ISSUER = "https://test.supabase.co/auth/v1";
    const ALG = "ES256";
    const KID = "test-key";
    const CONFIG: AuthConfig = { jwksUrl: "https://unused.invalid/jwks", issuer: ISSUER };

    async function authFixture(): Promise<{ jwks: JWTVerifyGetKey; token: (sub: string) => Promise<string> }> {
      const { publicKey, privateKey } = await generateKeyPair(ALG);
      const jwk = await exportJWK(publicKey);
      const jwks = createLocalJWKSet({ keys: [{ ...jwk, alg: ALG, kid: KID }] });
      const token = (sub: string) =>
        new SignJWT({})
          .setProtectedHeader({ alg: ALG, kid: KID })
          .setIssuer(ISSUER)
          .setAudience("authenticated")
          .setSubject(sub)
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(privateKey);
      return { jwks, token };
    }

    it("401s without a valid token and 200s with one (verified through the middleware)", async () => {
      const { db } = await makeSyncEnv();
      const { jwks, token } = await authFixture();
      const app = createApp(db, { resolvePrincipal: makeJwtResolver(db, CONFIG, jwks) });

      expect((await app.request("/projects")).status).toBe(401);
      expect((await app.request("/projects", { headers: { Authorization: "Bearer bogus" } })).status).toBe(401);
      const ok = await app.request("/projects", { headers: { Authorization: `Bearer ${await token("user-1")}` } });
      expect(ok.status).toBe(200);
    });

    it("scopes projects to the token's subject (two real users are isolated)", async () => {
      const { db } = await makeSyncEnv();
      const { jwks, token } = await authFixture();
      // One app, one verifier: the principal comes from each request's token, not app config.
      const app = createApp(db, { resolvePrincipal: makeJwtResolver(db, CONFIG, jwks) });
      const auth = async (sub: string) => ({ Authorization: `Bearer ${await token(sub)}` });

      await app.request("/projects/p1/files/project.json", {
        method: "PUT",
        body: PROJECT,
        headers: await auth("alice"),
      });

      expect(await listedIds(await app.request("/projects", { headers: await auth("alice") }))).toEqual(["p1"]);
      expect(await listedIds(await app.request("/projects", { headers: await auth("bob") }))).toEqual([]);
    });
  });
});
