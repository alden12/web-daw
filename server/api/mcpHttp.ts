/**
 * `/mcp`: the hosted MCP server over Streamable HTTP (AGENT-28), so Claude can edit a stored project
 * from anywhere - the phone app, claude.ai - rather than only from a machine running the local server.
 *
 * Stateless, like ai-project-manager's: a fresh server and transport per request, no session kept, so
 * any request can land on any instance. Identity comes through the same principal resolver as the
 * rest of the API (a verified JWT, or the dev stub locally), and every project it opens is authorised
 * through the room registry exactly as a WebSocket subscribe is.
 *
 * **Discovery for OAuth clients** (claude.ai's connectors, the Claude apps): a request with no token
 * gets a `401` whose challenge points at this server's protected-resource metadata (RFC 9728), which
 * names the Supabase project as the authorization server. The client then registers itself there,
 * sends the person through Supabase's OAuth server to Corrente's `/oauth/consent`, and comes back with
 * an ordinary Supabase access token - the same kind the app itself uses, verified by the same
 * resolver. No audience hook: this Supabase project mints tokens for Corrente and nothing else, and
 * the API already accepts any of them for full access to the caller's projects.
 */
import type { Context } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { OAuthProtectedResourceMetadataSchema } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Db } from "../db/types";
import type { RoomRegistry } from "./rooms";
import type { ResolvePrincipal } from "./principal";
import { createHostedMcp } from "../mcp/hosted";

export interface HostedMcpRoute {
  db: Db;
  registry: RoomRegistry;
  resolvePrincipal: ResolvePrincipal;
  /** The token issuer (`SUPABASE_JWT_ISSUER`). Unset locally, where the dev stub needs no discovery. */
  authorizationServer?: string;
}

/** Where MCP lives, and where its metadata does: RFC 9728 puts the resource's path after the prefix. */
export const MCP_PATH = "/mcp";
export const METADATA_PATHS = ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"];

/**
 * This server's own origin as the client reached it. Behind Fly's proxy the request arrives as plain
 * http, so the forwarded scheme is the true one - and the resource named in the metadata has to match
 * the URL the client connected to, exactly, or it refuses the token it is given.
 */
const originOf = (c: Context): string => {
  const url = new URL(c.req.url);
  const scheme = c.req.header("X-Forwarded-Proto") ?? url.protocol.replace(":", "");
  return `${scheme}://${c.req.header("Host") ?? url.host}`;
};

/** The RFC 9728 document: what this resource is, and who issues tokens for it. */
export const protectedResourceHandler = (authorizationServer: string) => (c: Context) =>
  c.json(
    OAuthProtectedResourceMetadataSchema.parse({
      resource: `${originOf(c)}${MCP_PATH}`,
      authorization_servers: [authorizationServer],
      bearer_methods_supported: ["header"],
      resource_name: "Corrente",
    }),
  );

const bearer = (header: string | undefined): string | undefined =>
  header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

export const hostedMcpHandler =
  ({ db, registry, resolvePrincipal, authorizationServer }: HostedMcpRoute) =>
  async (c: Context): Promise<Response> => {
    const principal = await resolvePrincipal(bearer(c.req.header("Authorization")));
    if (!principal) {
      const discovery = authorizationServer ? `, resource_metadata="${originOf(c)}${METADATA_PATHS[0]}"` : "";
      c.header("WWW-Authenticate", `Bearer realm="corrente"${discovery}`);
      return c.json({ error: "unauthorized" }, 401);
    }
    const server = createHostedMcp({ db, registry, principal });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  };
