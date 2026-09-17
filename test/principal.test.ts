/**
 * The auth seam (server/api/principal.ts). The JWT path is verified against a LOCAL key set (jose
 * `createLocalJWKSet`), so these run with no network and no live Supabase: we mint tokens with a test
 * key pair and check that only correctly-signed, correctly-scoped, unexpired tokens resolve to a
 * principal - and that a resolved principal is provisioned into the `users` table.
 */
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet, type JWTVerifyGetKey } from "jose";
import { makeSyncEnv } from "./support/syncEnv";
import { makeJwtResolver, makeDevResolver, resolveAuthConfig, type AuthConfig } from "../server/api/principal";
import { users } from "../server/db/schema";

const ISSUER = "https://test.supabase.co/auth/v1";
const ALG = "ES256";
const KID = "test-key";
const CONFIG: AuthConfig = { jwksUrl: "https://unused.invalid/jwks", issuer: ISSUER };

interface SignOptions {
  issuer?: string;
  audience?: string;
  sub?: string;
  email?: string;
  expiresIn?: string | number;
}

/** A test key pair, a matching local JWKS, and a signer for minting tokens against it. */
async function authFixture(): Promise<{ jwks: JWTVerifyGetKey; sign: (options?: SignOptions) => Promise<string> }> {
  const { publicKey, privateKey } = await generateKeyPair(ALG);
  const jwk = await exportJWK(publicKey);
  const jwks = createLocalJWKSet({ keys: [{ ...jwk, alg: ALG, kid: KID }] });
  const sign = (options: SignOptions = {}) =>
    new SignJWT(options.email ? { email: options.email } : {})
      .setProtectedHeader({ alg: ALG, kid: KID })
      .setIssuer(options.issuer ?? ISSUER)
      .setAudience(options.audience ?? "authenticated")
      .setSubject(options.sub ?? "user-1")
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? "1h")
      .sign(privateKey);
  return { jwks, sign };
}

describe("makeJwtResolver", () => {
  it("resolves a valid token to its subject + email and provisions the user", async () => {
    const { db } = await makeSyncEnv();
    const { jwks, sign } = await authFixture();
    const resolve = makeJwtResolver(db, CONFIG, jwks);

    const principal = await resolve(await sign({ sub: "abc-123", email: "dev@example.com" }));
    expect(principal).toEqual({ userId: "abc-123", email: "dev@example.com" });

    const rows = await db.select().from(users).where(eq(users.id, "abc-123"));
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("dev@example.com");
  });

  it("resolves a token with no email claim (email is best-effort)", async () => {
    const { db } = await makeSyncEnv();
    const { jwks, sign } = await authFixture();
    const resolve = makeJwtResolver(db, CONFIG, jwks);
    expect(await resolve(await sign({ sub: "no-email" }))).toEqual({ userId: "no-email" });
  });

  it("rejects a token signed by a different key (bad signature)", async () => {
    const { db } = await makeSyncEnv();
    const trusted = await authFixture();
    const attacker = await authFixture();
    const resolve = makeJwtResolver(db, CONFIG, trusted.jwks);
    expect(await resolve(await attacker.sign())).toBeNull();
  });

  it("rejects wrong issuer, wrong audience, and expired tokens", async () => {
    const { db } = await makeSyncEnv();
    const { jwks, sign } = await authFixture();
    const resolve = makeJwtResolver(db, CONFIG, jwks);

    expect(await resolve(await sign({ issuer: "https://evil.example/auth/v1" }))).toBeNull();
    expect(await resolve(await sign({ audience: "anon" }))).toBeNull();
    expect(await resolve(await sign({ expiresIn: Math.floor(Date.now() / 1000) - 60 }))).toBeNull();
  });

  it("rejects a tampered token and a missing credential", async () => {
    const { db } = await makeSyncEnv();
    const { jwks, sign } = await authFixture();
    const resolve = makeJwtResolver(db, CONFIG, jwks);

    expect(await resolve((await sign()) + "x")).toBeNull();
    expect(await resolve(undefined)).toBeNull();
    expect(await resolve("not-a-jwt")).toBeNull();
  });
});

describe("resolveAuthConfig (fail-closed bootstrap)", () => {
  const configured = { SUPABASE_JWKS_URL: "https://project.supabase.co/auth/v1/jwks", SUPABASE_JWT_ISSUER: ISSUER };

  it("returns the config when both vars are set, in any environment", () => {
    const expected = { jwksUrl: configured.SUPABASE_JWKS_URL, issuer: ISSUER };
    expect(resolveAuthConfig({ ...configured, NODE_ENV: "production" })).toEqual(expected);
    expect(resolveAuthConfig({ ...configured, NODE_ENV: "development" })).toEqual(expected);
  });

  it("throws in production when the auth config is absent (fails closed)", () => {
    expect(() => resolveAuthConfig({ NODE_ENV: "production" })).toThrow(/Refusing to start/);
  });

  it("throws in production when only one of the two vars is set (partial config is not enough)", () => {
    expect(() =>
      resolveAuthConfig({ NODE_ENV: "production", SUPABASE_JWKS_URL: configured.SUPABASE_JWKS_URL }),
    ).toThrow(/Refusing to start/);
    expect(() => resolveAuthConfig({ NODE_ENV: "production", SUPABASE_JWT_ISSUER: ISSUER })).toThrow(
      /Refusing to start/,
    );
  });

  it("returns undefined (open dev-stub) outside production when config is missing, and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveAuthConfig({})).toBeUndefined();
    expect(resolveAuthConfig({ NODE_ENV: "development" })).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("makeDevResolver (dev-stub)", () => {
  it("maps any request to the configured principal (open) and provisions it", async () => {
    const { db } = await makeSyncEnv();
    const resolve = makeDevResolver(db, { devUserId: "local" });
    // No credential required - the dev stub is open (local dev / tests).
    expect(await resolve(undefined)).toEqual({ userId: "local" });
    expect(await resolve("anything")).toEqual({ userId: "local" });
    expect(await db.select().from(users).where(eq(users.id, "local"))).toHaveLength(1);
  });
});
