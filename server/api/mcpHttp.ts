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
 * a Supabase access token.
 *
 * **That token must be for this resource** (`aud` = `MCP_RESOURCE_URL`), which Supabase's custom
 * access token hook stamps on tokens it issues to connected apps (docs/supabase/mcp-audience-hook.sql).
 * Without the check a key cut for anything else this Supabase project ever serves would open this
 * door too. It is also a door of its own: the app's API wants `aud: "authenticated"`, so a connected
 * app's token reaches the MCP tools and nothing else.
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
  /** OAuth discovery, in production: this resource's URL and who issues tokens for it. Unset locally,
   *  where the dev stub needs no discovery. */
  discovery?: { resource: string; authorizationServer: string };
}

/** Where MCP lives, and where its metadata does: RFC 9728 puts the resource's path after the prefix. */
export const MCP_PATH = "/mcp";
export const METADATA_PATHS = ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"];

const bearer = (header: string | undefined): string | undefined =>
  header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

/** The RFC 9728 document: what this resource is, and who issues tokens for it. */
export const protectedResourceHandler = (resource: string, authorizationServer: string) => (c: Context) =>
  c.json(
    OAuthProtectedResourceMetadataSchema.parse({
      resource,
      authorization_servers: [authorizationServer],
      bearer_methods_supported: ["header"],
      resource_name: "Corrente",
    }),
  );

export const hostedMcpHandler =
  ({ db, registry, resolvePrincipal, discovery }: HostedMcpRoute) =>
  async (c: Context): Promise<Response> => {
    const principal = await resolvePrincipal(bearer(c.req.header("Authorization")));
    if (!principal) {
      const metadata = discovery
        ? `, resource_metadata="${new URL(discovery.resource).origin}${METADATA_PATHS[0]}"`
        : "";
      c.header("WWW-Authenticate", `Bearer realm="corrente"${metadata}`);
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
