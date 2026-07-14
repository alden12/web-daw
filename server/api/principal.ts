/**
 * The authentication seam: resolve a request credential (a bearer JWT on HTTP, the `?token=` value on
 * the WS upgrade) to a real user principal. Shared by the HTTP middleware (app.ts) and the WS upgrade
 * (wsServer.ts) so both gate identity through the exact same path.
 *
 * Two resolvers, one interface:
 *  - `makeJwtResolver` - verify the JWT against the identity provider's public keys (Supabase, via a
 *    JWKS). Checks the signature, issuer, and audience; the principal is the token's `sub`. Any failure
 *    (bad signature, expired, wrong iss/aud, malformed, absent) resolves to `null` = unauthorised. This
 *    is the production path.
 *  - `makeDevResolver` - the pre-auth stub kept for local dev and tests: a single configured principal
 *    (default "local"), no credential required. No real identity. (Local dev runs open; production always
 *    sets the JWT config, so the real gate is always on where it matters.)
 *
 * Either way a resolved principal is provisioned just-in-time (`ensureUser`), so the `projects.owner_id`
 * FK is satisfied before any owner-stamped write. Keeping verification here (not inline in app.ts) is
 * what lets the socket path reuse it verbatim, and keeps the provider dependency (jose + a JWKS URL)
 * behind one swappable function - the low-lock-in seam.
 *
 * DOM-free (Node): jose + the db store only.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Db } from "../db/types";
import { ensureUser } from "../db/store";

/** A resolved user identity. `email` is best-effort (a provider may omit the claim). */
export interface Principal {
  userId: string;
  email?: string;
}

/** Credential (bearer value / `?token=` value) -> principal, or `null` when unauthorised. */
export type ResolvePrincipal = (credential: string | undefined) => Promise<Principal | null>;

/** Serializable JWT-verification config (what the bootstrap reads from env). */
export interface AuthConfig {
  /** The provider's JWKS endpoint (asymmetric signing keys). */
  jwksUrl: string;
  /** Expected `iss` claim. */
  issuer: string;
  /** Expected `aud` claim; Supabase access tokens use "authenticated". */
  audience?: string;
}

/**
 * Verify JWTs against a JWKS. `getKey` defaults to a remote JWKS fetched (and cached) from
 * `config.jwksUrl`; tests inject a local key set to verify without a network round-trip.
 */
export function makeJwtResolver(db: Db, config: AuthConfig, getKey?: JWTVerifyGetKey): ResolvePrincipal {
  const keys = getKey ?? createRemoteJWKSet(new URL(config.jwksUrl));
  const audience = config.audience ?? "authenticated";
  return async (credential) => {
    if (!credential) return null;
    try {
      const { payload } = await jwtVerify(credential, keys, { issuer: config.issuer, audience });
      if (!payload.sub) return null;
      const email = typeof payload.email === "string" ? payload.email : undefined;
      await ensureUser(db, payload.sub, email);
      return { userId: payload.sub, email };
    } catch {
      return null; // bad signature / expired / wrong iss|aud / malformed
    }
  };
}

/** The pre-auth stub: a single configured principal (default "local"), no credential required. */
export function makeDevResolver(db: Db, options: { devUserId?: string } = {}): ResolvePrincipal {
  const devUserId = options.devUserId ?? "local";
  return async () => {
    await ensureUser(db, devUserId);
    return { userId: devUserId };
  };
}
